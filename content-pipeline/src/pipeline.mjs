import { access, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { digestJson, writeJsonAtomic } from "./io.mjs";
import { dedupeCards, normalizeCards } from "./normalize.mjs";
import { runCopyrightQa, runFactualQa, runSafetyQa } from "./qa.mjs";
import { advance, approveByHuman } from "./state-machine.mjs";
import { assertCards, validateDeck, ValidationError } from "./validation.mjs";

function assertDeck(deck) {
  const errors = validateDeck(deck);
  if (errors.length > 0) throw new ValidationError(`덱 ${deck.id ?? "unknown"}`, errors);
}

function nowIso(clock) {
  return clock().toISOString();
}

export async function runToHumanApproval({ deck, generator, outputFile, clock = () => new Date() }) {
  assertDeck(deck);
  if (deck.status !== "planned") throw new Error("새 파이프라인 실행은 planned 덱에서 시작해야 한다.");

  const raw = await generator.generate({ deck });
  if (raw?.deckId !== deck.id || !Array.isArray(raw?.cards) || raw.cards.length === 0) {
    throw new Error(`생성 결과가 덱 ${deck.id}와 일치하지 않거나 cards가 비어 있다.`);
  }

  const inputDigest = digestJson(raw);
  let record = {
    schemaVersion: 1,
    fixtureOnly: raw.fixtureOnly === true,
    deck: {
      ...deck,
      provenance: {
        ...deck.provenance,
        kind: deck.contentStrategy === "vocab-swipe-import" ? "imported" : "ai-assisted",
        inputDigest,
        generatedBy: generator.name,
      },
    },
    cards: raw.cards,
    sourceRegistry: raw.sourceRegistry ?? [],
    referenceTexts: raw.referenceTexts ?? [],
    qa: {},
    dedupe: { removed: [], conflicts: [] },
    workflow: {
      state: "planned",
      history: [{ from: null, to: "planned", at: nowIso(clock), actor: "operator-cli" }],
    },
  };

  record = advance(record, "generated", { actor: generator.name, inputDigest }, clock());
  record = { ...record, cards: normalizeCards(deck.id, record.cards) };
  record = advance(record, "normalized", { actor: "normalizer-v1" }, clock());

  const deduplicated = dedupeCards(record.cards);
  if (deduplicated.conflicts.length > 0) {
    throw new Error(`동일 front에 다른 back이 있는 충돌 카드 ${deduplicated.conflicts.length}건을 사람이 해소해야 한다.`);
  }
  record = { ...record, cards: deduplicated.cards, dedupe: { removed: deduplicated.removed, conflicts: [] } };
  assertCards(record.cards);
  record = advance(record, "deduplicated", { actor: "dedupe-v1", removed: deduplicated.removed.length }, clock());

  const safety = runSafetyQa(record.cards);
  record = { ...record, qa: { ...record.qa, safety } };
  record = advance(record, "safety-qa-passed", { actor: "safety-qa-v1" }, clock());

  const copyright = runCopyrightQa(record.cards, record.referenceTexts);
  record = { ...record, qa: { ...record.qa, copyright } };
  record = advance(record, "copyright-qa-passed", { actor: "copyright-qa-v1" }, clock());

  const factual = runFactualQa(record.cards, record.sourceRegistry);
  record = { ...record, qa: { ...record.qa, factual } };
  record = advance(record, "factual-qa-passed", { actor: "factual-qa-v1" }, clock());
  record = advance(record, "awaiting-human-approval", { actor: "operator-cli" }, clock());
  assertDeck(record.deck);

  if (outputFile !== undefined) await writeJsonAtomic(outputFile, record);
  return record;
}

export function approveRecord(record, review) {
  if (Array.isArray(record?.dedupe?.conflicts) && record.dedupe.conflicts.length > 0) {
    throw new Error(`동일 front에 다른 back이 있는 충돌 카드 ${record.dedupe.conflicts.length}건을 해소해야 승인할 수 있다.`);
  }
  const approved = approveByHuman(record, review);
  assertCards(approved.cards);
  assertDeck(approved.deck);
  return approved;
}

export function chunkApprovedRecord(record) {
  if (record.workflow.state !== "approved" || record.deck.reviewer.status !== "approved") {
    throw new Error("사람 승인 완료 덱만 청크로 만들 수 있다.");
  }
  assertCards(record.cards);
  const chunks = [];
  for (let start = 0; start < record.cards.length; start += record.deck.chunkSize) {
    const payload = {
      schemaVersion: 1,
      deckId: record.deck.id,
      version: record.deck.version,
      chunkIndex: chunks.length,
      cards: record.cards.slice(start, start + record.deck.chunkSize),
    };
    chunks.push({ ...payload, checksum: digestJson(payload) });
  }
  const chunkedRecord = advance(record, "chunked", { actor: "chunker-v1", chunkCount: chunks.length });
  assertDeck(chunkedRecord.deck);
  return { record: chunkedRecord, chunks };
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function publishApprovedRecord(record, outputRoot) {
  if (record.workflow.state !== "approved" || record.deck.reviewer.status !== "approved") {
    throw new Error("사람 승인 완료 덱만 배포할 수 있다.");
  }
  if (record.fixtureOnly === true) {
    throw new Error("offline fixture는 배포할 수 없다. revision이 고정된 실제 source로 다시 생성해야 한다.");
  }
  const { record: chunkedRecord, chunks } = chunkApprovedRecord(record);
  const finalRecord = advance(chunkedRecord, "published", { actor: "local-publisher-v1" });
  assertDeck(finalRecord.deck);

  const versionName = `v${finalRecord.deck.version}`;
  const parent = path.join(outputRoot, "decks", finalRecord.deck.id);
  const target = path.join(parent, versionName);
  const staging = path.join(parent, `.${versionName}.${process.pid}.staging`);
  if (await pathExists(target)) throw new Error(`불변 배포 경로가 이미 존재한다: ${target}`);

  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    for (const chunk of chunks) {
      const fileName = `chunk-${String(chunk.chunkIndex).padStart(5, "0")}.json`;
      await writeJsonAtomic(path.join(staging, fileName), chunk);
    }
    const publication = {
      schemaVersion: 1,
      deck: finalRecord.deck,
      cardCount: finalRecord.cards.length,
      chunkCount: chunks.length,
      chunks: chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        checksum: chunk.checksum,
        path: `chunk-${String(chunk.chunkIndex).padStart(5, "0")}.json`,
      })),
      workflow: finalRecord.workflow,
    };
    await writeJsonAtomic(path.join(staging, "manifest.json"), publication);
    await mkdir(parent, { recursive: true });
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  return { record: finalRecord, chunks, target };
}
