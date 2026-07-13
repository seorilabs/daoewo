import type { ReviewRating } from "@daoewo/product-core";
import type { CatalogFilter } from "./repositories/contracts.js";
import type { CreateDeckRequestInput } from "./services/deck-request-service.js";
import type { CompleteDeckRequestInput } from "./services/deck-request-operator-service.js";
import type { CreateGoalInput } from "./services/goal-service.js";
import type {
  DeliverTodayWindowInput,
  SubmitProgressBatchInput,
} from "./services/study-service.js";
import type { ReceiptVerificationRequest } from "./receipts/providers.js";
import type { ExchangeTossLoginInput } from "./services/apps-in-toss-service.js";
import type { MergeAnonymousAccountInput } from "./services/account-merge-service.js";
import type {
  RegisterNotificationInstallationInput,
  UnregisterNotificationInstallationInput,
} from "./notifications/types.js";
import type {
  ClientStudyGoal,
  LearningBackupFreeDeck,
  LearningBackupProgress,
  LearningBackupSession,
  LearningBackupSnapshot,
  PushLearningBackupInput,
} from "./domain/types.js";
import {
  MAX_BACKUP_FREE_DECKS,
  MAX_BACKUP_PROGRESS_PER_DECK,
  MAX_BACKUP_SESSIONS,
} from "./domain/learning-backup.js";
import {
  asRecord,
  assertBackend,
  optionalString,
  requiredInteger,
  requiredString,
} from "./errors.js";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const CARD_ID = /^[A-Za-z0-9._:-]+$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const APP_VERSION = /^\d+(?:\.\d+){0,3}(?:-[A-Za-z0-9.-]+)?$/;
const BUILD_NUMBER = /^\d+(?:\.\d+){0,2}$/;
const LEARNING_STATUSES = new Set([
  "new",
  "learning",
  "known",
  "reviewing",
  "suspended",
]);
const STUDY_OUTCOMES = new Set([
  "known",
  "unknown",
  "easy",
  "confused",
  "missed",
]);

export function parseCatalogFilter(value: unknown): CatalogFilter {
  const data = asRecord(value);
  const category = optionalString(data.category, "category", 80);
  const language = optionalString(data.language, "language", 40);
  return {
    ...(category === undefined ? {} : { category }),
    ...(language === undefined ? {} : { language }),
  };
}

export function parseCreateGoal(value: unknown): CreateGoalInput {
  const data = asRecord(value);
  const endDate = optionalString(data.endDate, "endDate", 10);
  const dailyTarget =
    data.dailyTarget === undefined || data.dailyTarget === null
      ? undefined
      : requiredInteger(data.dailyTarget, "dailyTarget", { min: 1 });
  return {
    deckId: requiredString(data.deckId, "deckId", { max: 128, pattern: SAFE_ID }),
    targetCount: requiredInteger(data.targetCount, "targetCount", { min: 1 }),
    startDate: requiredString(data.startDate, "startDate", { min: 10, max: 10 }),
    timezone: requiredString(data.timezone, "timezone", { max: 80 }),
    deviceId: requiredString(data.deviceId, "deviceId", { min: 16, max: 256 }),
    ...(endDate === undefined ? {} : { endDate }),
    ...(dailyTarget === undefined ? {} : { dailyTarget }),
  };
}

export function parseDeactivateGoal(value: unknown): { goalId: string; deviceId: string } {
  const data = asRecord(value);
  return {
    goalId: requiredString(data.goalId, "goalId", { max: 128, pattern: SAFE_ID }),
    deviceId: requiredString(data.deviceId, "deviceId", { min: 16, max: 256 }),
  };
}

export function parseDeliverWindow(value: unknown): DeliverTodayWindowInput {
  const data = asRecord(value);
  return {
    goalId: requiredString(data.goalId, "goalId", { max: 128, pattern: SAFE_ID }),
    deviceId: requiredString(data.deviceId, "deviceId", { min: 16, max: 256 }),
  };
}

export function parseProgressBatch(value: unknown): SubmitProgressBatchInput {
  const data = asRecord(value);
  assertBackend(Array.isArray(data.answers), "invalid-argument", "answers must be an array.");
  assertBackend(
    data.answers.length > 0 && data.answers.length <= 600,
    "invalid-argument",
    "answers must contain between 1 and 600 items.",
  );
  return {
    batchId: requiredString(data.batchId, "batchId", {
      min: 8,
      max: 80,
      pattern: SAFE_ID,
    }),
    windowId: requiredString(data.windowId, "windowId", {
      min: 8,
      max: 80,
      pattern: SAFE_ID,
    }),
    deviceId: requiredString(data.deviceId, "deviceId", { min: 16, max: 256 }),
    answers: data.answers.map((value, index) => {
      const answer = asRecord(value, `answers[${index}]`);
      return {
        cardId: requiredString(answer.cardId, `answers[${index}].cardId`, {
          max: 128,
          pattern: CARD_ID,
        }),
        rating: requiredString(answer.rating, `answers[${index}].rating`, {
          max: 16,
        }) as ReviewRating,
      };
    }),
  };
}

export function parsePullSyncState(value: unknown): { deviceId: string } {
  const data = asRecord(value);
  return {
    deviceId: requiredString(data.deviceId, "deviceId", { min: 16, max: 256 }),
  };
}

export function parsePushLearningBackup(value: unknown): PushLearningBackupInput {
  const data = asRecord(value);
  return {
    deviceId: requiredString(data.deviceId, "deviceId", { min: 16, max: 256 }),
    baseRevision: requiredInteger(data.baseRevision, "baseRevision", {
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    }),
    mutationId: requiredString(data.mutationId, "mutationId", {
      min: 8,
      max: 80,
      pattern: SAFE_ID,
    }),
    snapshot: parseLearningBackupSnapshot(data.snapshot),
  };
}

function parseLearningBackupSnapshot(value: unknown): LearningBackupSnapshot {
  const snapshot = asRecord(value, "snapshot");
  assertBackend(
    snapshot.version === 1,
    "invalid-argument",
    "snapshot.version must be 1.",
  );
  assertBackend(
    Array.isArray(snapshot.freeDecks) &&
      snapshot.freeDecks.length <= MAX_BACKUP_FREE_DECKS,
    "invalid-argument",
    `snapshot.freeDecks must contain at most ${MAX_BACKUP_FREE_DECKS} items.`,
  );
  assertBackend(
    Array.isArray(snapshot.sessions) &&
      snapshot.sessions.length <= MAX_BACKUP_SESSIONS,
    "invalid-argument",
    `snapshot.sessions must contain at most ${MAX_BACKUP_SESSIONS} items.`,
  );
  const freeDecks = snapshot.freeDecks.map((item, index) =>
    parseLearningBackupFreeDeck(item, index),
  );
  assertBackend(
    new Set(freeDecks.map((deck) => deck.deckId)).size === freeDecks.length,
    "invalid-argument",
    "snapshot.freeDecks contains duplicate deck IDs.",
  );
  const sessions = snapshot.sessions.map((item, index) =>
    parseLearningBackupSession(item, index),
  );
  assertBackend(
    new Set(sessions.map((session) => session.id)).size === sessions.length,
    "invalid-argument",
    "snapshot.sessions contains duplicate session IDs.",
  );
  return { version: 1, freeDecks, sessions };
}

function parseLearningBackupFreeDeck(
  value: unknown,
  index: number,
): LearningBackupFreeDeck {
  const name = `snapshot.freeDecks[${index}]`;
  const deck = asRecord(value, name);
  assertBackend(
    typeof deck.active === "boolean",
    "invalid-argument",
    `${name}.active must be a boolean.`,
  );
  assertBackend(
    Array.isArray(deck.progresses) &&
      deck.progresses.length <= MAX_BACKUP_PROGRESS_PER_DECK,
    "invalid-argument",
    `${name}.progresses has too many items.`,
  );
  const deckId = requiredString(deck.deckId, `${name}.deckId`, {
    max: 128,
    pattern: SAFE_ID,
  });
  const progresses = deck.progresses.map((item, progressIndex) =>
    parseLearningBackupProgress(item, `${name}.progresses[${progressIndex}]`),
  );
  assertBackend(
    new Set(progresses.map((progress) => progress.state.cardId)).size ===
      progresses.length,
    "invalid-argument",
    `${name}.progresses contains duplicate card IDs.`,
  );
  const goal =
    deck.goal === null || deck.goal === undefined
      ? null
      : parseClientStudyGoal(deck.goal, `${name}.goal`);
  return {
    deckId,
    deckVersion: requiredInteger(deck.deckVersion, `${name}.deckVersion`, {
      min: 1,
      max: 1_000_000,
    }),
    active: deck.active,
    goal,
    progresses,
  };
}

function parseClientStudyGoal(value: unknown, name: string): ClientStudyGoal {
  const goal = asRecord(value, name);
  assertBackend(
    goal.mode === "days" || goal.mode === "daily-count",
    "invalid-argument",
    `${name}.mode is invalid.`,
  );
  const assignmentsValue = asRecord(goal.assignments, `${name}.assignments`);
  const entries = Object.entries(assignmentsValue);
  assertBackend(
    entries.length > 0 && entries.length <= 3_660,
    "invalid-argument",
    `${name}.assignments has an invalid size.`,
  );
  let assignedCardCount = 0;
  const assignments = Object.fromEntries(
    entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, cardIds]) => {
        assertDateKey(date, `${name}.assignments date`);
        assertBackend(
          Array.isArray(cardIds) && cardIds.length <= 2_000,
          "invalid-argument",
          `${name}.assignments[${date}] must be a bounded array.`,
        );
        const parsed = cardIds.map((cardId, index) =>
          requiredString(cardId, `${name}.assignments[${date}][${index}]`, {
            max: 128,
            pattern: CARD_ID,
          }),
        );
        assertBackend(
          new Set(parsed).size === parsed.length,
          "invalid-argument",
          `${name}.assignments[${date}] contains duplicate card IDs.`,
        );
        assignedCardCount += parsed.length;
        assertBackend(
          assignedCardCount <= MAX_BACKUP_PROGRESS_PER_DECK,
          "invalid-argument",
          `${name}.assignments contains too many assigned cards.`,
        );
        return [date, parsed] as const;
      }),
  );
  return {
    key: requiredString(goal.key, `${name}.key`, {
      max: 128,
      pattern: SAFE_ID,
    }),
    deckId: requiredString(goal.deckId, `${name}.deckId`, {
      max: 128,
      pattern: SAFE_ID,
    }),
    mode: goal.mode,
    startDate: parseDateKey(goal.startDate, `${name}.startDate`),
    totalCount: requiredInteger(goal.totalCount, `${name}.totalCount`, {
      min: 1,
      max: 2_000,
    }),
    days: requiredInteger(goal.days, `${name}.days`, {
      min: 1,
      max: 3_660,
    }),
    dailyCount: requiredInteger(goal.dailyCount, `${name}.dailyCount`, {
      min: 1,
      max: 2_000,
    }),
    assignments,
  };
}

function parseLearningBackupProgress(
  value: unknown,
  name: string,
): LearningBackupProgress {
  const progress = asRecord(value, name);
  const state = asRecord(progress.state, `${name}.state`);
  assertBackend(
    typeof state.status === "string" && LEARNING_STATUSES.has(state.status),
    "invalid-argument",
    `${name}.state.status is invalid.`,
  );
  assertBackend(
    state.lastOutcome === null ||
      (typeof state.lastOutcome === "string" &&
        STUDY_OUTCOMES.has(state.lastOutcome)),
    "invalid-argument",
    `${name}.state.lastOutcome is invalid.`,
  );
  const nextReviewAt = parseNullableTimestamp(
    state.nextReviewAt,
    `${name}.state.nextReviewAt`,
  );
  const firstSeenAt = parseNullableTimestamp(
    state.firstSeenAt,
    `${name}.state.firstSeenAt`,
  );
  const lastSeenAt = parseNullableTimestamp(
    state.lastSeenAt,
    `${name}.state.lastSeenAt`,
  );
  return {
    cardIndex: requiredInteger(progress.cardIndex, `${name}.cardIndex`, {
      min: 0,
      max: 99_999,
    }),
    state: {
      cardId: requiredString(state.cardId, `${name}.state.cardId`, {
        max: 128,
        pattern: CARD_ID,
      }),
      deckId: requiredString(state.deckId, `${name}.state.deckId`, {
        max: 128,
        pattern: SAFE_ID,
      }),
      status: state.status as LearningBackupProgress["state"]["status"],
      knownCount: requiredInteger(state.knownCount, `${name}.state.knownCount`, {
        min: 0,
        max: 1_000_000,
      }),
      unknownCount: requiredInteger(
        state.unknownCount,
        `${name}.state.unknownCount`,
        { min: 0, max: 1_000_000 },
      ),
      reviewCount: requiredInteger(
        state.reviewCount,
        `${name}.state.reviewCount`,
        { min: 0, max: 1_000_000 },
      ),
      streak: requiredInteger(state.streak, `${name}.state.streak`, {
        min: 0,
        max: 1_000_000,
      }),
      nextReviewAt,
      lastOutcome:
        state.lastOutcome as LearningBackupProgress["state"]["lastOutcome"],
      firstSeenAt,
      lastSeenAt,
      updatedAt: parseTimestamp(state.updatedAt, `${name}.state.updatedAt`),
    },
  };
}

function parseLearningBackupSession(
  value: unknown,
  index: number,
): LearningBackupSession {
  const name = `snapshot.sessions[${index}]`;
  const session = asRecord(value, name);
  return {
    id: requiredString(session.id, `${name}.id`, { max: 256, pattern: CARD_ID }),
    deckId: requiredString(session.deckId, `${name}.deckId`, {
      max: 128,
      pattern: SAFE_ID,
    }),
    date: parseDateKey(session.date, `${name}.date`),
    target: requiredInteger(session.target, `${name}.target`, {
      min: 0,
      max: 2_000,
    }),
    completed: requiredInteger(session.completed, `${name}.completed`, {
      min: 0,
      max: 2_000,
    }),
    known: requiredInteger(session.known, `${name}.known`, {
      min: 0,
      max: 2_000,
    }),
    unknown: requiredInteger(session.unknown, `${name}.unknown`, {
      min: 0,
      max: 2_000,
    }),
    reviewCount: requiredInteger(session.reviewCount, `${name}.reviewCount`, {
      min: 0,
      max: 2_000,
    }),
    elapsedMs: requiredInteger(session.elapsedMs, `${name}.elapsedMs`, {
      min: 0,
      max: 7 * 24 * 60 * 60 * 1_000,
    }),
    completedAt: parseTimestamp(session.completedAt, `${name}.completedAt`),
  };
}

function parseDateKey(value: unknown, name: string): string {
  const date = requiredString(value, name, { min: 10, max: 10 });
  assertDateKey(date, name);
  return date;
}

function assertDateKey(value: string, name: string): void {
  const date = new Date(`${value}T00:00:00.000Z`);
  assertBackend(
    DATE_KEY.test(value) &&
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value,
    "invalid-argument",
    `${name} must be a valid local date.`,
  );
}

function parseTimestamp(value: unknown, name: string): string {
  const timestamp = requiredString(value, name, { min: 20, max: 35 });
  const parsed = Date.parse(timestamp);
  assertBackend(
    Number.isFinite(parsed),
    "invalid-argument",
    `${name} must be a valid timestamp.`,
  );
  return new Date(parsed).toISOString();
}

function parseNullableTimestamp(value: unknown, name: string): string | null {
  return value === null ? null : parseTimestamp(value, name);
}

export function parseDeckRequest(value: unknown): CreateDeckRequestInput {
  const data = asRecord(value);
  const note = optionalString(data.note, "note", 2_000);
  return {
    topic: requiredString(data.topic, "topic", { min: 2, max: 200 }),
    category: requiredString(data.category, "category", { max: 80 }),
    language: requiredString(data.language, "language", { max: 40 }),
    ...(note === undefined ? {} : { note }),
  };
}

export function parseCompleteDeckRequest(
  value: unknown,
): CompleteDeckRequestInput {
  const data = asRecord(value);
  return {
    requestId: requiredString(data.requestId, "requestId", {
      max: 128,
      pattern: SAFE_ID,
    }),
    readyDeckId: requiredString(data.readyDeckId, "readyDeckId", {
      max: 128,
      pattern: SAFE_ID,
    }),
  };
}

export function parseRegisterNotificationInstallation(
  value: unknown,
): RegisterNotificationInstallationInput {
  const data = asRecord(value);
  assertBackend(
    data.platform === "android" || data.platform === "ios",
    "invalid-argument",
    "platform must be android or ios.",
  );
  return {
    deviceId: requiredString(data.deviceId, "deviceId", { min: 16, max: 256 }),
    fcmToken: requiredString(data.fcmToken, "fcmToken", {
      min: 16,
      max: 4_096,
    }),
    platform: data.platform,
    locale: requiredString(data.locale, "locale", {
      min: 2,
      max: 35,
      pattern: LOCALE,
    }),
    appVersion: requiredString(data.appVersion, "appVersion", {
      min: 1,
      max: 40,
      pattern: APP_VERSION,
    }),
    buildNumber: requiredString(data.buildNumber, "buildNumber", {
      min: 1,
      max: 18,
      pattern: BUILD_NUMBER,
    }),
  };
}

export function parseUnregisterNotificationInstallation(
  value: unknown,
): UnregisterNotificationInstallationInput {
  const data = asRecord(value);
  return {
    deviceId: requiredString(data.deviceId, "deviceId", { min: 16, max: 256 }),
  };
}

export function parseReceipt(
  value: unknown,
): Omit<ReceiptVerificationRequest, "uid"> {
  const data = asRecord(value);
  assertBackend(
    data.platform === "google-play" ||
      data.platform === "app-store" ||
      data.platform === "apps-in-toss",
    "invalid-argument",
    "platform must be google-play, app-store, or apps-in-toss.",
  );
  const purchaseToken = optionalString(data.purchaseToken, "purchaseToken", 20_000);
  const receiptData = optionalString(data.receiptData, "receiptData", 200_000);
  const transactionId = optionalString(data.transactionId, "transactionId", 256);
  const packageName = optionalString(data.packageName, "packageName", 256);
  const orderId = optionalString(data.orderId, "orderId", 256);
  const sku = optionalString(data.sku, "sku", 256);
  const subscriptionId = optionalString(data.subscriptionId, "subscriptionId", 256);
  if (data.platform === "google-play") {
    assertBackend(purchaseToken !== undefined, "invalid-argument", "purchaseToken is required.");
  } else if (data.platform === "app-store") {
    assertBackend(
      transactionId !== undefined || receiptData !== undefined,
      "invalid-argument",
      "transactionId or receiptData is required.",
    );
  } else {
    assertBackend(
      orderId !== undefined && sku !== undefined,
      "invalid-argument",
      "orderId and sku are required for AppsInToss.",
    );
  }
  const productId =
    data.platform === "apps-in-toss"
      ? (sku as string)
      : requiredString(data.productId, "productId", { max: 256 });
  return {
    platform: data.platform,
    productId,
    ...(purchaseToken === undefined ? {} : { purchaseToken }),
    ...(receiptData === undefined ? {} : { receiptData }),
    ...(transactionId === undefined ? {} : { transactionId }),
    ...(packageName === undefined ? {} : { packageName }),
    ...(orderId === undefined ? {} : { orderId }),
    ...(sku === undefined ? {} : { sku }),
    ...(subscriptionId === undefined ? {} : { subscriptionId }),
  };
}

export function parseTossLoginExchange(value: unknown): ExchangeTossLoginInput {
  const data = asRecord(value);
  return {
    authorizationCode: requiredString(data.authorizationCode, "authorizationCode", {
      min: 8,
      max: 4_096,
    }),
    referrer: requiredString(data.referrer, "referrer", { min: 1, max: 1_024 }),
  };
}

export function parseAnonymousAccountMerge(value: unknown): MergeAnonymousAccountInput {
  const data = asRecord(value);
  return {
    sourceIdToken: requiredString(data.sourceIdToken, "sourceIdToken", {
      min: 100,
      max: 20_000,
    }),
    targetIdToken: requiredString(data.targetIdToken, "targetIdToken", {
      min: 100,
      max: 20_000,
    }),
    deviceId: requiredString(data.deviceId, "deviceId", { min: 16, max: 256 }),
  };
}

export function parseDeleteAccount(value: unknown): void {
  const data = asRecord(value);
  assertBackend(
    data.confirmation === "DELETE",
    "invalid-argument",
    "confirmation must be DELETE.",
  );
}
