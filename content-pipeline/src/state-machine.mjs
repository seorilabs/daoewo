const TRANSITIONS = new Map([
  ["planned", ["generated", "rejected"]],
  ["generated", ["normalized", "rejected"]],
  ["normalized", ["deduplicated", "rejected"]],
  ["deduplicated", ["safety-qa-passed", "rejected"]],
  ["safety-qa-passed", ["copyright-qa-passed", "rejected"]],
  ["copyright-qa-passed", ["factual-qa-passed", "rejected"]],
  ["factual-qa-passed", ["awaiting-human-approval", "rejected"]],
  ["awaiting-human-approval", ["approved", "rejected"]],
  ["approved", ["chunked", "rejected"]],
  ["chunked", ["published", "rejected"]],
  ["published", ["archived"]],
]);

export const HUMAN_REVIEW_CONFIRMATION = "I_REVIEWED_THE_DECK_CONTENT";

export function canTransition(from, to) {
  return TRANSITIONS.get(from)?.includes(to) ?? false;
}

export function advance(record, nextState, detail = {}, now = new Date()) {
  const current = record.workflow.state;
  if (!canTransition(current, nextState)) {
    throw new Error(`허용되지 않은 콘텐츠 상태 전이: ${current} -> ${nextState}`);
  }
  const at = now.toISOString();
  return {
    ...record,
    deck: { ...record.deck, status: nextState },
    workflow: {
      state: nextState,
      history: [...record.workflow.history, { from: current, to: nextState, at, ...detail }],
    },
  };
}

export function approveByHuman(record, { reviewer, evidence, confirmation, reviewedAt = new Date().toISOString() }) {
  if (record.workflow.state !== "awaiting-human-approval") {
    throw new Error("사람 승인은 awaiting-human-approval 상태에서만 가능하다.");
  }
  if (confirmation !== HUMAN_REVIEW_CONFIRMATION) {
    throw new Error(`사람 검수 확인 토큰이 필요하다: ${HUMAN_REVIEW_CONFIRMATION}`);
  }
  if (typeof reviewer !== "string" || reviewer.trim().length < 2) throw new Error("검수자 이름이 필요하다.");
  if (typeof evidence !== "string" || evidence.trim().length < 8) throw new Error("사람 검수 근거 경로 또는 티켓이 필요하다.");
  if (!record.qa?.safety?.passed || !record.qa?.copyright?.passed || !record.qa?.factual?.passed) {
    throw new Error("safety, copyright, factual QA를 모두 통과해야 사람 승인할 수 있다.");
  }

  const withReviewer = {
    ...record,
    deck: {
      ...record.deck,
      reviewer: {
        status: "approved",
        name: reviewer.trim(),
        reviewedAt,
        evidence: evidence.trim(),
      },
    },
  };
  return advance(withReviewer, "approved", { actor: reviewer.trim(), evidence: evidence.trim() }, new Date(reviewedAt));
}
