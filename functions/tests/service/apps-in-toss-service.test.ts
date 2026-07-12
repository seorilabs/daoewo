import { describe, expect, it } from "vitest";
import {
  UnconfiguredAppsInTossPartnerProvider,
  type AppsInTossPartnerProvider,
} from "../../src/apps-in-toss/provider.js";
import { AppsInTossService } from "../../src/services/apps-in-toss-service.js";

describe("AppsInTossService", () => {
  it("returns only a Firebase custom token after one-time server exchange", async () => {
    const claimed: Array<{ fingerprint: string; requesterHash: string; hourlyLimit: number }> = [];
    const issued: Array<{ uid: string; claims?: Record<string, unknown> }> = [];
    const provider: AppsInTossPartnerProvider = {
      exchangeAuthorizationCode: async () => ({ subject: "opaque-toss-user-key" }),
      verifySubscriptionWebhook: async () => {
        throw new Error("unused");
      },
    };
    const service = new AppsInTossService(
      provider,
      {
        claimOneTimeAuthorizationCode: async (
          fingerprint,
          requesterHash,
          hourlyLimit,
        ) => {
          claimed.push({ fingerprint, requesterHash, hourlyLimit });
        },
        consumeAppCheckRefreshQuota: async () => undefined,
      },
      activeAccounts(),
      {
        createCustomToken: async (uid, claims) => {
          issued.push({ uid, ...(claims === undefined ? {} : { claims }) });
          return "firebase-custom-token";
        },
      },
      {
        createToken: async () => ({ token: "firebase-app-check-token", ttlMillis: 3_600_000 }),
      },
      "1:123:web:daoewo-ait",
      fakeEntitlements(),
      { now: () => new Date("2026-07-12T00:00:00.000Z") },
    );

    const result = await service.exchangeLogin(
      {
        authorizationCode: "one-time-code",
        referrer: "intoss://daoewo/login",
      },
      "203.0.113.1",
    );

    expect(result).toEqual({
      firebaseCustomToken: "firebase-custom-token",
      firebaseAppCheckToken: "firebase-app-check-token",
      appCheckTokenTtlMillis: 3_600_000,
    });
    expect(claimed[0]?.fingerprint).not.toBe("one-time-code");
    expect(claimed[0]?.requesterHash).not.toBe("203.0.113.1");
    expect(claimed[0]?.hourlyLimit).toBe(30);
    expect(issued[0]?.uid).toMatch(/^toss_[a-f0-9]{64}$/);
    expect(issued[0]?.claims).toEqual({ signInProvider: "apps-in-toss" });
  });

  it("fails closed without mTLS provider and never issues a token", async () => {
    let issued = false;
    const service = new AppsInTossService(
      new UnconfiguredAppsInTossPartnerProvider(),
      {
        claimOneTimeAuthorizationCode: async () => undefined,
        consumeAppCheckRefreshQuota: async () => undefined,
      },
      activeAccounts(),
      {
        createCustomToken: async () => {
          issued = true;
          return "must-not-be-issued";
        },
      },
      { createToken: async () => ({ token: "unused", ttlMillis: 1 }) },
      "1:123:web:daoewo-ait",
      fakeEntitlements(),
      { now: () => new Date("2026-07-12T00:00:00.000Z") },
    );

    await expect(
      service.exchangeLogin(
        {
          authorizationCode: "one-time-code",
          referrer: "intoss://daoewo/login",
        },
        "203.0.113.1",
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    expect(issued).toBe(false);
  });

  it("fails closed on an unverified subscription webhook", async () => {
    let applied = false;
    const entitlements = fakeEntitlements();
    entitlements.applyVerifiedSubscriptionEvent = async () => {
      applied = true;
      throw new Error("must not run");
    };
    const service = new AppsInTossService(
      new UnconfiguredAppsInTossPartnerProvider(),
      {
        claimOneTimeAuthorizationCode: async () => undefined,
        consumeAppCheckRefreshQuota: async () => undefined,
      },
      activeAccounts(),
      { createCustomToken: async () => "unused" },
      { createToken: async () => ({ token: "unused", ttlMillis: 1 }) },
      "1:123:web:daoewo-ait",
      entitlements,
      { now: () => new Date("2026-07-12T00:00:00.000Z") },
    );

    await expect(
      service.processSubscriptionWebhook({ headers: {}, rawBody: Buffer.from("{}"), body: {} }),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    expect(applied).toBe(false);
  });

  it("fails before consuming a code when the AIT App Check appId is missing", async () => {
    let claimed = false;
    const service = new AppsInTossService(
      new UnconfiguredAppsInTossPartnerProvider(),
      {
        claimOneTimeAuthorizationCode: async () => {
          claimed = true;
        },
        consumeAppCheckRefreshQuota: async () => undefined,
      },
      activeAccounts(),
      { createCustomToken: async () => "unused" },
      { createToken: async () => ({ token: "unused", ttlMillis: 1 }) },
      undefined,
      fakeEntitlements(),
      { now: () => new Date("2026-07-12T00:00:00.000Z") },
    );

    await expect(
      service.exchangeLogin(
        { authorizationCode: "one-time-code", referrer: "intoss://daoewo/login" },
        "203.0.113.1",
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    expect(claimed).toBe(false);
  });

  it("refreshes only App Check for a valid AppsInToss Firebase identity", async () => {
    const quotas: Array<{ uid: string; requesterHash: string; limit: number }> = [];
    const service = new AppsInTossService(
      new UnconfiguredAppsInTossPartnerProvider(),
      {
        claimOneTimeAuthorizationCode: async () => undefined,
        consumeAppCheckRefreshQuota: async (uid, requesterHash, limit) => {
          quotas.push({ uid, requesterHash, limit });
        },
      },
      activeAccounts(),
      { createCustomToken: async () => "must-not-be-issued" },
      {
        createToken: async () => ({ token: "refreshed-app-check", ttlMillis: 3_600_000 }),
      },
      "1:123:web:daoewo-ait",
      fakeEntitlements(),
      { now: () => new Date("2026-07-12T00:00:00.000Z") },
    );
    const uid = `toss_${"a".repeat(64)}`;

    await expect(
      service.refreshAppCheck(uid, "apps-in-toss", "203.0.113.2"),
    ).resolves.toEqual({
      firebaseAppCheckToken: "refreshed-app-check",
      appCheckTokenTtlMillis: 3_600_000,
    });
    expect(quotas).toHaveLength(1);
    expect(quotas[0]).toMatchObject({ uid, limit: 12 });
    expect(quotas[0]?.requesterHash).not.toBe("203.0.113.2");
  });

  it("rejects App Check refresh for another Firebase sign-in provider", async () => {
    let quotaUsed = false;
    const service = new AppsInTossService(
      new UnconfiguredAppsInTossPartnerProvider(),
      {
        claimOneTimeAuthorizationCode: async () => undefined,
        consumeAppCheckRefreshQuota: async () => {
          quotaUsed = true;
        },
      },
      activeAccounts(),
      { createCustomToken: async () => "unused" },
      { createToken: async () => ({ token: "unused", ttlMillis: 1 }) },
      "1:123:web:daoewo-ait",
      fakeEntitlements(),
      { now: () => new Date("2026-07-12T00:00:00.000Z") },
    );

    await expect(
      service.refreshAppCheck(`toss_${"a".repeat(64)}`, "google.com", "203.0.113.2"),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(quotaUsed).toBe(false);
  });

  it("rejects a deleted deterministic Toss uid before issuing Firebase tokens", async () => {
    let customTokenIssued = false;
    let appCheckTokenIssued = false;
    const service = new AppsInTossService(
      {
        exchangeAuthorizationCode: async () => ({ subject: "deleted-toss-user" }),
        verifySubscriptionWebhook: async () => {
          throw new Error("unused");
        },
      },
      {
        claimOneTimeAuthorizationCode: async () => undefined,
        consumeAppCheckRefreshQuota: async () => undefined,
      },
      {
        assertAccountActive: async () => {
          throw Object.assign(new Error("This account is being deleted."), {
            code: "failed-precondition",
            details: { kind: "account-deleting" },
          });
        },
      },
      {
        createCustomToken: async () => {
          customTokenIssued = true;
          return "must-not-be-issued";
        },
      },
      {
        createToken: async () => {
          appCheckTokenIssued = true;
          return { token: "must-not-be-issued", ttlMillis: 1 };
        },
      },
      "1:123:web:daoewo-ait",
      fakeEntitlements(),
      { now: () => new Date("2026-07-12T00:00:00.000Z") },
    );

    await expect(
      service.exchangeLogin(
        {
          authorizationCode: "one-time-code",
          referrer: "intoss://daoewo/login",
        },
        "203.0.113.1",
      ),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      details: { kind: "account-deleting" },
    });
    expect(customTokenIssued).toBe(false);
    expect(appCheckTokenIssued).toBe(false);
  });
});

function activeAccounts() {
  return { assertAccountActive: async () => undefined };
}

function fakeEntitlements() {
  return {
    getEntitlement: async () => null,
    applyVerifiedReceipt: async () => ({
      entitlement: {
        plan: "free" as const,
        source: "apps-in-toss",
        validUntil: null,
      },
      authorityPending: false,
    }),
    applyVerifiedSubscriptionEvent: async () => ({
      uid: "user-a",
      entitlement: { plan: "free" as const, source: "apps-in-toss", validUntil: null },
      applied: false,
      idempotent: false,
    }),
  };
}
