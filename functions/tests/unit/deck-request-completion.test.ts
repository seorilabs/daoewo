import { describe, expect, it } from "vitest";
import { decideDeckRequestCompletion } from "../../src/domain/deck-request.js";
import type { DeckRequestRecord } from "../../src/domain/types.js";

const NOW = new Date("2026-07-13T03:04:05.000Z");

describe("deck request completion decision", () => {
  it("creates one complete queued -> ready state", () => {
    expect(
      decideDeckRequestCompletion(queuedRequest(), "published-deck", NOW),
    ).toEqual({
      idempotent: false,
      request: {
        ...queuedRequest(),
        status: "ready",
        readyDeckId: "published-deck",
        readyRevision: 1,
        readyAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    });
  });

  it("accepts the same completed target idempotently without changing readyAt or revision", () => {
    const ready = readyRequest("published-deck");

    expect(
      decideDeckRequestCompletion(
        ready,
        "published-deck",
        new Date("2026-07-14T00:00:00.000Z"),
      ),
    ).toEqual({ request: ready, idempotent: true });
  });

  it("rejects a different target and every partial ready state", () => {
    expect(() =>
      decideDeckRequestCompletion(
        readyRequest("published-deck"),
        "other-deck",
        NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: "failed-precondition" }));

    for (const partial of [
      { readyDeckId: "published-deck" },
      { readyRevision: 1 },
      { readyAt: NOW.toISOString() },
    ]) {
      expect(() =>
        decideDeckRequestCompletion(
          { ...queuedRequest(), ...partial },
          "published-deck",
          NOW,
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "failed-precondition",
          details: { kind: "deck-request-state-invalid" },
        }),
      );
    }

    for (const malformed of [
      {
        ...queuedRequest(),
        status: "ready" as const,
        readyDeckId: "published-deck",
      },
      { ...readyRequest("published-deck"), readyRevision: 0 },
      { ...readyRequest("published-deck"), readyAt: "not-a-date" },
    ]) {
      expect(() =>
        decideDeckRequestCompletion(malformed, "published-deck", NOW),
      ).toThrowError(
        expect.objectContaining({
          code: "failed-precondition",
          details: { kind: "deck-request-state-invalid" },
        }),
      );
    }
  });
});

function queuedRequest(): DeckRequestRecord {
  return {
    id: "request-a",
    uid: "requester-a",
    topic: "관세법",
    category: "시험",
    language: "ko",
    status: "queued",
    priority: "normal",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
}

function readyRequest(readyDeckId: string): DeckRequestRecord {
  return {
    ...queuedRequest(),
    status: "ready",
    readyDeckId,
    readyRevision: 1,
    readyAt: "2026-07-12T12:00:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
  };
}
