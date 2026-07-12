import { assertBackend } from "../errors.js";
import { sha256 } from "../utils/hash.js";
import { parseGooglePlayDeveloperNotification } from "./google-play.js";
import type {
  StoreReconciliationSource,
} from "./reconciliation.js";
import type {
  VerifiedStoreNotificationEnvelope,
} from "./types.js";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export interface GoogleVoidedPurchaseItem {
  readonly purchaseToken: string;
  readonly orderId: string;
  readonly voidedTimeMillis: string;
}

export interface GoogleVoidedPurchasePageClient {
  listVoidedPurchases(input: {
    packageName: string;
    startTimeMillis: string;
    endTimeMillis: string;
    pageToken: string | null;
  }): Promise<{
    items: readonly GoogleVoidedPurchaseItem[];
    nextPageToken: string | null;
  }>;
}

export function createGoogleVoidedPurchasesSource(input: {
  client: GoogleVoidedPurchasePageClient;
  packageName: string;
}): StoreReconciliationSource {
  return {
    key: "google-play-voided",
    // API startTime은 현재 시각 기준 최대 30일이다. clock skew 여유를 둔다.
    lookbackMs: 29 * DAY_MS,
    overlapMs: 6 * HOUR_MS,
    staleWindowGraceMs: 23 * HOUR_MS,
    async listPage({ startTime, endTime, pageToken }) {
      const page = await input.client.listVoidedPurchases({
        packageName: input.packageName,
        startTimeMillis: String(startTime.getTime()),
        endTimeMillis: String(endTime.getTime()),
        pageToken,
      });
      return {
        envelopes: page.items.map((item) =>
          googleVoidedItemEnvelope(input.packageName, item),
        ),
        nextPageToken: page.nextPageToken,
      };
    },
  };
}

export interface AppleNotificationHistoryPageClient {
  listNotificationHistory(input: {
    startTimeMillis: number;
    endTimeMillis: number;
    pageToken: string | null;
    onlyFailures: boolean;
  }): Promise<{
    signedPayloads: readonly string[];
    nextPageToken: string | null;
  }>;
}

export function createAppleNotificationHistorySource(input: {
  client: AppleNotificationHistoryPageClient;
  verifier: {
    verify(signedPayload: string): Promise<VerifiedStoreNotificationEnvelope>;
  };
  environment: "production" | "sandbox";
}): StoreReconciliationSource {
  return {
    key: `app-store-${input.environment}-history`,
    lookbackMs: (input.environment === "production" ? 179 : 29) * DAY_MS,
    overlapMs: 6 * HOUR_MS,
    staleWindowGraceMs: 23 * HOUR_MS,
    async listPage({ startTime, endTime, pageToken }) {
      const page = await input.client.listNotificationHistory({
        startTimeMillis: startTime.getTime(),
        endTimeMillis: endTime.getTime(),
        pageToken,
        onlyFailures: true,
      });
      const envelopes: VerifiedStoreNotificationEnvelope[] = [];
      for (const signedPayload of page.signedPayloads) {
        // JWS는 이 stack frame에서 검증한 뒤 envelope로만 전달하고 저장하지 않는다.
        envelopes.push(await input.verifier.verify(signedPayload));
      }
      return { envelopes, nextPageToken: page.nextPageToken };
    },
  };
}

function googleVoidedItemEnvelope(
  packageName: string,
  item: GoogleVoidedPurchaseItem,
): VerifiedStoreNotificationEnvelope {
  const voidedTime = parsePositiveIntegerString(
    item.voidedTimeMillis,
    "Google voided purchase time",
  );
  assertBackend(
    typeof item.purchaseToken === "string" &&
      item.purchaseToken.length > 0 &&
      item.purchaseToken.length <= 4_096 &&
      typeof item.orderId === "string" &&
      item.orderId.length > 0 &&
      item.orderId.length <= 256,
    "internal",
    "Google Voided Purchases API returned an invalid subscription item.",
  );
  const eventId = `voided-history-${sha256(
    `${packageName}:${item.orderId}:${item.voidedTimeMillis}`,
  )}`;
  return parseGooglePlayDeveloperNotification(
    {
      version: "1.0",
      packageName,
      eventTimeMillis: String(voidedTime),
      voidedPurchaseNotification: {
        purchaseToken: item.purchaseToken,
        orderId: item.orderId,
        productType: 1,
        // 구독은 quantity partial refund 대상이 아니므로 full refund로 정규화한다.
        refundType: 1,
      },
    },
    eventId,
    packageName,
  );
}

function parsePositiveIntegerString(value: string, name: string): number {
  assertBackend(
    /^\d+$/.test(value),
    "internal",
    `${name} is invalid.`,
  );
  const parsed = Number(value);
  assertBackend(
    Number.isSafeInteger(parsed) && parsed > 0,
    "internal",
    `${name} is invalid.`,
  );
  return parsed;
}
