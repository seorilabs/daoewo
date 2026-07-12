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
  ProgressAnswer,
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
        /^[A-Za-z0-9_-]{1,128}$/.test(answer.cardId),
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
