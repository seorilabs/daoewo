import { digestJson } from "./io.mjs";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,79}$/;

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateBatchPlan(plan, catalog) {
  const errors = [];
  if (plan?.schemaVersion !== 1) errors.push("batch plan schemaVersion은 1이어야 한다.");
  if (!nonEmptyString(plan?.planId)) errors.push("batch plan planId가 필요하다.");
  if (plan?.slotSize !== 20) errors.push("batch plan slotSize는 20이어야 한다.");
  if (!Array.isArray(plan?.decks) || plan.decks.length !== 3) {
    errors.push("P1 AI batch plan은 정확히 3개 덱이어야 한다.");
    return errors;
  }

  const catalogById = new Map((catalog?.decks ?? []).map((deck) => [deck.id, deck]));
  const deckIds = new Set();
  for (const [deckIndex, deckPlan] of plan.decks.entries()) {
    const scope = `decks[${deckIndex}]`;
    if (!ID_PATTERN.test(deckPlan?.deckId ?? "")) errors.push(`${scope}.deckId 형식이 올바르지 않다.`);
    if (deckIds.has(deckPlan?.deckId)) errors.push(`${scope}.deckId가 중복됐다.`);
    deckIds.add(deckPlan?.deckId);

    const catalogDeck = catalogById.get(deckPlan?.deckId);
    if (
      catalogDeck === undefined ||
      catalogDeck.priority !== "P1" ||
      catalogDeck.tier !== "pro" ||
      catalogDeck.contentStrategy !== "ai-assisted-operator-batch"
    ) {
      errors.push(`${scope}는 manifest의 P1 Pro AI batch 덱이어야 한다.`);
    }
    if (
      !Number.isInteger(deckPlan?.targetCardCount) ||
      deckPlan.targetCardCount < plan.slotSize ||
      deckPlan.targetCardCount % plan.slotSize !== 0
    ) {
      errors.push(`${scope}.targetCardCount는 20의 양수 배수여야 한다.`);
    }

    if (!Array.isArray(deckPlan?.sources) || deckPlan.sources.length === 0) {
      errors.push(`${scope}.sources가 필요하다.`);
      continue;
    }
    const sourceIds = new Set();
    for (const [sourceIndex, source] of deckPlan.sources.entries()) {
      const sourceScope = `${scope}.sources[${sourceIndex}]`;
      if (!ID_PATTERN.test(source?.id ?? "")) errors.push(`${sourceScope}.id 형식이 올바르지 않다.`);
      if (sourceIds.has(source?.id)) errors.push(`${sourceScope}.id가 중복됐다.`);
      sourceIds.add(source?.id);
      for (const field of ["kind", "authority", "revision", "scope"]) {
        if (!nonEmptyString(source?.[field])) errors.push(`${sourceScope}.${field}가 필요하다.`);
      }
      try {
        if (new URL(source?.uri).protocol !== "https:") errors.push(`${sourceScope}.uri는 HTTPS여야 한다.`);
      } catch {
        errors.push(`${sourceScope}.uri가 올바른 URL이 아니다.`);
      }
    }

    if (!Array.isArray(deckPlan?.coverage) || deckPlan.coverage.length === 0) {
      errors.push(`${scope}.coverage가 필요하다.`);
      continue;
    }
    const coverageIds = new Set();
    let slotCount = 0;
    for (const [coverageIndex, coverage] of deckPlan.coverage.entries()) {
      const coverageScope = `${scope}.coverage[${coverageIndex}]`;
      if (!ID_PATTERN.test(coverage?.id ?? "")) errors.push(`${coverageScope}.id 형식이 올바르지 않다.`);
      if (coverageIds.has(coverage?.id)) errors.push(`${coverageScope}.id가 중복됐다.`);
      coverageIds.add(coverage?.id);
      if (!Number.isInteger(coverage?.slots) || coverage.slots < 1) {
        errors.push(`${coverageScope}.slots는 1 이상의 정수여야 한다.`);
      } else {
        slotCount += coverage.slots;
      }
      if (!nonEmptyString(coverage?.instruction)) errors.push(`${coverageScope}.instruction이 필요하다.`);
      if (!Array.isArray(coverage?.sourceIds) || coverage.sourceIds.length === 0) {
        errors.push(`${coverageScope}.sourceIds가 필요하다.`);
      } else {
        if (new Set(coverage.sourceIds).size !== coverage.sourceIds.length) {
          errors.push(`${coverageScope}.sourceIds가 중복됐다.`);
        }
        for (const sourceId of coverage.sourceIds) {
          if (!sourceIds.has(sourceId)) errors.push(`${coverageScope}가 allowlist 밖 source ${String(sourceId)}를 참조한다.`);
        }
      }
    }
    if (slotCount * plan.slotSize !== deckPlan.targetCardCount) {
      errors.push(`${scope} coverage 합계가 targetCardCount와 다르다.`);
    }
  }
  return errors;
}

export function assertBatchPlan(plan, catalog) {
  const errors = validateBatchPlan(plan, catalog);
  if (errors.length > 0) throw new Error(`P1 AI batch plan 검증 실패:\n- ${errors.join("\n- ")}`);
}

export function getDeckBatchPlan(plan, deckId) {
  const deckPlan = plan.decks.find((candidate) => candidate.deckId === deckId);
  if (deckPlan === undefined) throw new Error(`P1 AI batch plan에 없는 deck id: ${deckId}`);
  return deckPlan;
}

export function expandCoverageSlots(plan, deckPlan) {
  const slots = [];
  for (const coverage of deckPlan.coverage) {
    for (let index = 0; index < coverage.slots; index += 1) {
      slots.push(Object.freeze({
        id: `${coverage.id}-${String(index + 1).padStart(2, "0")}`,
        coverageId: coverage.id,
        instruction: coverage.instruction,
        sourceIds: Object.freeze([...coverage.sourceIds]),
        targetCardCount: plan.slotSize,
      }));
    }
  }
  return Object.freeze(slots);
}

export function batchPlanDigest(plan, deckPlan) {
  return digestJson({
    schemaVersion: plan.schemaVersion,
    planId: plan.planId,
    slotSize: plan.slotSize,
    deck: deckPlan,
  });
}
