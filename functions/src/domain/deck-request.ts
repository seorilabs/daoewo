import type { DeckRequestRecord } from "./types.js";
import { assertBackend } from "../errors.js";

export interface DeckRequestCompletionDecision {
  readonly request: ReadyDeckRequestRecord;
  readonly idempotent: boolean;
}

export type ReadyDeckRequestRecord = DeckRequestRecord & {
  readonly status: "ready";
  readonly readyDeckId: string;
  readonly readyRevision: number;
  readonly readyAt: string;
};

/**
 * queued -> ready 전이의 단일 도메인 규칙이다.
 * 이미 같은 덱으로 완료된 요청만 멱등 성공으로 인정하고, 다른 재완료나 부분 상태는 거부한다.
 */
export function decideDeckRequestCompletion(
  current: DeckRequestRecord,
  readyDeckId: string,
  now: Date,
): DeckRequestCompletionDecision {
  assertBackend(
    /^[A-Za-z0-9_-]{1,128}$/.test(readyDeckId) &&
      Number.isFinite(now.getTime()),
    "invalid-argument",
    "Deck request completion input is invalid.",
  );
  assertReadyFieldsAreConsistent(current);

  if (current.status === "ready") {
    assertBackend(
      current.readyDeckId === readyDeckId,
      "failed-precondition",
      "Deck request is already ready for a different deck.",
      { kind: "deck-request-already-ready" },
    );
    return {
      idempotent: true,
      request: {
        ...current,
        status: "ready",
        readyDeckId: current.readyDeckId!,
        readyRevision: current.readyRevision!,
        readyAt: current.readyAt!,
      },
    };
  }

  const isoNow = now.toISOString();
  return {
    idempotent: false,
    request: {
      ...current,
      status: "ready",
      readyDeckId,
      readyRevision: 1,
      readyAt: isoNow,
      updatedAt: isoNow,
    },
  };
}

function assertReadyFieldsAreConsistent(request: DeckRequestRecord): void {
  const fields = [
    request.readyDeckId !== undefined,
    request.readyRevision !== undefined,
    request.readyAt !== undefined,
  ];
  if (request.status === "queued") {
    assertBackend(
      fields.every((present) => !present),
      "failed-precondition",
      "Queued deck request contains ready state.",
      { kind: "deck-request-state-invalid" },
    );
    return;
  }

  assertBackend(
    fields.every(Boolean) &&
      typeof request.readyDeckId === "string" &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(request.readyDeckId) &&
      Number.isSafeInteger(request.readyRevision) &&
      (request.readyRevision ?? 0) > 0 &&
      Number.isFinite(Date.parse(request.readyAt ?? "")),
    "failed-precondition",
    "Ready deck request is incomplete.",
    { kind: "deck-request-state-invalid" },
  );
}
