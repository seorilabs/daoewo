import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { batchPlanDigest, expandCoverageSlots } from "../src/batch-plan.mjs";
import { assembleBatchCards, readBatchRunStatus, runResumableBatch } from "../src/batch-runner.mjs";
import { digestJson, readJson, writeJsonAtomic } from "../src/io.mjs";
import { CATALOG_PATH } from "../src/paths.mjs";

const DECK_ID = "it-cs-interview-terms";
const SOURCE = Object.freeze({
  id: "rfc-http-test",
  kind: "internet-standard",
  authority: "RFC Editor",
  uri: "https://www.rfc-editor.org/rfc/rfc9110.html",
  revision: "RFC9110",
  scope: "테스트용 HTTP 의미론",
});

function makePlan(slotCount = 2) {
  return {
    schemaVersion: 1,
    planId: `batch-runner-test-${slotCount}`,
    slotSize: 20,
    decks: [{
      deckId: DECK_ID,
      targetCardCount: slotCount * 20,
      sources: [{ ...SOURCE }],
      coverage: [{
        id: "http-coverage",
        slots: slotCount,
        instruction: "HTTP 개념을 자체 문장으로 설명한다.",
        sourceIds: [SOURCE.id],
      }],
    }],
  };
}

function rawCard(label, overrides = {}) {
  return {
    front: `질문 ${label}`,
    back: `답변 ${label}`,
    tags: ["HTTP"],
    difficulty: 2,
    sourceRefs: [SOURCE.id],
    ...overrides,
  };
}

function generated(slot, cards, usage = {}) {
  return {
    model: "gemini-test-model",
    responseId: null,
    usage: {
      promptTokenCount: 100,
      candidatesTokenCount: 50,
      thoughtsTokenCount: 10,
      totalTokenCount: 160,
      ...usage,
    },
    raw: { deckId: DECK_ID, slotId: slot.id, cards },
  };
}

async function testContext(t, slotCount = 2) {
  const root = await mkdtemp(path.join(tmpdir(), "daoewo-batch-runner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const catalog = await readJson(CATALOG_PATH);
  return {
    root,
    catalog,
    plan: makePlan(slotCount),
    runRoot: path.join(root, "batch-runs", DECK_ID),
    compatibilityPath: path.join(root, ".work", `${DECK_ID}.json`),
  };
}

test("resumable batch는 실패 뒤 이어서 exact target을 채우고 legacy root를 별도 보존한다", async (t) => {
  const context = await testContext(t, 2);
  const legacy = { schemaVersion: 1, legacy: true, cards: [{ front: "기존 20장 산출물" }] };
  await writeJsonAtomic(context.compatibilityPath, legacy);

  const permanentError = Object.assign(new Error("provider body secret-must-not-persist"), {
    name: "FakeProviderError",
    status: 400,
    retryable: false,
  });
  await assert.rejects(
    () => runResumableBatch({
      ...context,
      deckId: DECK_ID,
      generator: { model: "gemini-test-model", async generateBatch() { throw permanentError; } },
      maxCalls: 5,
      sleep: async () => undefined,
    }),
    /secret-must-not-persist/,
  );
  assert.deepEqual(await readJson(context.compatibilityPath), legacy);
  assert.equal((await readFile(path.join(context.runRoot, "batches/http-coverage-01/attempt-0001.json"), "utf8")).includes("secret-must-not-persist"), false);

  const calls = [];
  const generator = {
    model: "gemini-test-model",
    async generateBatch({ slot, requestedCount }) {
      calls.push({ slotId: slot.id, requestedCount });
      if (slot.id === "http-coverage-01") {
        return generated(slot, Array.from({ length: requestedCount }, (_, index) => rawCard(`A-${index}`)));
      }
      if (requestedCount === 20) {
        return generated(slot, [rawCard("A-0"), ...Array.from({ length: 19 }, (_, index) => rawCard(`B-${index}`))]);
      }
      return generated(slot, [rawCard("B-19")]);
    },
  };
  const result = await runResumableBatch({
    ...context,
    deckId: DECK_ID,
    generator,
    maxCalls: 5,
    sleep: async () => undefined,
  });

  assert.deepEqual(calls, [
    { slotId: "http-coverage-01", requestedCount: 20 },
    { slotId: "http-coverage-02", requestedCount: 20 },
    { slotId: "http-coverage-02", requestedCount: 1 },
  ]);
  assert.equal(result.record.cards.length, 40);
  assert.equal(result.record.workflow.state, "awaiting-human-approval");
  assert.equal(result.record.deck.reviewer.status, "pending");
  assert.deepEqual(result.record.sourceRegistry, context.plan.decks[0].sources);
  assert.deepEqual(result.record.dedupe.conflicts, []);
  assert.equal(result.record.dedupe.removed.length, 1);
  assert.equal(result.runState.calls, 4);
  assert.equal(result.runState.completedCalls, 3);
  assert.equal(result.runState.failedCalls, 1);
  assert.equal(result.runState.usage.totalTokenCount, 480);
  assert.deepEqual(await readJson(context.compatibilityPath), result.record);
  assert.deepEqual(await readJson(path.join(context.runRoot, "record.json")), result.record);
  assert.ok(result.legacyPreserved?.includes(path.join(".work", "legacy", DECK_ID)));
  assert.deepEqual(await readJson(result.legacyPreserved), legacy);

  const completedPath = path.join(context.runRoot, "batches/http-coverage-01/attempt-0002.json");
  const tampered = await readJson(completedPath);
  tampered.raw.cards[0].back = "저장 뒤 변조된 답변";
  await writeJsonAtomic(completedPath, tampered);
  await assert.rejects(
    () => runResumableBatch({ ...context, deckId: DECK_ID, generator, maxCalls: 5 }),
    /응답 digest가 일치하지 않는 completed batch attempt/,
  );
});

test("attempt 무결성은 plan, deck, slot order, requestedCount, response digest를 모두 고정한다", () => {
  const plan = makePlan(1);
  const deckPlan = plan.decks[0];
  const slots = expandCoverageSlots(plan, deckPlan);
  const planDigest = batchPlanDigest(plan, deckPlan);
  const raw = { deckId: DECK_ID, slotId: slots[0].id, cards: [rawCard("valid")] };
  const valid = {
    schemaVersion: 1,
    planDigest,
    deckId: DECK_ID,
    slotId: slots[0].id,
    slotOrder: 0,
    attempt: 1,
    requestedCount: 1,
    status: "completed",
    responseDigest: digestJson(raw),
    raw,
  };
  assert.equal(assembleBatchCards({ deckId: DECK_ID, planDigest, slots, sources: [SOURCE], attempts: [valid] }).cards.length, 1);

  const corruptions = [
    { ...valid, planDigest: "sha256:other-plan" },
    { ...valid, deckId: "korean-history-cert-core" },
    { ...valid, slotOrder: 1 },
    { ...valid, requestedCount: 21 },
    { ...valid, raw: { ...raw, cards: [rawCard("mutated")] } },
  ];
  for (const attempt of corruptions) {
    assert.throws(
      () => assembleBatchCards({ deckId: DECK_ID, planDigest, slots, sources: [SOURCE], attempts: [attempt] }),
      /손상되거나 현재 plan과 일치하지 않는|응답 digest가 일치하지 않는/,
    );
  }
});

test("same-front/different-back 후보는 둘 다 격리하고 부족분을 보충한다", async (t) => {
  const context = await testContext(t, 1);
  const legacy = { legacy: true };
  await writeJsonAtomic(context.compatibilityPath, legacy);
  let calls = 0;
  const generator = {
    model: "gemini-test-model",
    async generateBatch({ slot, requestedCount }) {
      calls += 1;
      if (requestedCount === 2) {
        return generated(slot, [rawCard("replacement-1"), rawCard("replacement-2")]);
      }
      return generated(slot, [
        rawCard("conflict", { front: "HTTP 캐시란?", back: "첫 번째 설명" }),
        rawCard("conflict", { front: "HTTP 캐시란?", back: "서로 다른 두 번째 설명" }),
        ...Array.from({ length: 18 }, (_, index) => rawCard(`unique-${index}`)),
      ]);
    },
  };

  const result = await runResumableBatch({ ...context, deckId: DECK_ID, generator, maxCalls: 2 });
  assert.equal(calls, 2);
  assert.equal(result.record.cards.length, 20);
  assert.deepEqual(result.record.dedupe.conflicts, []);
  assert.equal(result.runState.conflictCount, 0);
  assert.equal(result.runState.rejectedCandidateCount, 2);
  assert.deepEqual(
    result.record.batchRun.rejectedCandidates.map((entry) => entry.reason),
    ["front-conflict", "front-conflict"],
  );
  assert.ok(result.record.cards.every((card) => card.front !== "HTTP 캐시란?"));
});

test("safety와 unresolved placeholder 실패 후보는 격리하고 부족분만 보충한다", async (t) => {
  const context = await testContext(t, 1);
  const requestedCounts = [];
  const generator = {
    model: "gemini-test-model",
    async generateBatch({ slot, requestedCount }) {
      requestedCounts.push(requestedCount);
      if (requestedCount === 20) {
        return generated(slot, [
          rawCard("unsafe", { back: "이 카드만 외우면 무조건 합격한다." }),
          rawCard("placeholder", { back: "TODO 출처를 나중에 채운다." }),
          ...Array.from({ length: 18 }, (_, index) => rawCard(`safe-${index}`)),
        ]);
      }
      return generated(slot, Array.from({ length: requestedCount }, (_, index) => rawCard(`supplement-${index}`)));
    },
  };

  const result = await runResumableBatch({
    ...context,
    deckId: DECK_ID,
    generator,
    maxCalls: 2,
  });
  assert.deepEqual(requestedCounts, [20, 2]);
  assert.equal(result.record.cards.length, 20);
  assert.equal(result.runState.rejectedCandidateCount, 2);
  assert.deepEqual(
    result.record.batchRun.rejectedCandidates.map((entry) => entry.reason).sort(),
    ["factual", "safety"],
  );
  assert.ok(result.record.cards.every((card) => !/무조건 합격|TODO/.test(`${card.front} ${card.back}`)));
  assert.equal(result.record.qa.safety.passed, true);
  assert.equal(result.record.qa.factual.passed, true);
});

test("requesting attempt는 명시적 retry-uncertain 전에는 재호출하지 않는다", async (t) => {
  const context = await testContext(t, 1);
  const deckPlan = context.plan.decks[0];
  const slots = expandCoverageSlots(context.plan, deckPlan);
  const planDigest = batchPlanDigest(context.plan, deckPlan);
  const attemptPath = path.join(context.runRoot, "batches", slots[0].id, "attempt-0001.json");
  await mkdir(path.dirname(attemptPath), { recursive: true });
  await writeJsonAtomic(attemptPath, {
    schemaVersion: 1,
    planDigest,
    deckId: DECK_ID,
    slotId: slots[0].id,
    slotOrder: 0,
    attempt: 1,
    requestedCount: 20,
    status: "requesting",
    requestDigest: "sha256:requesting-test",
    startedAt: new Date(0).toISOString(),
  });
  let calls = 0;
  const generator = {
    model: "gemini-test-model",
    async generateBatch({ slot, requestedCount }) {
      calls += 1;
      return generated(slot, Array.from({ length: requestedCount }, (_, index) => rawCard(`retry-${index}`)));
    },
  };
  await assert.rejects(
    () => runResumableBatch({ ...context, deckId: DECK_ID, generator, maxCalls: 3 }),
    /--retry-uncertain/,
  );
  assert.equal(calls, 0);

  const result = await runResumableBatch({
    ...context,
    deckId: DECK_ID,
    generator,
    maxCalls: 3,
    retryUncertain: true,
  });
  assert.equal(calls, 1);
  assert.equal(result.record.cards.length, 20);
  assert.equal(result.runState.calls, 2);
  assert.equal((await readJson(attemptPath)).error.name, "UncertainAttempt");
});
