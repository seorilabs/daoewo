import {
  createInitialCardProgress,
  type Entitlement,
} from "@daoewo/product-core";
import { describe, expect, it } from "vitest";
import type {
  Clock,
  DeckMetadata,
  DeckProgress,
  DeliveryWindow,
  StudyGoal,
} from "../../src/domain/types.js";
import type {
  DeliveryReservationInput,
  ProgressCommitInput,
  StudyRepository,
} from "../../src/repositories/contracts.js";
import { StudyService } from "../../src/services/study-service.js";
import { BackendError } from "../../src/errors.js";

const NOW = new Date("2026-07-12T03:00:00.000Z");

describe("StudyService", () => {
  it("delivers only today's assignment plus due review and never a future card", async () => {
    const repository = new FakeStudyRepository();
    repository.progress = progressWithDueCard();
    const service = createService(repository, {
      plan: "pro",
      source: "app-store",
      validUntil: "2026-08-01T00:00:00.000Z",
    });

    const result = await service.deliverTodayWindow("user-a", {
      goalId: "deck-pro",
      deviceId: "stable-device-id-1234",
    });

    expect(result.cards.map((card) => card.index)).toEqual([0, 1, 3]);
    expect(result.cards.map((card) => card.index)).not.toContain(2);
    expect(Date.parse(result.expiresAt) - Date.parse(result.issuedAt)).toBe(24 * 60 * 60 * 1_000);
    expect(repository.lastReservation).toMatchObject({
      hardUserDailyLimit: null,
      premiumUserDailySoftCap: 600,
      premiumDeviceDailySoftCap: 300,
    });
    expect(repository.lastReservation?.window.deviceHash).not.toBe("stable-device-id-1234");
  });

  it("never returns premium content without a server entitlement", async () => {
    const repository = new FakeStudyRepository();
    let contentRead = false;
    const service = new StudyService(
      repository,
      {
        getCardsByIndexes: async () => {
          contentRead = true;
          return [];
        },
      },
      { getEntitlement: async () => null },
      fixedClock,
    );

    await expect(
      service.deliverTodayWindow("user-a", {
        goalId: "deck-pro",
        deviceId: "stable-device-id-1234",
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(contentRead).toBe(false);
  });

  it("enforces one active deck after a Pro entitlement expires", async () => {
    const repository = new FakeStudyRepository();
    repository.deck.tier = "free";
    repository.freeGoalAllowed = false;
    const service = new StudyService(
      repository,
      { getCardsByIndexes: async () => [] },
      { getEntitlement: async () => null },
      fixedClock,
    );

    await expect(
      service.deliverTodayWindow("user-a", {
        goalId: "deck-pro",
        deviceId: "stable-device-id-1234",
      }),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("blocks Free pull/push from a non-primary device", async () => {
    const repository = new FakeStudyRepository();
    repository.deck.tier = "free";
    repository.deviceAccessError = new BackendError(
      "permission-denied",
      "Free cloud sync is bound to another primary device.",
    );
    const service = new StudyService(
      repository,
      { getCardsByIndexes: async () => [] },
      { getEntitlement: async () => null },
      fixedClock,
    );

    await expect(
      service.pullSyncState("user-a", { deviceId: "secondary-device-1234" }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(repository.deviceAccessCalls[0]).toMatchObject({ pro: false });
  });

  it("submits only window cards and applies product-core SRS in one batch", async () => {
    const repository = new FakeStudyRepository();
    const service = createService(repository, {
      plan: "pro",
      source: "google-play",
      validUntil: null,
    });
    const delivered = await service.deliverTodayWindow("user-a", {
      goalId: "deck-pro",
      deviceId: "stable-device-id-1234",
    });

    const result = await service.submitProgressBatch("user-a", {
      batchId: "batch_12345678",
      windowId: delivered.windowId,
      deviceId: "stable-device-id-1234",
      answers: [{ cardId: "card-0", rating: "missed" }],
    });

    expect(result.idempotent).toBe(false);
    expect(result.progress.cards["card-0"]?.cardIndex).toBe(0);
    expect(result.progress.cards["card-0"]?.state.lastOutcome).toBe("missed");
    expect(result.progress.cards["card-0"]?.state.nextReviewAt).toBe(
      "2026-07-12T03:10:00.000Z",
    );

    const nextWindow = await service.deliverTodayWindow("user-a", {
      goalId: "deck-pro",
      deviceId: "stable-device-id-1234",
    });
    expect(nextWindow.cards.map((card) => card.id)).toEqual(["card-1"]);

    await expect(
      service.submitProgressBatch("user-a", {
        batchId: "batch_87654321",
        windowId: delivered.windowId,
        deviceId: "stable-device-id-1234",
        answers: [{ cardId: "card-not-issued", rating: "easy" }],
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});

const fixedClock: Clock = { now: () => new Date(NOW) };

function createService(
  repository: FakeStudyRepository,
  entitlement: Entitlement,
): StudyService {
  return new StudyService(
    repository,
    {
      getCardsByIndexes: async (_deck, indexes) =>
        indexes.map((index) => ({
          id: `card-${index}`,
          index,
          front: `front-${index}`,
          back: `back-${index}`,
        })),
    },
    { getEntitlement: async () => entitlement },
    fixedClock,
  );
}

class FakeStudyRepository implements StudyRepository {
  readonly deck: DeckMetadata = {
    id: "deck-pro",
    title: "Pro deck",
    description: "Protected",
    category: "exam",
    language: "ko",
    tier: "pro",
    status: "published",
    version: 1,
    cardCount: 4,
    chunkSize: 200,
    tags: [],
    publishedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  readonly goal: StudyGoal = {
    id: "deck-pro",
    uid: "user-a",
    deckId: "deck-pro",
    deckVersion: 1,
    active: true,
    targetCount: 4,
    dailyTarget: 2,
    startDate: "2026-07-12",
    timezone: "Asia/Seoul",
    assignments: {
      "2026-07-12": [0, 1],
      "2026-07-13": [2],
    },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    revision: 1,
  };
  progress: DeckProgress | null = null;
  window: DeliveryWindow | null = null;
  lastReservation: DeliveryReservationInput | null = null;
  freeGoalAllowed = true;
  deviceAccessError: BackendError | null = null;
  deviceAccessCalls: Array<{ uid: string; deviceHash: string; pro: boolean }> = [];

  async listPublishedDecks() {
    return [this.deck];
  }
  async getDeck() {
    return this.deck;
  }
  async getGoal() {
    return this.goal;
  }
  async isFreeActiveGoalAllowed() {
    return this.freeGoalAllowed;
  }
  async createOrResetGoal(input: { goal: StudyGoal }) {
    return input.goal;
  }
  async deactivateGoal() {}
  async getProgress() {
    return this.progress;
  }
  async reserveDelivery(input: DeliveryReservationInput) {
    this.lastReservation = input;
    this.window = input.window;
    return input.window;
  }
  async getDeliveryWindow(uid: string) {
    return this.window?.uid === uid ? this.window : null;
  }
  async commitProgress(input: ProgressCommitInput) {
    const current =
      this.progress ??
      emptyProgress(input.uid, this.deck.id, this.deck.version, input.now.toISOString());
    const prior = current.recentBatches[input.batchId];
    if (prior !== undefined) {
      return {
        idempotent: true,
        progress: current,
        receipt: { batchId: input.batchId, ...prior },
      };
    }
    const next = input.calculate(current, input.answers);
    const receipt = {
      batchId: input.batchId,
      submittedAt: input.now.toISOString(),
      updatedCount: input.answers.length,
      windowId: input.windowId,
    };
    next.recentBatches[input.batchId] = receipt;
    this.progress = next;
    return { idempotent: false, progress: next, receipt };
  }
  async ensureDeviceAccess(uid: string, deviceHash: string, pro: boolean) {
    this.deviceAccessCalls.push({ uid, deviceHash, pro });
    if (this.deviceAccessError !== null) throw this.deviceAccessError;
  }
  async getSyncState() {
    return {
      goals: [this.goal],
      progress: this.progress === null ? [] : [this.progress],
    };
  }
}

function emptyProgress(
  uid: string,
  deckId: string,
  deckVersion: number,
  now: string,
): DeckProgress {
  return {
    uid,
    deckId,
    deckVersion,
    cards: {},
    deliveredCardIds: [],
    recentBatches: {},
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function progressWithDueCard(): DeckProgress {
  const initial = createInitialCardProgress(
    "card-3",
    "deck-pro",
    new Date("2026-07-11T00:00:00Z"),
  );
  const due = { ...initial, nextReviewAt: "2026-07-12T02:00:00.000Z" };
  return {
    ...emptyProgress("user-a", "deck-pro", 1, "2026-07-11T00:00:00.000Z"),
    cards: { "card-3": { cardIndex: 3, state: due } },
  };
}
