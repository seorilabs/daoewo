import { describe, expect, it } from "vitest";
import type { Entitlement } from "@daoewo/product-core";
import { ReceiptProviderRegistry } from "../../src/receipts/providers.js";
import { EntitlementService } from "../../src/services/entitlement-service.js";
import { sha256 } from "../../src/utils/hash.js";

describe("EntitlementService", () => {
  it("does not call the grant repository for an unconfigured client receipt", async () => {
    let grants = 0;
    const repository = {
      getEntitlement: async (): Promise<Entitlement | null> => null,
      applyVerifiedReceipt: async () => {
        grants += 1;
        return {
          entitlement: { plan: "pro" as const, source: "bad", validUntil: null },
          authorityPending: false,
        };
      },
      applyVerifiedSubscriptionEvent: async () => ({
        uid: "user-a",
        entitlement: { plan: "free" as const, source: "test", validUntil: null },
        applied: false,
        idempotent: false,
      }),
    };
    const service = new EntitlementService(
      repository,
      repository,
      new ReceiptProviderRegistry([]),
      { now: () => new Date("2026-07-12T00:00:00.000Z") },
    );

    await expect(
      service.verifyReceipt("user-a", {
        platform: "google-play",
        productId: "daoewo.pro.monthly",
        purchaseToken: "untrusted-client-claim",
      }),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    expect(grants).toBe(0);
  });

  it("does not grant AppsInToss entitlement from client order fields", async () => {
    let grants = 0;
    const repository = {
      getEntitlement: async (): Promise<Entitlement | null> => null,
      applyVerifiedReceipt: async () => {
        grants += 1;
        return {
          entitlement: { plan: "pro" as const, source: "bad", validUntil: null },
          authorityPending: false,
        };
      },
    };
    const service = new EntitlementService(
      repository,
      repository as never,
      new ReceiptProviderRegistry([]),
      { now: () => new Date("2026-07-12T00:00:00.000Z") },
    );
    await expect(
      service.verifyReceipt("user-a", {
        platform: "apps-in-toss",
        productId: "daoewo.pro.monthly",
        orderId: "client-order",
        sku: "daoewo.pro.monthly",
        subscriptionId: "client-subscription",
      }),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    expect(grants).toBe(0);
  });

  it("persists the provider's authoritative transaction fingerprint idempotently", async () => {
    const now = new Date("2026-07-12T00:00:00.000Z");
    const verified = {
      platform: "google-play" as const,
      productId: "daoewo.pro.monthly",
      originalTransactionId: "opaque-store-transaction",
      active: true,
      purchasedAt: "2026-07-12T00:00:00.000Z",
      expiresAt: "2026-08-12T00:00:00.000Z",
      environment: "production" as const,
      authorityObservation: {
        startedAt: now.toISOString(),
        observedAt: now.toISOString(),
      },
      entitlement: {
        plan: "pro" as const,
        source: "google-play",
        validUntil: "2026-08-12T00:00:00.000Z",
      },
    };
    let applied:
      | {
          uid: string;
          fingerprint: string;
          observation: { startedAt: string; observedAt: string };
        }
      | undefined;
    const repository = {
      getEntitlement: async (): Promise<Entitlement | null> => null,
      applyVerifiedReceipt: async (
        uid: string,
        _receipt: typeof verified,
        fingerprint: string,
        observation: { startedAt: string; observedAt: string },
      ) => {
        applied = { uid, fingerprint, observation };
        return { entitlement: verified.entitlement, authorityPending: false };
      },
      applyVerifiedSubscriptionEvent: async () => ({
        uid: "user-a",
        entitlement: verified.entitlement,
        applied: false,
        idempotent: true,
      }),
    };
    const service = new EntitlementService(
      repository,
      repository,
      new ReceiptProviderRegistry([
        {
          platform: "google-play",
          verify: async () => verified,
        },
      ]),
      { now: () => now },
    );

    await expect(
      service.verifyReceipt("user-a", {
        platform: "google-play",
        productId: verified.productId,
        purchaseToken: "never-persist-client-token",
      }),
    ).resolves.toMatchObject({ active: true });
    expect(applied).toEqual({
      uid: "user-a",
      fingerprint: sha256(
        `${verified.platform}:${verified.originalTransactionId}`,
      ),
      observation: verified.authorityObservation,
    });
  });

  it("returns a retryable failure when a pre-claim authority barrier holds the grant", async () => {
    const now = new Date("2026-07-12T00:00:00.000Z");
    const verified = {
      platform: "google-play" as const,
      productId: "daoewo.pro.monthly",
      originalTransactionId: "opaque-store-transaction",
      active: true,
      purchasedAt: now.toISOString(),
      expiresAt: "2026-08-12T00:00:00.000Z",
      environment: "production" as const,
      authorityObservation: {
        startedAt: now.toISOString(),
        observedAt: now.toISOString(),
      },
      entitlement: {
        plan: "pro" as const,
        source: "google-play",
        validUntil: "2026-08-12T00:00:00.000Z",
      },
    };
    const repository = {
      getEntitlement: async (): Promise<Entitlement | null> => null,
      applyVerifiedReceipt: async () => ({
        entitlement: {
          plan: "free" as const,
          source: "google-play",
          validUntil: null,
        },
        authorityPending: true,
      }),
      applyVerifiedSubscriptionEvent: async () => ({
        uid: "user-a",
        entitlement: verified.entitlement,
        applied: false,
        idempotent: true,
      }),
    };
    const service = new EntitlementService(
      repository,
      repository,
      new ReceiptProviderRegistry([
        { platform: "google-play", verify: async () => verified },
      ]),
      { now: () => now },
    );

    await expect(
      service.verifyReceipt("user-a", {
        platform: "google-play",
        productId: verified.productId,
        purchaseToken: "never-persist-client-token",
      }),
    ).rejects.toMatchObject({
      code: "aborted",
      details: { kind: "receipt-authority-pending" },
    });
  });
});
