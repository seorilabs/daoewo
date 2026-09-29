import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, open, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { batchPlanDigest, expandCoverageSlots, getDeckBatchPlan } from "./batch-plan.mjs";
import { digestJson, readJson, writeJsonAtomic } from "./io.mjs";
import { normalizeCards } from "./normalize.mjs";
import { runCopyrightQa, runFactualQa, runSafetyQa } from "./qa.mjs";
import { advance } from "./state-machine.mjs";
import { assertCards, validateCard, validateDeck, ValidationError } from "./validation.mjs";

const RUN_SCHEMA_VERSION = 1;
const ATTEMPT_SCHEMA_VERSION = 1;

function nowIso(clock) {
  return clock().toISOString();
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function canonical(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/[\p{P}\p{S}]/gu, "");
}

function attemptDirectory(runRoot, slotId) {
  return path.join(runRoot, "batches", slotId);
}

function attemptPath(runRoot, slotId, attemptNumber) {
  return path.join(attemptDirectory(runRoot, slotId), `attempt-${String(attemptNumber).padStart(4, "0")}.json`);
}

function assertAttemptIntegrity({ attempt, deckId, planDigest, slot, slotOrder, label }) {
  if (
    attempt?.schemaVersion !== ATTEMPT_SCHEMA_VERSION ||
    attempt.planDigest !== planDigest ||
    attempt.deckId !== deckId ||
    attempt.slotId !== slot.id ||
    attempt.slotOrder !== slotOrder ||
    !Number.isInteger(attempt.attempt) ||
    attempt.attempt < 1 ||
    !Number.isInteger(attempt.requestedCount) ||
    attempt.requestedCount < 1 ||
    attempt.requestedCount > 20 ||
    !["requesting", "completed", "failed"].includes(attempt.status)
  ) {
    throw new Error(`손상되거나 현재 plan과 일치하지 않는 batch attempt: ${label}`);
  }
  if (attempt.status === "completed") {
    if (
      attempt.raw === null ||
      typeof attempt.raw !== "object" ||
      Array.isArray(attempt.raw) ||
      typeof attempt.responseDigest !== "string" ||
      attempt.responseDigest !== digestJson(attempt.raw)
    ) {
      throw new Error(`응답 digest가 일치하지 않는 completed batch attempt: ${label}`);
    }
  }
}

async function loadAttempts({ runRoot, slots, planDigest, deckId }) {
  const attempts = [];
  for (const [slotOrder, slot] of slots.entries()) {
    let entries;
    try {
      entries = await readdir(attemptDirectory(runRoot, slot.id));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const name of entries.sort()) {
      if (!/^attempt-\d{4}\.json$/.test(name)) continue;
      const attempt = await readJson(path.join(attemptDirectory(runRoot, slot.id), name));
      assertAttemptIntegrity({ attempt, deckId, planDigest, slot, slotOrder, label: `${slot.id}/${name}` });
      const fileAttemptNumber = Number(name.slice("attempt-".length, -".json".length));
      if (attempt.attempt !== fileAttemptNumber) throw new Error(`파일명과 attempt 번호가 일치하지 않는다: ${slot.id}/${name}`);
      attempts.push(attempt);
    }
  }
  return attempts.sort((left, right) => left.slotOrder - right.slotOrder || left.attempt - right.attempt);
}

function assertAttemptCardSources(card, slot) {
  const allowed = new Set(slot.sourceIds);
  if (!Array.isArray(card.sourceRefs) || card.sourceRefs.length === 0) {
    throw new Error(`${slot.id} batch 카드에 sourceRefs가 없다.`);
  }
  for (const sourceRef of card.sourceRefs) {
    if (!allowed.has(sourceRef)) throw new Error(`${slot.id} batch 카드가 plan allowlist 밖 sourceRef를 사용했다.`);
  }
}

function rawCandidateRejectionReason(rawCard, slot) {
  const allowedKeys = new Set([
    "front",
    "back",
    "hint",
    "reading",
    "example",
    "exampleMeaning",
    "tags",
    "difficulty",
    "sourceRefs",
  ]);
  if (
    rawCard === null ||
    typeof rawCard !== "object" ||
    Array.isArray(rawCard) ||
    Object.keys(rawCard).some((key) => !allowedKeys.has(key)) ||
    typeof rawCard.front !== "string" ||
    typeof rawCard.back !== "string" ||
    !Array.isArray(rawCard.tags) ||
    rawCard.tags.some((tag) => typeof tag !== "string") ||
    !Number.isInteger(rawCard.difficulty) ||
    !Array.isArray(rawCard.sourceRefs) ||
    rawCard.sourceRefs.length === 0 ||
    rawCard.sourceRefs.some((sourceRef) => typeof sourceRef !== "string") ||
    new Set(rawCard.sourceRefs).size !== rawCard.sourceRefs.length ||
    ["hint", "reading", "example", "exampleMeaning"].some(
      (field) => rawCard[field] !== undefined && typeof rawCard[field] !== "string",
    )
  ) {
    return "structural";
  }
  const allowedSources = new Set(slot.sourceIds);
  if (rawCard.sourceRefs.some((sourceRef) => !allowedSources.has(sourceRef))) return "source-allowlist";
  return null;
}

function candidateRejectionReason(card, slot, sources) {
  try {
    assertAttemptCardSources(card, slot);
  } catch {
    return "source-allowlist";
  }
  if (validateCard(card).length > 0) return "structural";
  try {
    runSafetyQa([card]);
  } catch (error) {
    if (error?.stage === "safety") return "safety";
    throw error;
  }
  try {
    runFactualQa([card], sources);
  } catch (error) {
    if (error?.stage === "factual") return "factual";
    throw error;
  }
  return null;
}

/** 완료 attempt를 plan 순서로 합치고 deck 전체 범위에서 중복을 제거한다. */
export function assembleBatchCards({ deckId, planDigest, slots, sources, attempts }) {
  const validCandidates = [];
  const rejected = [];
  const rejectedFronts = [];

  for (const attempt of attempts) {
    const slotOrder = slots.findIndex((candidate) => candidate.id === attempt.slotId);
    if (slotOrder < 0) throw new Error(`plan에 없는 batch slot: ${String(attempt.slotId)}`);
    const slot = slots[slotOrder];
    assertAttemptIntegrity({ attempt, deckId, planDigest, slot, slotOrder, label: `${slot.id}/attempt-${attempt.attempt}` });
    if (attempt.status !== "completed") continue;
    if (
      attempt.raw === null ||
      typeof attempt.raw !== "object" ||
      Array.isArray(attempt.raw) ||
      Object.keys(attempt.raw).some((key) => !["deckId", "slotId", "cards"].includes(key)) ||
      attempt.raw.deckId !== deckId ||
      attempt.raw.slotId !== slot.id ||
      !Array.isArray(attempt.raw.cards) ||
      attempt.raw.cards.length < 1 ||
      attempt.raw.cards.length > attempt.requestedCount
    ) {
      throw new Error(`${slot.id} completed attempt 응답이 손상됐다.`);
    }
    for (const [rawIndex, rawCard] of attempt.raw.cards.entries()) {
      const rawRejectionReason = rawCandidateRejectionReason(rawCard, slot);
      if (rawRejectionReason !== null) {
        rejected.push({ candidateId: `${slot.id}.attempt-${attempt.attempt}.candidate-${rawIndex}`, reason: rawRejectionReason, slotId: slot.id });
        if (typeof rawCard?.front === "string" && rawCard.front.trim().length > 0) rejectedFronts.push(rawCard.front);
        continue;
      }
      const [card] = normalizeCards(deckId, [rawCard]);
      const rejectionReason = candidateRejectionReason(card, slot, sources);
      if (rejectionReason !== null) {
        rejected.push({ candidateId: card.id, reason: rejectionReason, slotId: slot.id });
        if (card.front.length > 0) rejectedFronts.push(card.front);
        continue;
      }
      validCandidates.push({ card, slotId: slot.id });
    }
  }

  // 1차 pass에서 유효 후보 전체를 모은 뒤, 같은 질문에 서로 다른 답이 하나라도
  // 있으면 그 front의 모든 후보를 격리한다. 어느 답도 임의로 정답으로 채택하지 않는다.
  const backKeysByFront = new Map();
  for (const { card } of validCandidates) {
    const frontKey = canonical(card.front);
    const backKeys = backKeysByFront.get(frontKey) ?? new Set();
    backKeys.add(canonical(card.back));
    backKeysByFront.set(frontKey, backKeys);
  }
  const conflictFrontKeys = new Set(
    [...backKeysByFront.entries()]
      .filter(([, backKeys]) => backKeys.size > 1)
      .map(([frontKey]) => frontKey),
  );
  const conflictFreeCandidates = [];
  for (const entry of validCandidates) {
    if (conflictFrontKeys.has(canonical(entry.card.front))) {
      rejected.push({ candidateId: entry.card.id, reason: "front-conflict", slotId: entry.slotId });
      rejectedFronts.push(entry.card.front);
    } else {
      conflictFreeCandidates.push(entry);
    }
  }

  // 2차 pass에서만 slot cap과 deck 전체 exact dedupe를 적용한다. 따라서 충돌
  // 후보를 제거한 자리를 다음 attempt의 정상 후보가 정확히 채울 수 있다.
  const accepted = [];
  const exact = new Map();
  const perSlot = new Map(slots.map((slot) => [slot.id, []]));
  const removed = [];
  for (const entry of conflictFreeCandidates) {
    const { card, slotId } = entry;
    const slot = slots.find((candidate) => candidate.id === slotId);
    const slotCards = perSlot.get(slotId);
    if (slotCards.length >= slot.targetCardCount) {
      removed.push({ duplicateId: card.id, keptId: null, reason: "slot-overflow", slotId });
      continue;
    }
    const exactKey = `${canonical(card.front)}\u0000${canonical(card.back)}`;
    if (exact.has(exactKey)) {
      removed.push({ duplicateId: card.id, keptId: exact.get(exactKey).id, reason: "same-front-and-back", slotId });
      continue;
    }
    exact.set(exactKey, card);
    slotCards.push(card);
    accepted.push(entry);
  }

  return Object.freeze({
    cards: Object.freeze(accepted.map(({ card }, index) => Object.freeze({ ...card, index }))),
    perSlot: Object.freeze(Object.fromEntries([...perSlot].map(([slotId, cards]) => [slotId, cards.length]))),
    removed: Object.freeze(removed),
    conflicts: Object.freeze([]),
    rejected: Object.freeze(rejected),
    rejectedFronts: Object.freeze(rejectedFronts),
  });
}

function sumUsage(attempts) {
  const total = {
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    thoughtsTokenCount: 0,
    totalTokenCount: 0,
  };
  for (const attempt of attempts) {
    for (const key of Object.keys(total)) {
      const value = attempt?.usage?.[key];
      if (Number.isSafeInteger(value) && value >= 0) total[key] += value;
    }
  }
  return Object.freeze(total);
}

function createRunState({ plan, deckPlan, planDigest, slots, attempts, assembly, state, createdAt, clock }) {
  return Object.freeze({
    schemaVersion: RUN_SCHEMA_VERSION,
    planId: plan.planId,
    planDigest,
    deckId: deckPlan.deckId,
    targetCardCount: deckPlan.targetCardCount,
    slotSize: plan.slotSize,
    state,
    createdAt,
    updatedAt: nowIso(clock),
    calls: attempts.length,
    completedCalls: attempts.filter((attempt) => attempt.status === "completed").length,
    failedCalls: attempts.filter((attempt) => attempt.status === "failed").length,
    uncertainCalls: attempts.filter((attempt) => attempt.status === "requesting").length,
    acceptedCardCount: assembly.cards.length,
    duplicateCount: assembly.removed.length,
    conflictCount: assembly.conflicts.length,
    rejectedCandidateCount: assembly.rejected.length,
    slots: slots.map((slot) => ({
      id: slot.id,
      targetCardCount: slot.targetCardCount,
      acceptedCardCount: assembly.perSlot[slot.id] ?? 0,
    })),
    usage: sumUsage(attempts),
  });
}

function buildAwaitingRecord({ deck, plan, deckPlan, planDigest, slots, attempts, assembly, clock }) {
  if (assembly.cards.length !== deckPlan.targetCardCount) {
    throw new Error(`최종 카드 수 ${assembly.cards.length}가 목표 ${deckPlan.targetCardCount}와 다르다.`);
  }
  if (slots.some((slot) => assembly.perSlot[slot.id] !== slot.targetCardCount)) {
    throw new Error("coverage slot 중 목표 20장을 채우지 못한 항목이 있다.");
  }
  if (assembly.conflicts.length > 0) {
    throw new Error(`동일 front에 다른 back이 있는 충돌 카드 ${assembly.conflicts.length}건을 해소해야 한다.`);
  }
  assertCards(assembly.cards);
  const responseDigests = attempts
    .filter((attempt) => attempt.status === "completed")
    .map((attempt) => attempt.responseDigest);
  const inputDigest = digestJson({ planDigest, responseDigests });
  let record = {
    schemaVersion: 1,
    fixtureOnly: false,
    deck: {
      ...deck,
      provenance: {
        ...deck.provenance,
        kind: "ai-assisted",
        inputDigest,
        generatedBy: "gemini-operator-resumable-batch-v1",
      },
    },
    cards: assembly.cards,
    sourceRegistry: deckPlan.sources.map((source) => ({ ...source })),
    referenceTexts: [],
    qa: {},
    dedupe: { removed: assembly.removed, conflicts: [] },
    batchRun: {
      schemaVersion: RUN_SCHEMA_VERSION,
      planId: plan.planId,
      planDigest,
      targetCardCount: deckPlan.targetCardCount,
      slotSize: plan.slotSize,
      slots: slots.map((slot) => ({ id: slot.id, coverageId: slot.coverageId, cardCount: assembly.perSlot[slot.id] })),
      attempts: attempts.map((attempt) => ({
        slotId: attempt.slotId,
        attempt: attempt.attempt,
        status: attempt.status,
        requestedCount: attempt.requestedCount,
        responseDigest: attempt.responseDigest ?? null,
        usage: attempt.usage ?? null,
      })),
      usage: sumUsage(attempts),
      rejectedCandidates: assembly.rejected,
    },
    workflow: {
      state: "planned",
      history: [{ from: null, to: "planned", at: nowIso(clock), actor: "operator-batch-cli" }],
    },
  };
  record = advance(record, "generated", { actor: "gemini-operator-resumable-batch-v1", inputDigest }, clock());
  record = advance(record, "normalized", { actor: "normalizer-v1" }, clock());
  record = advance(record, "deduplicated", { actor: "cross-batch-dedupe-v1", removed: assembly.removed.length }, clock());
  const safety = runSafetyQa(record.cards);
  record = { ...record, qa: { ...record.qa, safety } };
  record = advance(record, "safety-qa-passed", { actor: "safety-qa-v1" }, clock());
  const copyright = runCopyrightQa(record.cards, record.referenceTexts);
  record = { ...record, qa: { ...record.qa, copyright } };
  record = advance(record, "copyright-qa-passed", { actor: "copyright-qa-v1" }, clock());
  const factual = runFactualQa(record.cards, record.sourceRegistry);
  record = {
    ...record,
    qa: {
      ...record.qa,
      factual,
      coverage: { stage: "coverage", passed: true, findingCount: 0, targetCardCount: deckPlan.targetCardCount },
    },
  };
  record = advance(record, "factual-qa-passed", { actor: "plan-source-allowlist-qa-v1" }, clock());
  record = advance(record, "awaiting-human-approval", { actor: "operator-batch-cli" }, clock());
  const deckErrors = validateDeck(record.deck);
  if (deckErrors.length > 0) throw new ValidationError(`덱 ${deck.id}`, deckErrors);
  return record;
}

async function materializeCompatibleRecord({ record, compatibilityPath, clock }) {
  const existing = await readJsonIfExists(compatibilityPath);
  let legacyPreserved = null;
  if (
    existing !== null &&
    !(
      existing?.batchRun?.planDigest === record.batchRun.planDigest &&
      existing?.deck?.provenance?.inputDigest === record.deck.provenance.inputDigest
    )
  ) {
    const existingDigest = digestJson(existing).slice("sha256:".length);
    const legacyDirectory = path.join(path.dirname(compatibilityPath), "legacy", record.deck.id);
    const legacyPath = path.join(legacyDirectory, `${existingDigest}.json`);
    await mkdir(legacyDirectory, { recursive: true });
    try {
      await copyFile(compatibilityPath, legacyPath, fsConstants.COPYFILE_EXCL);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    legacyPreserved = legacyPath;
  }
  await writeJsonAtomic(compatibilityPath, record);
  return { compatibilityPath, legacyPreserved, materializedAt: nowIso(clock) };
}

async function withRunLock(runRoot, forceUnlock, operation) {
  await mkdir(runRoot, { recursive: true });
  const lockPath = path.join(runRoot, ".operator.lock");
  if (forceUnlock) await rm(lockPath, { force: true });
  let handle;
  try {
    handle = await open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`다른 operator run lock이 있다: ${lockPath}`);
    throw error;
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => undefined);
    await rm(lockPath, { force: true });
  }
}

function safeAttemptError(error) {
  return Object.freeze({
    name: typeof error?.name === "string" ? error.name : "Error",
    status: Number.isInteger(error?.status) ? error.status : null,
    retryable: error?.retryable === true,
  });
}

export async function runResumableBatch({
  plan,
  catalog,
  deckId,
  generator,
  runRoot,
  compatibilityPath,
  maxCalls,
  retryUncertain = false,
  forceUnlock = false,
  clock = () => new Date(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const deckPlan = getDeckBatchPlan(plan, deckId);
  const deck = catalog.decks.find((candidate) => candidate.id === deckId);
  if (deck === undefined) throw new Error(`manifest에 없는 deck id: ${deckId}`);
  const planDigest = batchPlanDigest(plan, deckPlan);
  const slots = expandCoverageSlots(plan, deckPlan);
  const callLimit = maxCalls ?? slots.length + Math.ceil(slots.length / 2);
  if (!Number.isInteger(callLimit) || callLimit < slots.length) {
    throw new Error(`maxCalls는 최소 nominal slot 수 ${slots.length} 이상이어야 한다.`);
  }

  return withRunLock(runRoot, forceUnlock, async () => {
    const runStatePath = path.join(runRoot, "run.json");
    const existingRun = await readJsonIfExists(runStatePath);
    if (existingRun !== null && existingRun.planDigest !== planDigest) {
      throw new Error("기존 run의 planDigest가 현재 tracked plan과 다르다. 새 runRoot를 사용한다.");
    }
    const createdAt = existingRun?.createdAt ?? nowIso(clock);

    while (true) {
      const attempts = await loadAttempts({ runRoot, slots, planDigest, deckId });
      const uncertain = attempts.filter((attempt) => attempt.status === "requesting");
      if (uncertain.length > 0 && !retryUncertain) {
        throw new Error("응답 저장 여부가 불확실한 requesting attempt가 있다. 확인 후 --retry-uncertain을 명시한다.");
      }
      const effectiveAttempts = retryUncertain
        ? attempts.map((attempt) => attempt.status === "requesting" ? { ...attempt, status: "failed", error: { name: "UncertainAttempt", status: null, retryable: true } } : attempt)
        : attempts;
      if (retryUncertain && uncertain.length > 0) {
        for (const attempt of effectiveAttempts.filter((candidate) => candidate.error?.name === "UncertainAttempt")) {
          await writeJsonAtomic(attemptPath(runRoot, attempt.slotId, attempt.attempt), attempt);
        }
      }

      const assembly = assembleBatchCards({ deckId, planDigest, slots, sources: deckPlan.sources, attempts: effectiveAttempts });
      if (assembly.conflicts.length > 0) {
        const blocked = createRunState({ plan, deckPlan, planDigest, slots, attempts: effectiveAttempts, assembly, state: "blocked-conflict", createdAt, clock });
        await writeJsonAtomic(runStatePath, blocked);
        throw new Error(`동일 front에 다른 back이 있는 충돌 카드 ${assembly.conflicts.length}건을 해소해야 한다.`);
      }
      if (assembly.cards.length === deckPlan.targetCardCount) {
        const record = buildAwaitingRecord({ deck, plan, deckPlan, planDigest, slots, attempts: effectiveAttempts, assembly, clock });
        await writeJsonAtomic(path.join(runRoot, "record.json"), record);
        const materialized = await materializeCompatibleRecord({ record, compatibilityPath, clock });
        const finalState = createRunState({ plan, deckPlan, planDigest, slots, attempts: effectiveAttempts, assembly, state: "awaiting-human-approval", createdAt, clock });
        await writeJsonAtomic(runStatePath, finalState);
        return { record, runState: finalState, ...materialized, runRoot };
      }

      if (effectiveAttempts.length >= callLimit) {
        const blocked = createRunState({ plan, deckPlan, planDigest, slots, attempts: effectiveAttempts, assembly, state: "blocked-underfill", createdAt, clock });
        await writeJsonAtomic(runStatePath, blocked);
        throw new Error(`maxCalls=${callLimit} 안에 목표 ${deckPlan.targetCardCount}장을 채우지 못했다(현재 ${assembly.cards.length}).`);
      }

      const slot = slots.find((candidate) => (assembly.perSlot[candidate.id] ?? 0) < candidate.targetCardCount);
      if (slot === undefined) throw new Error("전체 목표는 미달인데 underfilled coverage slot을 찾을 수 없다.");
      const requestedCount = slot.targetCardCount - (assembly.perSlot[slot.id] ?? 0);
      const slotAttempts = effectiveAttempts.filter((attempt) => attempt.slotId === slot.id);
      const attemptNumber = Math.max(0, ...slotAttempts.map((attempt) => attempt.attempt)) + 1;
      const filePath = attemptPath(runRoot, slot.id, attemptNumber);
      const excludedFronts = [...assembly.cards.map((card) => card.front), ...assembly.rejectedFronts];
      const requesting = {
        schemaVersion: ATTEMPT_SCHEMA_VERSION,
        planDigest,
        deckId,
        slotId: slot.id,
        slotOrder: slots.findIndex((candidate) => candidate.id === slot.id),
        attempt: attemptNumber,
        requestedCount,
        status: "requesting",
        requestDigest: digestJson({ deckId, slot, requestedCount, excludedFronts, model: generator.model }),
        startedAt: nowIso(clock),
      };
      await writeJsonAtomic(filePath, requesting);
      await writeJsonAtomic(runStatePath, createRunState({ plan, deckPlan, planDigest, slots, attempts: [...effectiveAttempts, requesting], assembly, state: "generating", createdAt, clock }));

      try {
        const generated = await generator.generateBatch({
          deck,
          slot,
          sources: deckPlan.sources,
          requestedCount,
          excludedFronts,
        });
        const completed = {
          ...requesting,
          status: "completed",
          completedAt: nowIso(clock),
          model: generated.model,
          responseId: generated.responseId,
          responseDigest: digestJson(generated.raw),
          usage: generated.usage,
          raw: generated.raw,
        };
        await writeJsonAtomic(filePath, completed);
      } catch (error) {
        const failed = {
          ...requesting,
          status: "failed",
          failedAt: nowIso(clock),
          error: safeAttemptError(error),
        };
        await writeJsonAtomic(filePath, failed);
        if (error?.retryable !== true) throw error;
        const retryIndex = slotAttempts.filter((attempt) => attempt.status === "failed").length;
        await sleep(Math.min(1_000 * 2 ** retryIndex, 30_000));
      }
    }
  });
}

export async function readBatchRunStatus({ runRoot }) {
  const runState = await readJsonIfExists(path.join(runRoot, "run.json"));
  if (runState === null) throw new Error(`batch run 상태가 없다: ${runRoot}`);
  return runState;
}
