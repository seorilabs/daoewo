import { describe, expect, it } from "vitest";
import {
  AppStoreAuthoritativeStateProvider,
  AppStoreNotificationVerifier,
} from "../../src/store-notifications/app-store.js";
import { appStoreReceiptFingerprint } from "../../src/receipts/fingerprint.js";
import {
  appStoreAccountBinding,
  StoreApiFailure,
} from "../../src/receipts/providers.js";
import type {
  AppStoreDecodedNotification,
  AppStoreDecodedRenewalInfo,
  AppStoreDecodedTransaction,
  AppStoreEnvironment,
  AppStoreNotificationEnvironmentClient,
  AppStoreSubscriptionStatusResponse,
} from "../../src/receipts/app-store-provider.js";

const BUNDLE_ID = "com.seorilabs.daoewo";
const APP_APPLE_ID = 1_234_567_890;
const OLD_PRODUCT_ID = "daoewo.pro.monthly";
const PRODUCT_ID = "daoewo.pro.yearly";
const UID = "user-a";
const TRANSACTION_ID = "2000000000000002";
const ORIGINAL_TRANSACTION_ID = "1000000000000001";
const NOW = new Date("2026-07-12T00:00:00.000Z");

describe("App Store Server Notifications V2", () => {
  it("verifies the outer and nested JWS seam and derives the existing fingerprint", async () => {
    const production = fakeClient("production", 1);
    const verifier = new AppStoreNotificationVerifier(
      production,
      fakeClient("sandbox", 1),
      config(),
    );
    await expect(verifier.verify("signed-payload-not-logged")).resolves.toEqual({
      kind: "subscription",
      notification: expect.objectContaining({
        platform: "app-store",
        originalTransactionId: ORIGINAL_TRANSACTION_ID,
        receiptFingerprint: appStoreReceiptFingerprint(ORIGINAL_TRANSACTION_ID),
      }),
    });
    expect(production.notificationCalls).toBe(1);
  });

  it("falls back to sandbox only after a non-retryable production verification failure", async () => {
    const production = fakeClient("production", 1);
    production.notificationFailure = new StoreApiFailure("invalid-receipt");
    const sandbox = fakeClient("sandbox", 1);
    const result = await new AppStoreNotificationVerifier(
      production,
      sandbox,
      config(),
    ).verify("sandbox-signed-payload");
    expect(result).toMatchObject({
      kind: "subscription",
      notification: { environment: "sandbox" },
    });
    expect(sandbox.notificationCalls).toBe(1);
  });

  it("maps Apple status 1/4 to active and 2/3/5 to inactive", async () => {
    for (const status of [1, 4]) {
      const client = fakeClient("production", status);
      await expect(createProvider(client).getState(notification(), claim())).resolves.toMatchObject({
        active: true,
        storeState: String(status),
      });
    }
    for (const [status, reason] of [
      [2, "expired"],
      [3, "billing-retry"],
      [5, "revoked"],
    ] as const) {
      const client = fakeClient("production", status);
      await expect(createProvider(client).getState(notification(), claim())).resolves.toMatchObject({
        active: false,
        reason,
      });
    }
  });

  it("accepts an allowlisted product crossgrade on the same original transaction", async () => {
    const client = fakeClient("production", 1);
    await expect(
      createProvider(client).getState(
        notification(OLD_PRODUCT_ID),
        claim(OLD_PRODUCT_ID),
      ),
    ).resolves.toMatchObject({
      active: true,
      productId: PRODUCT_ID,
      originalTransactionId: ORIGINAL_TRANSACTION_ID,
    });
  });

  it("retries a not-found current-status lookup for an existing claim", async () => {
    const client = fakeClient("production", 1);
    client.statusFailure = new StoreApiFailure("not-found");
    await expect(
      createProvider(client).getState(notification(), claim()),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
});

class FakeAppleNotificationClient
  implements AppStoreNotificationEnvironmentClient
{
  notificationCalls = 0;
  notificationFailure: unknown;
  statusFailure: unknown;
  readonly transaction: AppStoreDecodedTransaction;
  readonly renewal: AppStoreDecodedRenewalInfo;
  readonly statusResponse: AppStoreSubscriptionStatusResponse;

  constructor(
    readonly environment: AppStoreEnvironment,
    readonly status: number,
  ) {
    const appleEnvironment = environment === "production" ? "Production" : "Sandbox";
    this.transaction = {
      transactionId: TRANSACTION_ID,
      originalTransactionId: ORIGINAL_TRANSACTION_ID,
      bundleId: BUNDLE_ID,
      productId: PRODUCT_ID,
      purchaseDate: Date.parse("2026-07-01T00:00:00.000Z"),
      expiresDate:
        status === 2 || status === 3 || status === 5
          ? Date.parse("2026-07-01T00:00:00.000Z")
          : Date.parse("2026-08-12T00:00:00.000Z"),
      type: "Auto-Renewable Subscription",
      appAccountToken: appStoreAccountBinding(BUNDLE_ID, UID),
      environment: appleEnvironment,
    };
    this.renewal = {
      originalTransactionId: ORIGINAL_TRANSACTION_ID,
      productId: PRODUCT_ID,
      appAccountToken: appStoreAccountBinding(BUNDLE_ID, UID),
      environment: appleEnvironment,
      gracePeriodExpiresDate: Date.parse("2026-07-19T00:00:00.000Z"),
    };
    this.statusResponse = {
      environment: appleEnvironment,
      bundleId: BUNDLE_ID,
      ...(environment === "production" ? { appAppleId: APP_APPLE_ID } : {}),
      lastTransactions: [
        {
          status,
          originalTransactionId: ORIGINAL_TRANSACTION_ID,
          signedTransactionInfo: "latest-transaction",
          ...(status === 4 ? { signedRenewalInfo: "latest-renewal" } : {}),
        },
      ],
    };
  }

  async verifyNotification(): Promise<AppStoreDecodedNotification> {
    this.notificationCalls += 1;
    if (this.notificationFailure !== undefined) throw this.notificationFailure;
    const appleEnvironment = this.environment === "production" ? "Production" : "Sandbox";
    return {
      notificationType: "DID_RENEW",
      notificationUUID: `notification-${this.environment}`,
      version: "2.0",
      signedDate: NOW.getTime(),
      data: {
        environment: appleEnvironment,
        ...(this.environment === "production" ? { appAppleId: APP_APPLE_ID } : {}),
        bundleId: BUNDLE_ID,
        signedTransactionInfo: "latest-transaction",
        status: this.status,
      },
    };
  }

  async getTransactionInfo(): Promise<string> {
    return "latest-transaction";
  }

  async getAllSubscriptionStatuses(): Promise<AppStoreSubscriptionStatusResponse> {
    if (this.statusFailure !== undefined) throw this.statusFailure;
    return this.statusResponse;
  }

  async verifyTransaction(): Promise<AppStoreDecodedTransaction> {
    return this.transaction;
  }

  async verifyRenewalInfo(): Promise<AppStoreDecodedRenewalInfo> {
    return this.renewal;
  }
}

function fakeClient(environment: AppStoreEnvironment, status: number) {
  return new FakeAppleNotificationClient(environment, status);
}

function config() {
  return {
    bundleId: BUNDLE_ID,
    appAppleId: APP_APPLE_ID,
    productIds: new Set([OLD_PRODUCT_ID, PRODUCT_ID]),
  };
}

function createProvider(client: FakeAppleNotificationClient) {
  return new AppStoreAuthoritativeStateProvider(
    client,
    fakeClient("sandbox", client.status),
    config(),
    { resolveBindingUids: async (uid) => [uid] },
    () => NOW,
  );
}

function notification(productId = PRODUCT_ID) {
  return {
    platform: "app-store" as const,
    eventType: "subscription.status_changed" as const,
    notificationType: "DID_RENEW",
    environment: "production" as const,
    transactionId: TRANSACTION_ID,
    productId,
    originalTransactionId: ORIGINAL_TRANSACTION_ID,
    receiptFingerprint: appStoreReceiptFingerprint(ORIGINAL_TRANSACTION_ID),
    cursor: { eventId: "notification-a", occurredAt: NOW.toISOString() },
  };
}

function claim(productId = PRODUCT_ID) {
  return {
    kind: "claimed" as const,
    fingerprint: appStoreReceiptFingerprint(ORIGINAL_TRANSACTION_ID),
    uid: UID,
    platform: "app-store" as const,
    productId,
    originalTransactionId: ORIGINAL_TRANSACTION_ID,
  };
}
