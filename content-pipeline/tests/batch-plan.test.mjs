import assert from "node:assert/strict";
import test from "node:test";
import { assertBatchPlan, expandCoverageSlots, getDeckBatchPlan, validateBatchPlan } from "../src/batch-plan.mjs";
import { readJson } from "../src/io.mjs";
import { CATALOG_PATH, P1_AI_BATCH_PLAN_PATH } from "../src/paths.mjs";

test("tracked P1 AI plan은 500/320/420 목표를 20장 coverage slot으로 정확히 나눈다", async () => {
  const [catalog, plan] = await Promise.all([readJson(CATALOG_PATH), readJson(P1_AI_BATCH_PLAN_PATH)]);
  assert.doesNotThrow(() => assertBatchPlan(plan, catalog));
  assert.deepEqual(
    Object.fromEntries(plan.decks.map((deck) => [deck.deckId, deck.targetCardCount])),
    {
      "korean-history-cert-core": 500,
      "information-processing-engineer": 320,
      "it-cs-interview-terms": 420,
    },
  );
  assert.deepEqual(
    Object.fromEntries(plan.decks.map((deck) => [deck.deckId, expandCoverageSlots(plan, deck).length])),
    {
      "korean-history-cert-core": 25,
      "information-processing-engineer": 16,
      "it-cs-interview-terms": 21,
    },
  );
  for (const deck of plan.decks) {
    assert.ok(expandCoverageSlots(plan, deck).every((slot) => slot.targetCardCount === 20));
  }
});

test("coverage source는 덱별 고정 HTTPS allowlist 밖을 참조할 수 없다", async () => {
  const [catalog, original] = await Promise.all([readJson(CATALOG_PATH), readJson(P1_AI_BATCH_PLAN_PATH)]);
  const plan = structuredClone(original);
  plan.decks[0].coverage[0].sourceIds.push("model-invented-source");
  assert.ok(validateBatchPlan(plan, catalog).some((error) => error.includes("allowlist 밖")));

  const insecure = structuredClone(original);
  insecure.decks[1].sources[0].uri = "http://example.test/source";
  assert.ok(validateBatchPlan(insecure, catalog).some((error) => error.includes("HTTPS")));
});

test("coverage 합계가 목표 장수와 다르면 plan을 거부한다", async () => {
  const [catalog, plan] = await Promise.all([readJson(CATALOG_PATH), readJson(P1_AI_BATCH_PLAN_PATH)]);
  const broken = structuredClone(plan);
  const deck = getDeckBatchPlan(broken, "it-cs-interview-terms");
  deck.coverage[0].slots -= 1;
  assert.ok(validateBatchPlan(broken, catalog).some((error) => error.includes("coverage 합계")));
});
