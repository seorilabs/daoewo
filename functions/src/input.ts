import type { ReviewRating } from "@daoewo/product-core";
import type { CatalogFilter } from "./repositories/contracts.js";
import type { CreateDeckRequestInput } from "./services/deck-request-service.js";
import type { CreateGoalInput } from "./services/goal-service.js";
import type {
  DeliverTodayWindowInput,
  SubmitProgressBatchInput,
} from "./services/study-service.js";
import type { ReceiptVerificationRequest } from "./receipts/providers.js";
import type { ExchangeTossLoginInput } from "./services/apps-in-toss-service.js";
import type { MergeAnonymousAccountInput } from "./services/account-merge-service.js";
import {
  asRecord,
  assertBackend,
  optionalString,
  requiredInteger,
  requiredString,
} from "./errors.js";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

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
          pattern: SAFE_ID,
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
