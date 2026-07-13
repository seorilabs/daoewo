import { describe, expect, it } from "vitest";
import { BackendError } from "../../src/errors.js";
import { StoreNotificationService } from "../../src/store-notifications/service.js";
import { decideStoreNotificationUpdate } from "../../src/store-notifications/policy.js";
import type {
  AppStoreSubscriptionNotification,
  AuthoritativeSubscriptionState,
  GooglePlaySubscriptionNotification,
  StoreNotificationRepository,
  StoreSubscriptionStateProvider,
} from "../../src/store-notifications/types.js";

const NOW = new Date("2026-07-12T00:00:00.000Z");
const FINGERPRINT = "receipt-fingerprint";

describe("StoreNotificationService", () => {
  it("retries a notification that wins the race against the first receipt claim", async () => {
    let resolution = 0;
    let storeCalls = 0;
    const repository: StoreNotificationRepository = {
      resolveReceiptClaim: async () => claimed("user-a"),
      resolveReceiptClaimForNotification: async (input) => {
        expect(input).toEqual({
          fingerprint: FINGERPRINT,
          platform: "google-play",
          now: NOW,
        });
        resolution += 1;
        return resolution === 1
          ? { kind: "missing", fingerprint: FINGERPRINT }
          : claimed("user-a");
      },
      applyAuthoritativeSubscriptionState: async ({ expectedClaim }) => ({
        outcome: "applied",
        uid: expectedClaim.uid,
        entitlement: inactiveState().entitlement,
      }),
    };
    const provider = stateProvider(async () => {
      storeCalls += 1;
      return inactiveState();
    });
    const service = new StoreNotificationService(
      repository,
      provider,
      {} as never,
      { now: () => NOW },
    );

    await expect(service.process(notification())).rejects.toMatchObject({
      code: "aborted",
      details: { kind: "receipt-claim-pending" },
    });
    expect(storeCalls).toBe(0);
    await expect(service.process(notification())).resolves.toMatchObject({
      outcome: "applied",
      entitlement: { plan: "free" },
    });
    expect(storeCalls).toBe(1);
  });

  it("ACKs an account-deleted tombstone without querying a store", async () => {
    let storeCalls = 0;
    const provider = stateProvider(async () => {
      storeCalls += 1;
      return activeState();
    });
    const repository: StoreNotificationRepository = {
      resolveReceiptClaim: async () => ({
        kind: "account-deleted",
        fingerprint: FINGERPRINT,
      }),
      resolveReceiptClaimForNotification: async () => ({
        kind: "account-deleted",
        fingerprint: FINGERPRINT,
      }),
      applyAuthoritativeSubscriptionState: async () => {
        throw new Error("must not apply");
      },
    };
    const service = new StoreNotificationService(
      repository,
      provider,
      {} as never,
      { now: () => NOW },
    );
    await expect(service.process(notification())).resolves.toEqual({
      outcome: "account-deleted",
      uid: null,
    });
    expect(storeCalls).toBe(0);
  });

  it("ACKs a superseded Google Play token without querying or revoking the successor", async () => {
    let storeCalls = 0;
    const repository: StoreNotificationRepository = {
      resolveReceiptClaim: async () => ({
        kind: "superseded",
        fingerprint: FINGERPRINT,
        successorFingerprint: "successor-fingerprint",
      }),
      resolveReceiptClaimForNotification: async () => ({
        kind: "superseded",
        fingerprint: FINGERPRINT,
        successorFingerprint: "successor-fingerprint",
      }),
      applyAuthoritativeSubscriptionState: async () => {
        throw new Error("must not apply an old-token event");
      },
    };
    const provider = stateProvider(async () => {
      storeCalls += 1;
      return inactiveState();
    });
    const service = new StoreNotificationService(
      repository,
      provider,
      {} as never,
      { now: () => NOW },
    );

    await expect(service.process(notification())).resolves.toEqual({
      outcome: "superseded",
      uid: null,
    });
    expect(storeCalls).toBe(0);
  });

  it("returns the repository's idempotent duplicate outcome", async () => {
    const repository = fakeClaimedRepository("idempotent");
    const service = new StoreNotificationService(
      repository,
      stateProvider(async () => activeState()),
      {} as never,
      { now: () => NOW },
    );
    await expect(service.process(notification())).resolves.toMatchObject({
      outcome: "idempotent",
      uid: "user-a",
    });
  });

  it("re-resolves a claim after an account merge races authoritative lookup", async () => {
    let resolution = 0;
    const resolvedUids: string[] = [];
    const provider: StoreSubscriptionStateProvider<GooglePlaySubscriptionNotification> = {
      platform: "google-play",
      getState: async (_notification, claim) => {
        resolvedUids.push(claim.uid);
        if (claim.uid === "source-user") {
          throw new BackendError(
            "failed-precondition",
            "Account was merged.",
            { kind: "account-merged" },
          );
        }
        return activeState();
      },
    };
    const repository: StoreNotificationRepository = {
      resolveReceiptClaim: async () => claimed("target-user"),
      resolveReceiptClaimForNotification: async () => {
        resolution += 1;
        return claimed(resolution === 1 ? "source-user" : "target-user");
      },
      applyAuthoritativeSubscriptionState: async ({ expectedClaim }) => ({
        outcome: "applied",
        uid: expectedClaim.uid,
        entitlement: activeState().entitlement,
      }),
    };
    const service = new StoreNotificationService(
      repository,
      provider,
      {} as never,
      { now: () => NOW },
    );

    await expect(service.process(notification())).resolves.toMatchObject({
      outcome: "applied",
      uid: "target-user",
    });
    expect(resolvedUids).toEqual(["source-user", "target-user"]);
  });

  it("passes an old Apple product trigger with the current same-chain product to the repository", async () => {
    const oldProductId = "daoewo.pro.monthly";
    const currentProductId = "daoewo.pro.yearly";
    const appleNotification: AppStoreSubscriptionNotification = {
      platform: "app-store",
      eventType: "subscription.status_changed",
      notificationType: "DID_CHANGE_RENEWAL_PREF",
      environment: "production",
      transactionId: "transaction-old-trigger",
      productId: oldProductId,
      originalTransactionId: "apple-original-a",
      receiptFingerprint: FINGERPRINT,
      cursor: { eventId: "apple-delayed-old-product", occurredAt: NOW.toISOString() },
    };
    const repository: StoreNotificationRepository = {
      resolveReceiptClaim: async () => ({
        kind: "claimed",
        fingerprint: FINGERPRINT,
        uid: "user-a",
        platform: "app-store",
        productId: oldProductId,
        originalTransactionId: "apple-original-a",
      }),
      resolveReceiptClaimForNotification: async () => ({
        kind: "claimed",
        fingerprint: FINGERPRINT,
        uid: "user-a",
        platform: "app-store",
        productId: oldProductId,
        originalTransactionId: "apple-original-a",
      }),
      applyAuthoritativeSubscriptionState: async ({ state, expectedClaim }) => {
        expect(expectedClaim.productId).toBe(oldProductId);
        expect(state.productId).toBe(currentProductId);
        return {
          outcome: "applied",
          uid: expectedClaim.uid,
          entitlement: state.entitlement,
        };
      },
    };
    const appStore: StoreSubscriptionStateProvider<AppStoreSubscriptionNotification> = {
      platform: "app-store",
      getState: async () => ({
        active: true,
        platform: "app-store",
        productId: currentProductId,
        originalTransactionId: "apple-original-a",
        environment: "production",
        storeState: "1",
        authorityObservation: {
          startedAt: NOW.toISOString(),
          observedAt: NOW.toISOString(),
        },
        purchasedAt: NOW.toISOString(),
        validUntil: "2027-07-12T00:00:00.000Z",
        entitlement: {
          plan: "pro",
          source: "app-store",
          validUntil: "2027-07-12T00:00:00.000Z",
        },
      }),
    };
    const service = new StoreNotificationService(
      repository,
      {} as never,
      appStore,
      { now: () => NOW },
    );
    await expect(service.process(appleNotification)).resolves.toMatchObject({
      outcome: "applied",
    });
  });
});

describe("store notification monotonic/superseded policy", () => {
  it("applies current revoked authority even when the trigger cursor is older", () => {
    expect(
      decideStoreNotificationUpdate({
        current: {
          entitlement: activeState().entitlement,
          receiptFingerprint: FINGERPRINT,
          cursor: {
            eventId: "new-event",
            occurredAt: "2026-07-12T00:00:00.000Z",
          },
          authorityObservation: {
            startedAt: "2026-07-12T00:00:00.000Z",
            observedAt: "2026-07-12T00:00:30.000Z",
            observationId: "google-play:new-event",
          },
        },
        incomingFingerprint: FINGERPRINT,
        incomingCursor: {
          eventId: "old-event",
          occurredAt: "2026-07-11T00:00:00.000Z",
        },
        incomingObservation: {
          startedAt: "2026-07-12T00:01:00.000Z",
          observedAt: "2026-07-12T00:01:30.000Z",
          observationId: "google-play:old-event",
        },
        incomingState: inactiveState(),
        now: NOW,
      }),
    ).toBe("apply");
  });

  it("does not let an older authority query restore a newer revocation", () => {
    expect(
      decideStoreNotificationUpdate({
        current: {
          entitlement: inactiveState().entitlement,
          receiptFingerprint: FINGERPRINT,
          authorityObservation: {
            startedAt: "2026-07-12T00:02:00.000Z",
            observedAt: "2026-07-12T00:02:30.000Z",
            observationId: "google-play:revoked",
          },
        },
        incomingFingerprint: FINGERPRINT,
        incomingCursor: {
          eventId: "late-active-result",
          occurredAt: "2026-07-12T00:03:00.000Z",
        },
        incomingObservation: {
          startedAt: "2026-07-12T00:01:00.000Z",
          observedAt: "2026-07-12T00:03:00.000Z",
          observationId: "google-play:late-active-result",
        },
        incomingState: activeState(),
        now: NOW,
      }),
    ).toBe("stale");
  });

  it("breaks equal observation-time ties deterministically in favor of inactive authority", () => {
    const startedAt = "2026-07-12T00:01:00.000Z";
    expect(
      decideStoreNotificationUpdate({
        current: {
          entitlement: activeState().entitlement,
          receiptFingerprint: FINGERPRINT,
          authorityObservation: {
            startedAt,
            observedAt: startedAt,
            observationId: "google-play:active",
          },
        },
        incomingFingerprint: FINGERPRINT,
        incomingCursor: notification().cursor,
        incomingObservation: {
          startedAt,
          observedAt: startedAt,
          observationId: "google-play:inactive",
        },
        incomingState: inactiveState(),
        now: NOW,
      }),
    ).toBe("apply");
    expect(
      decideStoreNotificationUpdate({
        current: {
          entitlement: inactiveState().entitlement,
          receiptFingerprint: FINGERPRINT,
          authorityObservation: {
            startedAt,
            observedAt: startedAt,
            observationId: "google-play:inactive",
          },
        },
        incomingFingerprint: FINGERPRINT,
        incomingCursor: notification().cursor,
        incomingObservation: {
          startedAt,
          observedAt: startedAt,
          observationId: "google-play:active",
        },
        incomingState: activeState(),
        now: NOW,
      }),
    ).toBe("stale");
  });

  it("does not let an old token revoke a newer receipt fingerprint", () => {
    expect(
      decideStoreNotificationUpdate({
        current: {
          entitlement: activeState().entitlement,
          receiptFingerprint: "new-receipt-fingerprint",
        },
        incomingFingerprint: "old-receipt-fingerprint",
        incomingCursor: {
          eventId: "old-token-revoked",
          occurredAt: NOW.toISOString(),
        },
        incomingObservation: {
          startedAt: NOW.toISOString(),
          observedAt: NOW.toISOString(),
          observationId: "google-play:old-token-revoked",
        },
        incomingState: inactiveState(),
        now: NOW,
      }),
    ).toBe("superseded");
  });

  it.each([
    {
      label: "older",
      current: ["2026-07-12T00:02:00.000Z", "2026-07-12T00:03:00.000Z"],
      incoming: ["2026-07-12T00:00:00.000Z", "2026-07-12T00:01:00.000Z"],
      expected: "superseded",
    },
    {
      label: "overlapping",
      current: ["2026-07-12T00:01:00.000Z", "2026-07-12T00:03:00.000Z"],
      incoming: ["2026-07-12T00:02:00.000Z", "2026-07-12T00:04:00.000Z"],
      expected: "superseded",
    },
    {
      label: "definitely later",
      current: ["2026-07-12T00:00:00.000Z", "2026-07-12T00:01:00.000Z"],
      incoming: ["2026-07-12T00:02:00.000Z", "2026-07-12T00:03:00.000Z"],
      expected: "apply",
    },
  ])("handles a $label cross-fingerprint active observation", ({ current, incoming, expected }) => {
    expect(
      decideStoreNotificationUpdate({
        current: {
          entitlement: inactiveState().entitlement,
          receiptFingerprint: "revoked-receipt",
          authorityObservation: {
            startedAt: current[0]!,
            observedAt: current[1]!,
            observationId: "google-play:revoked-receipt",
          },
        },
        incomingFingerprint: "different-active-receipt",
        incomingCursor: notification().cursor,
        incomingObservation: {
          startedAt: incoming[0]!,
          observedAt: incoming[1]!,
          observationId: "google-play:different-active-receipt",
        },
        incomingState: activeState(),
        now: NOW,
      }),
    ).toBe(expected);
  });

  it("fails closed for a reversed authority observation window", () => {
    expect(() =>
      decideStoreNotificationUpdate({
        current: {
          entitlement: inactiveState().entitlement,
          receiptFingerprint: FINGERPRINT,
          authorityObservation: {
            startedAt: "2026-07-12T00:00:00.000Z",
            observedAt: "2026-07-12T00:01:00.000Z",
            observationId: "google-play:current",
          },
        },
        incomingFingerprint: FINGERPRINT,
        incomingCursor: notification().cursor,
        incomingObservation: {
          startedAt: "2026-07-12T00:03:00.000Z",
          observedAt: "2026-07-12T00:02:00.000Z",
          observationId: "google-play:reversed",
        },
        incomingState: activeState(),
        now: NOW,
      }),
    ).toThrowError(expect.objectContaining({ code: "internal" }));
  });
});

function stateProvider(
  getState: () => Promise<AuthoritativeSubscriptionState>,
): StoreSubscriptionStateProvider<GooglePlaySubscriptionNotification> {
  return { platform: "google-play", getState };
}

function fakeClaimedRepository(
  outcome: "idempotent",
): StoreNotificationRepository {
  return {
    resolveReceiptClaim: async () => claimed("user-a"),
    resolveReceiptClaimForNotification: async () => claimed("user-a"),
    applyAuthoritativeSubscriptionState: async () => ({
      outcome,
      uid: "user-a",
      entitlement: activeState().entitlement,
    }),
  };
}

function claimed(uid: string) {
  return {
    kind: "claimed" as const,
    fingerprint: FINGERPRINT,
    uid,
    platform: "google-play" as const,
    productId: "daoewo.pro.monthly",
    originalTransactionId: "original-a",
  };
}

function notification(): GooglePlaySubscriptionNotification {
  return {
    platform: "google-play",
    eventType: "subscription.status_changed",
    notificationType: 2,
    packageName: "com.seorilabs.daoewo",
    purchaseToken: "not-persisted",
    receiptFingerprint: FINGERPRINT,
    originalTransactionId: "original-a",
    cursor: { eventId: "event-a", occurredAt: NOW.toISOString() },
  };
}

function activeState(): AuthoritativeSubscriptionState {
  return {
    active: true,
    platform: "google-play",
    productId: "daoewo.pro.monthly",
    originalTransactionId: "original-a",
    environment: "production",
    storeState: "SUBSCRIPTION_STATE_ACTIVE",
    authorityObservation: {
      startedAt: NOW.toISOString(),
      observedAt: NOW.toISOString(),
    },
    purchasedAt: "2026-07-01T00:00:00.000Z",
    validUntil: "2026-08-12T00:00:00.000Z",
    entitlement: {
      plan: "pro",
      source: "google-play",
      validUntil: "2026-08-12T00:00:00.000Z",
    },
  };
}

function inactiveState(): AuthoritativeSubscriptionState {
  return {
    active: false,
    platform: "google-play",
    productId: "daoewo.pro.monthly",
    originalTransactionId: "original-a",
    environment: "production",
    storeState: "SUBSCRIPTION_STATE_EXPIRED",
    authorityObservation: {
      startedAt: NOW.toISOString(),
      observedAt: NOW.toISOString(),
    },
    reason: "expired",
    lastKnownExpiry: "2026-07-11T00:00:00.000Z",
    entitlement: { plan: "free", source: "google-play", validUntil: null },
  };
}
