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
  LearningBackupEnvelope,
  StudyGoal,
} from "../../src/domain/types.js";
import type {
  DeliveryReservationInput,
  LearningBackupReconcileInput,
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

  it("accepts the dotted hash card IDs produced by the content pipeline", async () => {
    const repository = new FakeStudyRepository();
    const service = new StudyService(
      repository,
      {
        getCardsByIndexes: async (_deck, indexes) =>
          indexes.map((index) => ({
            id: `deck-pro.hash-${index}`,
            index,
            front: `front-${index}`,
            back: `back-${index}`,
          })),
      },
      {
        getEntitlement: async () => ({
          plan: "pro",
          source: "google-play",
          validUntil: null,
        }),
      },
      fixedClock,
    );
    const window = await service.deliverTodayWindow("user-a", {
      goalId: "deck-pro",
      deviceId: "stable-device-id-1234",
    });

    await expect(
      service.submitProgressBatch("user-a", {
        batchId: "batch_dotted_1234",
        windowId: window.windowId,
        deviceId: "stable-device-id-1234",
        answers: [{ cardId: "deck-pro.hash-0", rating: "easy" }],
      }),
    ).resolves.toMatchObject({
      progress: { cards: { "deck-pro.hash-0": { cardIndex: 0 } } },
    });
  });

  it("backs up verified Free card identities on the bound primary device", async () => {
    const repository = new FakeStudyRepository();
    repository.deck.tier = "free";
    const service = new StudyService(
      repository,
      {
        getCardsByIndexes: async (_deck, indexes) =>
          indexes.map((index) => ({
            id: `card-${index}`,
            index,
            front: "server-only front",
            back: "server-only back",
          })),
      },
      { getEntitlement: async () => null },
      fixedClock,
    );
    const progress = createInitialCardProgress("card-0", "deck-pro", NOW);

    const result = await service.pushLearningBackup("user-a", {
      deviceId: "stable-device-id-1234",
      baseRevision: 0,
      mutationId: "sync_mutation_1234",
      snapshot: {
        version: 1,
        freeDecks: [
          {
            deckId: "deck-pro",
            deckVersion: 1,
            active: true,
            goal: {
              key: "deck-pro",
              deckId: "deck-pro",
              mode: "daily-count",
              startDate: "2026-07-12",
              totalCount: 4,
              days: 1,
              dailyCount: 4,
              assignments: {
                "2026-07-12": ["card-0", "card-1", "card-2", "card-3"],
              },
            },
            progresses: [{ cardIndex: 0, state: progress }],
          },
        ],
        sessions: [],
      },
    });

    expect(repository.lastLearningBackup).toMatchObject({
      uid: "user-a",
      baseRevision: 0,
      mutationId: "sync_mutation_1234",
      maxActiveFreeDecks: 1,
    });
    expect(result.learningBackup.snapshot.freeDecks[0]?.progresses[0]).toMatchObject({
      cardIndex: 0,
      state: { cardId: "card-0" },
    });
    expect(JSON.stringify(result.learningBackup)).not.toContain("server-only front");
  });

  it("rejects Pro decks and forged card-index pairs from client backup", async () => {
    const repository = new FakeStudyRepository();
    const service = createService(repository, {
      plan: "pro",
      source: "app-store",
      validUntil: null,
    });
    const input = {
      deviceId: "stable-device-id-1234",
      baseRevision: 0,
      mutationId: "sync_mutation_1234",
      snapshot: {
        version: 1 as const,
        freeDecks: [
          {
            deckId: "deck-pro",
            deckVersion: 1,
            active: false,
            goal: null,
            progresses: [
              {
                cardIndex: 0,
                state: createInitialCardProgress("forged", "deck-pro", NOW),
              },
            ],
          },
        ],
        sessions: [],
      },
    };

    await expect(service.pushLearningBackup("user-a", input)).rejects.toMatchObject({
      code: "failed-precondition",
    });
    repository.deck.tier = "free";
    await expect(service.pushLearningBackup("user-a", input)).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(repository.lastLearningBackup).toBeNull();
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
  lastLearningBackup: LearningBackupReconcileInput | null = null;
  learningBackup: LearningBackupEnvelope = {
    revision: 0,
    updatedAt: "1970-01-01T00:00:00.000Z",
    snapshot: { version: 1, freeDecks: [], sessions: [] },
  };

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
  async reconcileLearningBackup(input: LearningBackupReconcileInput) {
    this.lastLearningBackup = input;
    this.learningBackup = {
      revision: this.learningBackup.revision + 1,
      updatedAt: input.now.toISOString(),
      lastMutationId: input.mutationId,
      snapshot: input.snapshot,
    };
    return this.learningBackup;
  }
  async getSyncState() {
    return {
      goals: [this.goal],
      progress: this.progress === null ? [] : [this.progress],
      learningBackup: this.learningBackup,
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
