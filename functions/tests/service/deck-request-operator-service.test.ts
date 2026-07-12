import { describe, expect, it, vi } from "vitest";
import type { DeckRequestRecord } from "../../src/domain/types.js";
import type { DeckRequestOperatorRepository } from "../../src/repositories/contracts.js";
import { DeckRequestOperatorService } from "../../src/services/deck-request-operator-service.js";

const NOW = new Date("2026-07-13T03:04:05.000Z");

describe("DeckRequestOperatorService", () => {
  it("passes only a verified operator completion to the repository", async () => {
    const request = readyRequest();
    const repository: DeckRequestOperatorRepository = {
      completeDeckRequest: vi.fn(async () => ({ request, idempotent: false })),
    };
    const service = new DeckRequestOperatorService(repository, {
      now: () => NOW,
    });

    await expect(
      service.complete(
        { uid: "operator-a", operatorClaim: true },
        { requestId: "request-a", readyDeckId: "published-deck" },
      ),
    ).resolves.toEqual({ request, idempotent: false });
    expect(repository.completeDeckRequest).toHaveBeenCalledWith({
      requestId: "request-a",
      readyDeckId: "published-deck",
      now: NOW,
    });
  });

  it("rejects normal, missing, string, and anonymous claims before repository access", async () => {
    const completeDeckRequest = vi.fn();
    const service = new DeckRequestOperatorService(
      { completeDeckRequest },
      { now: () => NOW },
    );

    for (const actor of [
      { uid: "user-a", operatorClaim: false },
      { uid: "user-a", operatorClaim: undefined },
      { uid: "user-a", operatorClaim: "true" },
      { uid: "", operatorClaim: true },
    ]) {
      await expect(
        service.complete(actor, {
          requestId: "request-a",
          readyDeckId: "published-deck",
        }),
      ).rejects.toMatchObject({
        code: "permission-denied",
        details: { kind: "operator-claim-required" },
      });
    }
    expect(completeDeckRequest).not.toHaveBeenCalled();
  });
});

function readyRequest(): DeckRequestRecord {
  return {
    id: "request-a",
    uid: "requester-a",
    topic: "관세법",
    category: "시험",
    language: "ko",
    status: "ready",
    priority: "normal",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: NOW.toISOString(),
    readyDeckId: "published-deck",
    readyRevision: 1,
    readyAt: NOW.toISOString(),
  };
}
