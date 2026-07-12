import {
  calculateNextReview,
  createInitialCardProgress,
  isEntitled,
  type ReviewRating,
} from "@daoewo/product-core";
import { randomUUID } from "node:crypto";
import { BACKEND_CONFIG } from "../config.js";
import type {
  Clock,
  DeckProgress,
  DeliveryWindow,
  LearningBackupFreeDeck,
  ProgressAnswer,
  PushLearningBackupInput,
  StudyCard,
} from "../domain/types.js";
import { assertBackend } from "../errors.js";
import type {
  DeckContentRepository,
  EntitlementRepository,
  ProgressCommitResult,
  StudyRepository,
} from "../repositories/contracts.js";
import { sha256 } from "../utils/hash.js";
import { addHours, localDateKey, utcDateKey } from "../utils/time.js";

export interface DeliverTodayWindowInput {
  goalId: string;
  deviceId: string;
}

export interface DeliveredTodayWindow {
  windowId: string;
  deckId: string;
  deckVersion: number;
  dateKey: string;
  cards: StudyCard[];
  issuedAt: string;
  expiresAt: string;
}

export interface SubmitProgressBatchInput {
  batchId: string;
  windowId: string;
  deviceId: string;
  answers: ProgressAnswer[];
}

export interface PullSyncStateInput {
  deviceId: string;
}

const RATINGS = new Set<ReviewRating>(["easy", "confused", "missed"]);

export class StudyService {
  constructor(
    private readonly repository: StudyRepository,
    private readonly content: DeckContentRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly clock: Clock,
  ) {}

  async deliverTodayWindow(
    uid: string,
    input: DeliverTodayWindowInput,
  ): Promise<DeliveredTodayWindow> {
    const [goal, entitlement] = await Promise.all([
      this.repository.getGoal(uid, input.goalId),
      this.entitlements.getEntitlement(uid),
    ]);
    assertBackend(goal !== null && goal.active, "not-found", "Active study goal not found.");
    const deck = await this.repository.getDeck(goal.deckId);
    assertBackend(deck !== null && deck.status === "published", "not-found", "Deck not found.");
    assertBackend(
      deck.version === goal.deckVersion,
      "failed-precondition",
      "The deck was republished. Reset the goal before continuing.",
    );

    const now = this.clock.now();
    const pro = entitlement !== null && isEntitled(entitlement, now);
    const premium = deck.tier === "pro";
    assertBackend(
      !premium || pro,
      "permission-denied",
      "An active Pro entitlement is required for this deck.",
    );
    if (!pro) {
      assertBackend(
        await this.repository.isFreeActiveGoalAllowed(uid, goal.id),
        "failed-precondition",
        "Free plans can study only the most recently active deck.",
        { kind: "active-goal-limit", limit: 1 },
      );
    }
    await this.repository.ensureDeviceAccess(uid, sha256(input.deviceId), pro, now);

    const dateKey = localDateKey(now, goal.timezone);
    const storedProgress = await this.repository.getProgress(uid, deck.id);
    const progress =
      storedProgress?.deckVersion === deck.version ? storedProgress : null;
    const existingIndexes = new Set(
      Object.values(progress?.cards ?? {}).map(({ cardIndex }) => cardIndex),
    );
    const scheduledIndexes = (goal.assignments[dateKey] ?? []).filter(
      (index) => !existingIndexes.has(index),
    );
    const dueIndexes = Object.values(progress?.cards ?? {})
      .filter(
        ({ state }) =>
          state.status !== "suspended" &&
          typeof state.nextReviewAt === "string" &&
          Date.parse(state.nextReviewAt) <= now.getTime(),
      )
      .map(({ cardIndex }) => cardIndex);
    const indexes = [...new Set([...scheduledIndexes, ...dueIndexes])].sort((a, b) => a - b);
    const cards = await this.content.getCardsByIndexes(deck, indexes);
    const issuedAt = now.toISOString();
    const ttlHours = premium
      ? BACKEND_CONFIG.premiumWindowTtlHours
      : BACKEND_CONFIG.freeWindowTtlHours;
    const window: DeliveryWindow = {
      id: randomUUID(),
      uid,
      goalId: goal.id,
      deckId: deck.id,
      deckVersion: deck.version,
      dateKey,
      quotaDateKey: utcDateKey(now),
      premium,
      deviceHash: sha256(input.deviceId),
      cardIds: cards.map((card) => card.id),
      cardIndexes: cards.map((card) => card.index),
      issuedAt,
      expiresAt: addHours(now, ttlHours).toISOString(),
    };

    const reserved = await this.repository.reserveDelivery({
      window,
      cards,
      hardUserDailyLimit: premium ? null : BACKEND_CONFIG.freeDailyCardLimit,
      premiumUserDailySoftCap: premium
        ? BACKEND_CONFIG.premiumUserDailySoftCap
        : null,
      premiumDeviceDailySoftCap: premium
        ? BACKEND_CONFIG.premiumDeviceDailySoftCap
        : null,
    });

    return {
      windowId: reserved.id,
      deckId: reserved.deckId,
      deckVersion: reserved.deckVersion,
      dateKey: reserved.dateKey,
      cards,
      issuedAt: reserved.issuedAt,
      expiresAt: reserved.expiresAt,
    };
  }

  async submitProgressBatch(
    uid: string,
    input: SubmitProgressBatchInput,
  ): Promise<ProgressCommitResult> {
    assertBackend(input.answers.length > 0, "invalid-argument", "answers must not be empty.");
    const ids = new Set<string>();
    for (const answer of input.answers) {
      assertBackend(
        /^[A-Za-z0-9._:-]{1,128}$/.test(answer.cardId),
        "invalid-argument",
        "answer.cardId is invalid.",
      );
      assertBackend(RATINGS.has(answer.rating), "invalid-argument", "answer.rating is invalid.");
      assertBackend(!ids.has(answer.cardId), "invalid-argument", "answers contain duplicate cards.");
      ids.add(answer.cardId);
    }

    const [window, entitlement] = await Promise.all([
      this.repository.getDeliveryWindow(uid, input.windowId),
      this.entitlements.getEntitlement(uid),
    ]);
    assertBackend(window !== null, "not-found", "Delivery window not found.");
    const now = this.clock.now();
    const deviceHash = sha256(input.deviceId);
    assertBackend(
      window.deviceHash === deviceHash,
      "permission-denied",
      "Progress must be submitted from the device that received the window.",
    );
    const pro = entitlement !== null && isEntitled(entitlement, now);
    await this.repository.ensureDeviceAccess(uid, deviceHash, pro, now);
    assertBackend(
      Date.parse(window.expiresAt) > now.getTime(),
      "failed-precondition",
      "Delivery window has expired.",
    );
    const indexByCardId = new Map(
      window.cardIds.map((cardId, index) => [cardId, window.cardIndexes[index] ?? -1]),
    );
    for (const answer of input.answers) {
      assertBackend(
        indexByCardId.has(answer.cardId),
        "permission-denied",
        "Progress can only be submitted for cards in the current window.",
      );
    }

    return this.repository.commitProgress({
      uid,
      batchId: input.batchId,
      windowId: window.id,
      answers: input.answers,
      now,
      calculate: (current, answers) =>
        calculateProgress(current, answers, window, indexByCardId, now),
    });
  }

  async pullSyncState(uid: string, input: PullSyncStateInput) {
    const now = this.clock.now();
    const entitlement = await this.entitlements.getEntitlement(uid);
    const pro = entitlement !== null && isEntitled(entitlement, now);
    await this.repository.ensureDeviceAccess(uid, sha256(input.deviceId), pro, now);
    return this.repository.getSyncState(uid);
  }

  async pushLearningBackup(uid: string, input: PushLearningBackupInput) {
    const now = this.clock.now();
    const entitlement = await this.entitlements.getEntitlement(uid);
    const pro = entitlement !== null && isEntitled(entitlement, now);
    const deviceHash = sha256(input.deviceId);
    await this.repository.ensureDeviceAccess(uid, deviceHash, pro, now);
    await this.validateLearningBackup(input.snapshot.freeDecks, pro, now);
    validateBackupSessions(input.snapshot.sessions, now);
    await this.repository.reconcileLearningBackup({
      uid,
      baseRevision: input.baseRevision,
      mutationId: input.mutationId,
      snapshot: input.snapshot,
      maxActiveFreeDecks: pro ? null : 1,
      now,
    });
    return this.repository.getSyncState(uid);
  }

  private async validateLearningBackup(
    freeDecks: readonly LearningBackupFreeDeck[],
    pro: boolean,
    now: Date,
  ): Promise<void> {
    assertBackend(
      pro || freeDecks.filter((deck) => deck.active).length <= 1,
      "failed-precondition",
      "Free plans can back up only one active deck.",
      { kind: "active-goal-limit", limit: 1 },
    );
    for (const backup of freeDecks) {
      const deck = await this.repository.getDeck(backup.deckId);
      assertBackend(
        deck !== null &&
          deck.status === "published" &&
          deck.tier === "free" &&
          deck.version === backup.deckVersion,
        "failed-precondition",
        "Free learning backup does not match a published deck version.",
        { kind: "learning-backup-deck-version" },
      );
      assertBackend(
        !backup.active || backup.goal !== null,
        "invalid-argument",
        "An active Free deck requires a study goal.",
      );

      const requestedIndexes =
        backup.goal === null
          ? backup.progresses.map((progress) => progress.cardIndex)
          : Array.from({ length: deck.cardCount }, (_, index) => index);
      const cards = await this.content.getCardsByIndexes(deck, requestedIndexes);
      const cardsByIndex = new Map(cards.map((card) => [card.index, card] as const));
      const allCardIds = new Set(cards.map((card) => card.id));
      if (backup.goal !== null) {
        validateBackupGoal(backup, allCardIds, deck.cardCount, pro);
      }
      const progressIndexes = new Set<number>();
      for (const progress of backup.progresses) {
        const card = cardsByIndex.get(progress.cardIndex);
        assertBackend(
          card !== undefined &&
            card.id === progress.state.cardId &&
            progress.state.deckId === deck.id &&
            !progressIndexes.has(progress.cardIndex),
          "permission-denied",
          "Free learning progress does not match bundled card identity.",
          { kind: "learning-backup-card-identity" },
        );
        progressIndexes.add(progress.cardIndex);
        validateBackupProgressTimestamps(progress.state, now);
      }
    }
  }
}

function validateBackupGoal(
  backup: LearningBackupFreeDeck,
  allCardIds: ReadonlySet<string>,
  cardCount: number,
  pro: boolean,
): void {
  const goal = backup.goal!;
  const assignments = Object.entries(goal.assignments).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const assignedIds = assignments.flatMap(([, cardIds]) => cardIds);
  assertBackend(
    goal.deckId === backup.deckId &&
      goal.key === backup.deckId &&
      goal.totalCount === cardCount &&
      goal.days === assignments.length &&
      assignments[0]?.[0] === goal.startDate &&
      assignedIds.length === cardCount &&
      new Set(assignedIds).size === cardCount &&
      assignedIds.every((cardId) => allCardIds.has(cardId)),
    "permission-denied",
    "Free learning goal does not match published bundled content.",
    { kind: "learning-backup-goal-identity" },
  );
  const largestAssignment = Math.max(...assignments.map(([, ids]) => ids.length));
  assertBackend(
    largestAssignment === goal.dailyCount &&
      (pro || largestAssignment <= BACKEND_CONFIG.freeDailyCardLimit),
    "failed-precondition",
    "Free learning goal exceeds the plan's daily limit.",
    { kind: "free-daily-limit", limit: BACKEND_CONFIG.freeDailyCardLimit },
  );
}

function validateBackupProgressTimestamps(
  progress: LearningBackupFreeDeck["progresses"][number]["state"],
  now: Date,
): void {
  const futureLimit = now.getTime() + 5 * 60 * 1_000;
  const updatedAt = Date.parse(progress.updatedAt);
  const firstSeenAt =
    progress.firstSeenAt === null ? null : Date.parse(progress.firstSeenAt);
  const lastSeenAt =
    progress.lastSeenAt === null ? null : Date.parse(progress.lastSeenAt);
  assertBackend(
    Number.isFinite(updatedAt) &&
      updatedAt <= futureLimit &&
      (firstSeenAt === null || firstSeenAt <= updatedAt) &&
      (lastSeenAt === null || lastSeenAt <= updatedAt) &&
      (firstSeenAt === null || lastSeenAt === null || firstSeenAt <= lastSeenAt),
    "invalid-argument",
    "Free learning progress contains an invalid timestamp ordering.",
  );
}

function validateBackupSessions(
  sessions: readonly PushLearningBackupInput["snapshot"]["sessions"][number][],
  now: Date,
): void {
  const futureLimit = now.getTime() + 5 * 60 * 1_000;
  for (const session of sessions) {
    assertBackend(
      session.completed <= session.target &&
        session.known + session.unknown <= session.completed &&
        Date.parse(session.completedAt) <= futureLimit,
      "invalid-argument",
      "Learning backup session totals or timestamp are invalid.",
    );
  }
}

function calculateProgress(
  current: DeckProgress,
  answers: ProgressAnswer[],
  window: DeliveryWindow,
  indexByCardId: ReadonlyMap<string, number>,
  now: Date,
): DeckProgress {
  const cards = { ...current.cards };
  for (const answer of answers) {
    const existing = cards[answer.cardId];
    const initial =
      existing?.state ?? createInitialCardProgress(answer.cardId, window.deckId, now);
    cards[answer.cardId] = {
      cardIndex: indexByCardId.get(answer.cardId) ?? -1,
      state: calculateNextReview(initial, answer.rating, now),
    };
  }
  return {
    ...current,
    cards,
    updatedAt: now.toISOString(),
    revision: current.revision + 1,
  };
}
