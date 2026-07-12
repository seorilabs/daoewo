import { describe, expect, it } from "vitest";
import {
  appStoreAccountBinding,
  googlePlayAccountBinding,
  ReceiptProviderRegistry,
  UnconfiguredReceiptVerificationProvider,
} from "../../src/receipts/providers.js";

describe("receipt providers", () => {
  it("keeps mobile/server account binding fixtures stable", () => {
    expect(
      googlePlayAccountBinding("com.seorilabs.daoewo", "user-a"),
    ).toBe("cbd4631b51079c0cefe2b0dbfbf098fc6ea8333ff889bea1a136d5366888d89c");
    expect(appStoreAccountBinding("com.seorilabs.daoewo", "user-a")).toBe(
      "66589c23-2af2-5a68-8e99-8b602e5cefc3",
    );
  });

  it("fails closed when a store verifier is not configured", async () => {
    const registry = new ReceiptProviderRegistry([]);

    await expect(
      registry.get("google-play").verify({
        uid: "user-a",
        platform: "google-play",
        productId: "daoewo.pro.monthly",
        purchaseToken: "client-claim-is-not-proof",
      }),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      message: expect.stringContaining("not configured"),
    });
  });

  it("keeps explicit unconfigured App Store adapter fail-closed", async () => {
    const provider = new UnconfiguredReceiptVerificationProvider("app-store");
    await expect(
      provider.verify({
        uid: "user-a",
        platform: "app-store",
        productId: "daoewo.pro.yearly",
        transactionId: "untrusted-client-transaction",
      }),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("rejects AppsInToss processProductGrant claims without partner verification", async () => {
    const registry = new ReceiptProviderRegistry([]);
    await expect(
      registry.get("apps-in-toss").verify({
        uid: "user-a",
        platform: "apps-in-toss",
        productId: "daoewo.pro.monthly",
        orderId: "order-from-client",
        sku: "daoewo.pro.monthly",
        subscriptionId: "subscription-from-client",
      }),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });
});
