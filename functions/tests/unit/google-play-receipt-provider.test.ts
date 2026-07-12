import { describe, expect, it } from "vitest";
import {
  GooglePlayReceiptVerificationProvider,
  type GooglePlayOrder,
  type GooglePlayPublisherClient,
  type GooglePlaySubscriptionPurchase,
} from "../../src/receipts/google-play-provider.js";
import {
  googlePlayAccountBinding,
  StoreApiFailure,
} from "../../src/receipts/providers.js";
import { sha256 } from "../../src/utils/hash.js";

const PACKAGE_NAME = "com.seorilabs.daoewo";
const PRODUCT_ID = "daoewo.pro.monthly";
const PURCHASE_TOKEN = "store-secret-purchase-token";
const NOW = new Date("2026-07-12T00:00:00.000Z");

describe("GooglePlayReceiptVerificationProvider", () => {
  it("validates subscription, order, account binding and acknowledges on the server", async () => {
    const client = fakeClient("user-a");
    const provider = createProvider(client);

    await expect(
      provider.verify({
        uid: "user-a",
        platform: "google-play",
        productId: PRODUCT_ID,
        purchaseToken: PURCHASE_TOKEN,
        packageName: PACKAGE_NAME,
      }),
    ).resolves.toEqual({
      platform: "google-play",
      productId: PRODUCT_ID,
      originalTransactionId: sha256(
        `google-play:${PACKAGE_NAME}:${PURCHASE_TOKEN}`,
      ),
      active: true,
      purchasedAt: "2026-07-12T00:00:00.000Z",
      expiresAt: "2026-08-12T00:00:00.000Z",
      environment: "sandbox",
      authorityObservation: {
        startedAt: NOW.toISOString(),
        observedAt: NOW.toISOString(),
      },
      entitlement: {
        plan: "pro",
        source: "google-play",
        validUntil: "2026-08-12T00:00:00.000Z",
      },
    });
    expect(client.acknowledgements).toEqual([
      [PACKAGE_NAME, PRODUCT_ID, PURCHASE_TOKEN],
    ]);
  });

  it("rejects a store account binding that belongs to another Firebase uid", async () => {
    const client = fakeClient("other-user");
    await expect(
      createProvider(client).verify({
        uid: "user-a",
        platform: "google-play",
        productId: PRODUCT_ID,
        purchaseToken: PURCHASE_TOKEN,
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(client.orderCalls).toBe(0);
    expect(client.acknowledgements).toHaveLength(0);
  });

  it("accepts only a server-authorized historical anonymous merge binding", async () => {
    const sourceUid = "anonymous-source";
    const targetUid = "google-target";
    const client = fakeClient(sourceUid);
    const provider = createProvider(client, async (uid) =>
      uid === targetUid ? [targetUid, sourceUid] : [uid],
    );
    await expect(
      provider.verify({
        uid: targetUid,
        platform: "google-play",
        productId: PRODUCT_ID,
        purchaseToken: PURCHASE_TOKEN,
      }),
    ).resolves.toMatchObject({ active: true });

    await expect(
      createProvider(fakeClient(sourceUid)).verify({
        uid: "unrelated-target",
        platform: "google-play",
        productId: PRODUCT_ID,
        purchaseToken: PURCHASE_TOKEN,
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("does not grant a refunded or revoked latest order", async () => {
    const client = fakeClient("user-a");
    client.order = { ...client.order, state: "REFUNDED" };

    await expect(
      createProvider(client).verify({
        uid: "user-a",
        platform: "google-play",
        productId: PRODUCT_ID,
        purchaseToken: PURCHASE_TOKEN,
      }),
    ).rejects.toMatchObject({
      code: "permission-denied",
      message: expect.stringContaining("refunded"),
    });
    expect(client.acknowledgements).toHaveLength(0);
  });

  it("rejects on-hold, expired, and pending subscription states", async () => {
    for (const state of [
      "SUBSCRIPTION_STATE_ON_HOLD",
      "SUBSCRIPTION_STATE_EXPIRED",
      "SUBSCRIPTION_STATE_PENDING",
    ]) {
      const client = fakeClient("user-a");
      client.purchase = { ...client.purchase, subscriptionState: state };
      await expect(
        createProvider(client).verify({
          uid: "user-a",
          platform: "google-play",
          productId: PRODUCT_ID,
          purchaseToken: PURCHASE_TOKEN,
        }),
      ).rejects.toMatchObject({ code: "failed-precondition" });
    }
  });

  it("fails closed for a linked purchase until atomic chain migration exists", async () => {
    const client = fakeClient("user-a");
    client.purchase = {
      ...client.purchase,
      linkedPurchaseToken: "old-token-must-not-be-persisted",
    };
    await expect(
      createProvider(client).verify({
        uid: "user-a",
        platform: "google-play",
        productId: PRODUCT_ID,
        purchaseToken: PURCHASE_TOKEN,
      }),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      details: { kind: "google-play-linked-purchase-unsupported" },
    });
    expect(client.orderCalls).toBe(0);
    expect(client.acknowledgements).toHaveLength(0);
  });

  it("uses server package/product configuration instead of client claims", async () => {
    const client = fakeClient("user-a");
    await expect(
      createProvider(client).verify({
        uid: "user-a",
        platform: "google-play",
        productId: PRODUCT_ID,
        purchaseToken: PURCHASE_TOKEN,
        packageName: "attacker.example",
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(client.subscriptionCalls).toBe(0);
  });

  it("fails closed without exposing vendor network errors", async () => {
    const client = fakeClient("user-a");
    client.subscriptionFailure = new StoreApiFailure("unavailable");
    const promise = createProvider(client).verify({
      uid: "user-a",
      platform: "google-play",
      productId: PRODUCT_ID,
      purchaseToken: PURCHASE_TOKEN,
    });
    await expect(promise).rejects.toMatchObject({ code: "internal" });
    await expect(promise).rejects.not.toThrow(PURCHASE_TOKEN);
  });
});

class FakeGooglePlayClient implements GooglePlayPublisherClient {
  subscriptionCalls = 0;
  orderCalls = 0;
  acknowledgements: [string, string, string][] = [];
  subscriptionFailure: unknown;

  constructor(
    public purchase: GooglePlaySubscriptionPurchase,
    public order: GooglePlayOrder,
  ) {}

  async getSubscription(): Promise<GooglePlaySubscriptionPurchase> {
    this.subscriptionCalls += 1;
    if (this.subscriptionFailure !== undefined) throw this.subscriptionFailure;
    return this.purchase;
  }

  async getOrder(): Promise<GooglePlayOrder> {
    this.orderCalls += 1;
    return this.order;
  }

  async acknowledgeSubscription(
    packageName: string,
    productId: string,
    purchaseToken: string,
  ): Promise<void> {
    this.acknowledgements.push([packageName, productId, purchaseToken]);
  }
}

function fakeClient(uid: string): FakeGooglePlayClient {
  return new FakeGooglePlayClient(
    {
      subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
      startTime: "2026-07-01T00:00:00.000Z",
      externalAccountIdentifiers: {
        obfuscatedExternalAccountId: googlePlayAccountBinding(PACKAGE_NAME, uid),
      },
      lineItems: [
        {
          productId: PRODUCT_ID,
          expiryTime: "2026-08-12T00:00:00.000Z",
          latestSuccessfulOrderId: "GPA.1234-5678-9012-34567",
        },
      ],
      testPurchase: {},
    },
    {
      orderId: "GPA.1234-5678-9012-34567",
      purchaseToken: PURCHASE_TOKEN,
      state: "PROCESSED",
      createTime: NOW.toISOString(),
      lineItems: [{ productId: PRODUCT_ID, subscriptionDetails: {} }],
    },
  );
}

function createProvider(
  client: GooglePlayPublisherClient,
  resolveBindingUids: (uid: string) => Promise<readonly string[]> = async (uid) => [uid],
) {
  return new GooglePlayReceiptVerificationProvider(
    client,
    { packageName: PACKAGE_NAME, productIds: new Set([PRODUCT_ID]) },
    { resolveBindingUids },
    () => NOW,
  );
}
