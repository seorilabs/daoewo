import { describe, expect, it } from "vitest";
import {
  GooglePlayAuthoritativeStateProvider,
  parseGooglePlayDeveloperNotification,
  readGooglePlayPubSubJson,
} from "../../src/store-notifications/google-play.js";
import {
  googlePlayOriginalTransactionId,
  googlePlayReceiptFingerprint,
} from "../../src/receipts/fingerprint.js";
import { googlePlayAccountBinding } from "../../src/receipts/providers.js";
import { StoreApiFailure } from "../../src/receipts/providers.js";
import type {
  GooglePlayOrder,
  GooglePlayPublisherClient,
  GooglePlaySubscriptionPurchase,
} from "../../src/receipts/google-play-provider.js";

const PACKAGE_NAME = "com.seorilabs.daoewo";
const PRODUCT_ID = "daoewo.pro.monthly";
const TOKEN = "purchase-token-never-persisted";
const UID = "user-a";
const NOW = new Date("2026-07-12T00:00:00.000Z");

describe("Google Play RTDN", () => {
  it("classifies a malformed Pub/Sub JSON payload as a permanent input error", () => {
    const message = {
      get json(): unknown {
        throw new SyntaxError("raw payload must not be logged");
      },
    };
    expect(() => readGooglePlayPubSubJson(message)).toThrowError(
      expect.objectContaining({ code: "invalid-argument" }),
    );
  });

  it("recreates the existing two-stage receipt fingerprint", () => {
    const result = parseGooglePlayDeveloperNotification(
      {
        version: "1.0",
        packageName: PACKAGE_NAME,
        eventTimeMillis: String(NOW.getTime()),
        subscriptionNotification: {
          version: "1.0",
          notificationType: 12,
          purchaseToken: TOKEN,
        },
      },
      "pubsub-message-a",
      PACKAGE_NAME,
    );
    expect(result).toEqual({
      kind: "subscription",
      notification: expect.objectContaining({
        originalTransactionId: googlePlayOriginalTransactionId(PACKAGE_NAME, TOKEN),
        receiptFingerprint: googlePlayReceiptFingerprint(PACKAGE_NAME, TOKEN),
        cursor: {
          eventId: "pubsub-message-a",
          occurredAt: NOW.toISOString(),
        },
      }),
    });
  });

  it("routes subscription voided purchases through the existing token fingerprint", () => {
    const result = parseGooglePlayDeveloperNotification(
      {
        version: "1.0",
        packageName: PACKAGE_NAME,
        eventTimeMillis: String(NOW.getTime()),
        voidedPurchaseNotification: {
          purchaseToken: TOKEN,
          orderId: "GPA.voided",
          productType: 1,
          refundType: 1,
        },
      },
      "pubsub-voided-subscription",
      PACKAGE_NAME,
    );
    expect(result).toEqual({
      kind: "subscription",
      notification: expect.objectContaining({
        notificationType: "voided-purchase",
        voidedRefundType: 1,
        voidedOrderId: "GPA.voided",
        receiptFingerprint: googlePlayReceiptFingerprint(PACKAGE_NAME, TOKEN),
      }),
    });
  });

  it("ignores one-time voids and rejects unknown product types", () => {
    const envelope = (productType: number) => ({
      version: "1.0",
      packageName: PACKAGE_NAME,
      eventTimeMillis: String(NOW.getTime()),
      voidedPurchaseNotification: {
        purchaseToken: TOKEN,
        orderId: "GPA.voided",
        productType,
        refundType: 1,
      },
    });
    expect(
      parseGooglePlayDeveloperNotification(
        envelope(2),
        "pubsub-one-time-void",
        PACKAGE_NAME,
      ),
    ).toEqual({
      kind: "ignored",
      platform: "google-play",
      eventId: "pubsub-one-time-void",
    });
    expect(() =>
      parseGooglePlayDeveloperNotification(
        envelope(3),
        "pubsub-invalid-void",
        PACKAGE_NAME,
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid-argument" }));
  });

  it("maps active/canceled-before-expiry and inactive store states", async () => {
    for (const state of [
      "SUBSCRIPTION_STATE_ACTIVE",
      "SUBSCRIPTION_STATE_CANCELED",
    ]) {
      const client = fakeClient(state);
      await expect(createProvider(client).getState(notification(), claim())).resolves.toMatchObject({
        active: true,
        storeState: state,
      });
    }

    for (const [state, reason] of [
      ["SUBSCRIPTION_STATE_ON_HOLD", "on-hold"],
      ["SUBSCRIPTION_STATE_PAUSED", "paused"],
      ["SUBSCRIPTION_STATE_EXPIRED", "expired"],
      ["SUBSCRIPTION_STATE_PENDING", "pending"],
    ] as const) {
      const client = fakeClient(state);
      await expect(createProvider(client).getState(notification(), claim())).resolves.toMatchObject({
        active: false,
        reason,
      });
      expect(client.orderCalls).toBe(0);
    }
  });

  it("keeps access when the subscription is active even if an order was refunded without revoke", async () => {
    const client = fakeClient("SUBSCRIPTION_STATE_ACTIVE");
    client.order = { ...client.order, state: "CANCELED" };
    await expect(createProvider(client).getState(notification(), claim())).resolves.toMatchObject({
      active: true,
      storeState: "SUBSCRIPTION_STATE_ACTIVE",
    });
  });

  it("uses current subscription authority for a full-refund void", async () => {
    const voidedNotification = {
      ...notification(),
      notificationType: "voided-purchase" as const,
      voidedRefundType: 1 as const,
      voidedOrderId: "GPA.older-renewal",
    };
    await expect(
      createProvider(fakeClient("SUBSCRIPTION_STATE_ACTIVE")).getState(
        voidedNotification,
        claim(),
      ),
    ).resolves.toMatchObject({ active: true });
    await expect(
      createProvider(fakeClient("SUBSCRIPTION_STATE_EXPIRED")).getState(
        voidedNotification,
        claim(),
      ),
    ).resolves.toMatchObject({ active: false, reason: "expired" });
  });

  it("retries when the void targets the order still reported as current active", async () => {
    const client = fakeClient("SUBSCRIPTION_STATE_ACTIVE");
    await expect(
      createProvider(client).getState(
        {
          ...notification(),
          notificationType: "voided-purchase",
          voidedRefundType: 1,
          voidedOrderId: "GPA.1234",
        },
        claim(),
      ),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(client.orderCalls).toBe(0);
  });

  it("fails closed for linked purchase notifications until chain migration is atomic", async () => {
    const client = fakeClient("SUBSCRIPTION_STATE_ACTIVE");
    client.purchase = {
      ...client.purchase,
      linkedPurchaseToken: "old-token-must-not-be-persisted",
    };
    await expect(
      createProvider(client).getState(notification(), claim()),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      details: { kind: "google-play-linked-purchase-unsupported" },
    });
    expect(client.orderCalls).toBe(0);
  });

  it("still revokes the current linked claim when store authority is inactive", async () => {
    const client = fakeClient("SUBSCRIPTION_STATE_EXPIRED");
    client.purchase = {
      ...client.purchase,
      linkedPurchaseToken: "old-token-must-not-be-persisted",
    };
    await expect(
      createProvider(client).getState(notification(), claim()),
    ).resolves.toMatchObject({ active: false, reason: "expired" });
    expect(client.orderCalls).toBe(0);
  });

  it("retries a not-found authoritative lookup for an existing claim", async () => {
    const client = fakeClient("SUBSCRIPTION_STATE_EXPIRED");
    client.subscriptionFailure = new StoreApiFailure("not-found");
    await expect(
      createProvider(client).getState(notification(), claim()),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
});

class FakeClient implements GooglePlayPublisherClient {
  orderCalls = 0;
  acknowledgements = 0;
  subscriptionFailure: unknown;

  constructor(
    public purchase: GooglePlaySubscriptionPurchase,
    public order: GooglePlayOrder,
  ) {}

  async getSubscription(): Promise<GooglePlaySubscriptionPurchase> {
    if (this.subscriptionFailure !== undefined) throw this.subscriptionFailure;
    return this.purchase;
  }

  async getOrder(): Promise<GooglePlayOrder> {
    this.orderCalls += 1;
    return this.order;
  }

  async acknowledgeSubscription(): Promise<void> {
    this.acknowledgements += 1;
  }
}

function fakeClient(state: string): FakeClient {
  return new FakeClient(
    {
      subscriptionState: state,
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      startTime: "2026-07-01T00:00:00.000Z",
      externalAccountIdentifiers: {
        obfuscatedExternalAccountId: googlePlayAccountBinding(PACKAGE_NAME, UID),
      },
      lineItems: [
        {
          productId: PRODUCT_ID,
          expiryTime:
            state === "SUBSCRIPTION_STATE_EXPIRED"
              ? "2026-07-01T00:00:00.000Z"
              : "2026-08-12T00:00:00.000Z",
          latestSuccessfulOrderId: "GPA.1234",
        },
      ],
    },
    {
      orderId: "GPA.1234",
      purchaseToken: TOKEN,
      state: "PROCESSED",
      createTime: "2026-07-01T00:00:00.000Z",
      lineItems: [{ productId: PRODUCT_ID, subscriptionDetails: {} }],
    },
  );
}

function createProvider(client: GooglePlayPublisherClient) {
  return new GooglePlayAuthoritativeStateProvider(
    client,
    { packageName: PACKAGE_NAME, productIds: new Set([PRODUCT_ID]) },
    { resolveBindingUids: async (uid) => [uid] },
    () => NOW,
  );
}

function notification() {
  return {
    platform: "google-play" as const,
    eventType: "subscription.status_changed" as const,
    notificationType: 2,
    packageName: PACKAGE_NAME,
    purchaseToken: TOKEN,
    originalTransactionId: googlePlayOriginalTransactionId(PACKAGE_NAME, TOKEN),
    receiptFingerprint: googlePlayReceiptFingerprint(PACKAGE_NAME, TOKEN),
    cursor: { eventId: "message-a", occurredAt: NOW.toISOString() },
  };
}

function claim() {
  return {
    kind: "claimed" as const,
    fingerprint: googlePlayReceiptFingerprint(PACKAGE_NAME, TOKEN),
    uid: UID,
    platform: "google-play" as const,
    productId: PRODUCT_ID,
    originalTransactionId: googlePlayOriginalTransactionId(PACKAGE_NAME, TOKEN),
  };
}
