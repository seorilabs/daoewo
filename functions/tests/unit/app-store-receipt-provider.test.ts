import { describe, expect, it } from "vitest";
import {
  AppStoreReceiptVerificationProvider,
  type AppStoreDecodedRenewalInfo,
  type AppStoreDecodedTransaction,
  type AppStoreEnvironment,
  type AppStoreEnvironmentClient,
  type AppStoreSubscriptionStatusResponse,
} from "../../src/receipts/app-store-provider.js";
import {
  appStoreAccountBinding,
  StoreApiFailure,
} from "../../src/receipts/providers.js";

const BUNDLE_ID = "com.seorilabs.daoewo";
const APP_APPLE_ID = 1234567890;
const PRODUCT_ID = "daoewo.pro.yearly";
const UID = "user-a";
const TRANSACTION_ID = "2000000000000001";
const ORIGINAL_TRANSACTION_ID = "1000000000000001";
const NOW = new Date("2026-07-12T00:00:00.000Z");

describe("AppStoreReceiptVerificationProvider", () => {
  it("verifies Apple-signed current subscription status and account token", async () => {
    const production = fakeAppleClient("production");
    const provider = createProvider(production, fakeAppleClient("sandbox"));

    await expect(
      provider.verify({
        uid: UID,
        platform: "app-store",
        productId: PRODUCT_ID,
        transactionId: TRANSACTION_ID,
      }),
    ).resolves.toEqual({
      platform: "app-store",
      productId: PRODUCT_ID,
      originalTransactionId: ORIGINAL_TRANSACTION_ID,
      active: true,
      purchasedAt: "2026-07-12T00:00:00.000Z",
      expiresAt: "2027-07-12T00:00:00.000Z",
      environment: "production",
      authorityObservation: {
        startedAt: NOW.toISOString(),
        observedAt: NOW.toISOString(),
      },
      entitlement: {
        plan: "pro",
        source: "app-store",
        validUntil: "2027-07-12T00:00:00.000Z",
      },
    });
    expect(production.transactionInfoCalls).toBe(1);
    expect(production.statusCalls).toBe(1);
  });

  it("falls back to sandbox only for Apple's transaction-not-found response", async () => {
    const production = fakeAppleClient("production");
    production.transactionFailure = new StoreApiFailure("not-found");
    const sandbox = fakeAppleClient("sandbox");
    const result = await createProvider(production, sandbox).verify({
      uid: UID,
      platform: "app-store",
      productId: PRODUCT_ID,
      transactionId: TRANSACTION_ID,
    });

    expect(result.environment).toBe("sandbox");
    expect(production.transactionInfoCalls).toBe(1);
    expect(sandbox.transactionInfoCalls).toBe(1);
  });

  it("uses the signed billing grace expiry as the entitlement boundary", async () => {
    const production = fakeAppleClient("production");
    production.status = {
      ...production.status,
      lastTransactions: [
        {
          status: 4,
          originalTransactionId: ORIGINAL_TRANSACTION_ID,
          signedTransactionInfo: "latest",
          signedRenewalInfo: "renewal",
        },
      ],
    };
    production.transactions.latest = {
      ...production.transactions.latest!,
      expiresDate: Date.parse("2026-07-11T00:00:00.000Z"),
    };
    production.renewals.renewal = {
      originalTransactionId: ORIGINAL_TRANSACTION_ID,
      productId: PRODUCT_ID,
      appAccountToken: appStoreAccountBinding(BUNDLE_ID, UID),
      environment: "Production",
      gracePeriodExpiresDate: Date.parse("2026-07-19T00:00:00.000Z"),
    };

    await expect(
      createProvider(production, fakeAppleClient("sandbox")).verify({
        uid: UID,
        platform: "app-store",
        productId: PRODUCT_ID,
        transactionId: TRANSACTION_ID,
      }),
    ).resolves.toMatchObject({
      active: true,
      expiresAt: "2026-07-19T00:00:00.000Z",
    });
  });

  it("rejects refunded, revoked, or upgraded signed transactions", async () => {
    for (const mutation of [
      { revocationDate: Date.parse("2026-07-12T00:00:00.000Z") },
      { revocationReason: 1 },
      { revocationType: "FULL" },
      { revocationPercentage: 100000 },
      { isUpgraded: true },
    ]) {
      const production = fakeAppleClient("production");
      production.transactions.latest = {
        ...production.transactions.latest!,
        ...mutation,
      };
      await expect(
        createProvider(production, fakeAppleClient("sandbox")).verify({
          uid: UID,
          platform: "app-store",
          productId: PRODUCT_ID,
          transactionId: TRANSACTION_ID,
        }),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/failed-precondition|permission-denied/),
      });
    }
  });

  it("requires Apple's appAccountToken to bind the purchase to the Firebase uid", async () => {
    const production = fakeAppleClient("production");
    production.transactions.initial = {
      ...production.transactions.initial!,
      appAccountToken: appStoreAccountBinding(BUNDLE_ID, "other-user"),
    };
    await expect(
      createProvider(production, fakeAppleClient("sandbox")).verify({
        uid: UID,
        platform: "app-store",
        productId: PRODUCT_ID,
        transactionId: TRANSACTION_ID,
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(production.statusCalls).toBe(0);
  });

  it("accepts a prior anonymous appAccountToken only for its verified merge target", async () => {
    const sourceUid = "anonymous-source";
    const targetUid = "apple-target";
    const production = fakeAppleClient("production");
    setAccountToken(production, appStoreAccountBinding(BUNDLE_ID, sourceUid));
    await expect(
      createProvider(
        production,
        fakeAppleClient("sandbox"),
        async (uid) => (uid === targetUid ? [targetUid, sourceUid] : [uid]),
      ).verify({
        uid: targetUid,
        platform: "app-store",
        productId: PRODUCT_ID,
        transactionId: TRANSACTION_ID,
      }),
    ).resolves.toMatchObject({ active: true });

    const unrelated = fakeAppleClient("production");
    setAccountToken(unrelated, appStoreAccountBinding(BUNDLE_ID, sourceUid));
    await expect(
      createProvider(unrelated, fakeAppleClient("sandbox")).verify({
        uid: "unrelated-target",
        platform: "app-store",
        productId: PRODUCT_ID,
        transactionId: TRANSACTION_ID,
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("does not route production outages to sandbox or expose vendor errors", async () => {
    const production = fakeAppleClient("production");
    production.transactionFailure = new StoreApiFailure("unavailable");
    const sandbox = fakeAppleClient("sandbox");
    const promise = createProvider(production, sandbox).verify({
      uid: UID,
      platform: "app-store",
      productId: PRODUCT_ID,
      transactionId: TRANSACTION_ID,
    });
    await expect(promise).rejects.toMatchObject({ code: "internal" });
    expect(sandbox.transactionInfoCalls).toBe(0);
  });

  it("cross-checks a legacy receipt transaction id with a supplied id", async () => {
    const provider = new AppStoreReceiptVerificationProvider(
      fakeAppleClient("production"),
      fakeAppleClient("sandbox"),
      { extractTransactionId: () => "different-transaction" },
      {
        bundleId: BUNDLE_ID,
        appAppleId: APP_APPLE_ID,
        productIds: new Set([PRODUCT_ID]),
      },
      { resolveBindingUids: async (uid) => [uid] },
      () => NOW,
    );
    await expect(
      provider.verify({
        uid: UID,
        platform: "app-store",
        productId: PRODUCT_ID,
        transactionId: TRANSACTION_ID,
        receiptData: "untrusted-receipt",
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});

class FakeAppleClient implements AppStoreEnvironmentClient {
  transactionInfoCalls = 0;
  statusCalls = 0;
  transactionFailure: unknown;
  transactions: Record<string, AppStoreDecodedTransaction> = {};
  renewals: Record<string, AppStoreDecodedRenewalInfo> = {};
  status: AppStoreSubscriptionStatusResponse;

  constructor(
    readonly environment: AppStoreEnvironment,
    transaction: AppStoreDecodedTransaction,
  ) {
    this.transactions.initial = transaction;
    this.transactions.latest = {
      ...transaction,
      transactionId: "2000000000000002",
      purchaseDate: NOW.getTime(),
      expiresDate: Date.parse("2027-07-12T00:00:00.000Z"),
    };
    this.status = {
      environment: environment === "production" ? "Production" : "Sandbox",
      bundleId: BUNDLE_ID,
      ...(environment === "production" ? { appAppleId: APP_APPLE_ID } : {}),
      lastTransactions: [
        {
          status: 1,
          originalTransactionId: ORIGINAL_TRANSACTION_ID,
          signedTransactionInfo: "latest",
        },
      ],
    };
  }

  async getTransactionInfo(): Promise<string> {
    this.transactionInfoCalls += 1;
    if (this.transactionFailure !== undefined) throw this.transactionFailure;
    return "initial";
  }

  async getAllSubscriptionStatuses(): Promise<AppStoreSubscriptionStatusResponse> {
    this.statusCalls += 1;
    return this.status;
  }

  async verifyTransaction(signed: string): Promise<AppStoreDecodedTransaction> {
    const value = this.transactions[signed];
    if (value === undefined) throw new StoreApiFailure("invalid-receipt");
    return value;
  }

  async verifyRenewalInfo(signed: string): Promise<AppStoreDecodedRenewalInfo> {
    const value = this.renewals[signed];
    if (value === undefined) throw new StoreApiFailure("invalid-receipt");
    return value;
  }
}

function fakeAppleClient(environment: AppStoreEnvironment): FakeAppleClient {
  const appleEnvironment = environment === "production" ? "Production" : "Sandbox";
  return new FakeAppleClient(environment, {
    transactionId: TRANSACTION_ID,
    originalTransactionId: ORIGINAL_TRANSACTION_ID,
    bundleId: BUNDLE_ID,
    productId: PRODUCT_ID,
    purchaseDate: Date.parse("2026-01-01T00:00:00.000Z"),
    expiresDate: Date.parse("2027-01-01T00:00:00.000Z"),
    type: "Auto-Renewable Subscription",
    appAccountToken: appStoreAccountBinding(BUNDLE_ID, UID),
    environment: appleEnvironment,
  });
}

function createProvider(
  production: AppStoreEnvironmentClient,
  sandbox: AppStoreEnvironmentClient,
  resolveBindingUids: (uid: string) => Promise<readonly string[]> = async (uid) => [uid],
) {
  return new AppStoreReceiptVerificationProvider(
    production,
    sandbox,
    { extractTransactionId: () => TRANSACTION_ID },
    {
      bundleId: BUNDLE_ID,
      appAppleId: APP_APPLE_ID,
      productIds: new Set([PRODUCT_ID]),
    },
    { resolveBindingUids },
    () => NOW,
  );
}

function setAccountToken(client: FakeAppleClient, accountToken: string): void {
  client.transactions.initial = {
    ...client.transactions.initial!,
    appAccountToken: accountToken,
  };
  client.transactions.latest = {
    ...client.transactions.latest!,
    appAccountToken: accountToken,
  };
}
