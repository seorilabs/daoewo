import { createInitialCardProgress } from "@daoewo/product-core";
import { describe, expect, it } from "vitest";
import {
  mergeLearningBackupSnapshots,
} from "../../src/domain/learning-backup.js";
import type {
  LearningBackupSnapshot,
} from "../../src/domain/types.js";

describe("learning backup merge", () => {
  it("merges stale devices deterministically and keeps the newer card/session", () => {
    const first = snapshot("a", "2026-07-12T01:00:00.000Z");
    const second = snapshot("b", "2026-07-12T02:00:00.000Z");

    const left = mergeLearningBackupSnapshots(first, second, false);
    const right = mergeLearningBackupSnapshots(second, first, false);

    expect(left).toEqual(right);
    expect(left.freeDecks[0]?.progresses[0]?.state.updatedAt).toBe(
      "2026-07-12T02:00:00.000Z",
    );
    expect(left.sessions.map((session) => session.id)).toEqual([
      "session-a",
      "session-b",
    ]);
  });

  it("lets a push based on the current revision carry the active-goal intent", () => {
    const current = snapshot("a", "2026-07-12T02:00:00.000Z");
    const incoming: LearningBackupSnapshot = {
      ...snapshot("b", "2026-07-12T01:00:00.000Z"),
      freeDecks: [
        {
          ...snapshot("b", "2026-07-12T01:00:00.000Z").freeDecks[0]!,
          active: false,
          goal: null,
        },
      ],
    };

    const merged = mergeLearningBackupSnapshots(current, incoming, true);

    expect(merged.freeDecks[0]).toMatchObject({ active: false, goal: null });
    expect(merged.freeDecks[0]?.progresses[0]?.state.updatedAt).toBe(
      "2026-07-12T02:00:00.000Z",
    );
  });

  it("does not combine card indexes across different deck versions", () => {
    const old = snapshot("old", "2026-07-12T02:00:00.000Z", "card-old");
    const next: LearningBackupSnapshot = {
      ...snapshot("new", "2026-07-12T01:00:00.000Z", "card-new"),
      freeDecks: [
        {
          ...snapshot("new", "2026-07-12T01:00:00.000Z", "card-new")
            .freeDecks[0]!,
          deckVersion: 2,
        },
      ],
    };

    const merged = mergeLearningBackupSnapshots(old, next, false);

    expect(merged.freeDecks[0]?.deckVersion).toBe(2);
    expect(merged.freeDecks[0]?.progresses[0]?.state.cardId).toBe("card-new");
  });
});

function snapshot(
  id: string,
  updatedAt: string,
  cardId = "card-shared",
): LearningBackupSnapshot {
  return {
    version: 1,
    freeDecks: [
      {
        deckId: "free-deck",
        deckVersion: 1,
        active: true,
        goal: {
          key: "free-deck",
          deckId: "free-deck",
          mode: "daily-count",
          startDate: "2026-07-12",
          totalCount: 1,
          days: 1,
          dailyCount: 1,
          assignments: { "2026-07-12": [cardId] },
        },
        progresses: [
          {
            cardIndex: 0,
            state: {
              ...createInitialCardProgress(
                cardId,
                "free-deck",
                new Date(updatedAt),
              ),
              updatedAt,
            },
          },
        ],
      },
    ],
    sessions: [
      {
        id: `session-${id}`,
        deckId: "free-deck",
        date: "2026-07-12",
        target: 1,
        completed: 1,
        known: 1,
        unknown: 0,
        reviewCount: 0,
        elapsedMs: 100,
        completedAt: updatedAt,
      },
    ],
  };
}
