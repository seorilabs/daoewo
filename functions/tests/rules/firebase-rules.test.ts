import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { getBytes, ref, uploadString } from "firebase/storage";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  initializeApp as initializeAdminApp,
  deleteApp as deleteAdminApp,
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  getFirestore as getAdminFirestore,
  Timestamp,
} from "firebase-admin/firestore";
import { FirestoreRepository } from "../../src/repositories/firestore-repository.js";
import { googlePlayReceiptIdentity } from "../../src/receipts/fingerprint.js";
import { sha256 } from "../../src/utils/hash.js";
import { createInitialCardProgress } from "@daoewo/product-core";
import { FirestoreReconciliationCursorRepository } from "../../src/store-notifications/firestore-reconciliation-cursor.js";
import {
  NotificationInstallationService,
  notificationInstallationHash,
} from "../../src/notifications/installation-service.js";
import { MAX_NOTIFICATION_INSTALLATIONS_PER_ACCOUNT } from "../../src/notifications/policy.js";
import {
  DeckReadyNotificationService,
  deckReadyNotificationEventId,
} from "../../src/notifications/deck-ready-outbox.js";
import { AccountMergeCleanupService } from "../../src/services/account-merge-cleanup-service.js";

let environment: RulesTestEnvironment;
const adminApp = initializeAdminApp(
  { projectId: "demo-daoewo-rules" },
  "daoewo-repository-tests"
);
const adminDb = getAdminFirestore(adminApp);
const adminAuth = getAdminAuth(adminApp);

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-daoewo-rules",
    firestore: {
      rules: readFileSync(
        resolve(process.cwd(), "../firebase/firestore.rules"),
        "utf8"
      ),
    },
    storage: {
      rules: readFileSync(
        resolve(process.cwd(), "../firebase/storage.rules"),
        "utf8"
      ),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
});

afterAll(async () => {
  if (environment !== undefined) await environment.cleanup();
  await deleteAdminApp(adminApp);
});

describe("Firestore rules", () => {
  it("shows both Free and locked Pro published metadata to authenticated users", async () => {
    await seedFirestore(async (db) => {
      await setDoc(doc(db, "decks/free-deck"), {
        status: "published",
        tier: "free",
      });
      await setDoc(doc(db, "decks/pro-deck"), {
        status: "published",
        tier: "pro",
      });
      await setDoc(doc(db, "decks/draft-deck"), {
        status: "draft",
        tier: "pro",
      });
    });
    const authenticated = environment
      .authenticatedContext("user-a")
      .firestore();
    const anonymous = environment.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(authenticated, "decks/free-deck")));
    await assertSucceeds(getDoc(doc(authenticated, "decks/pro-deck")));
    await assertFails(getDoc(doc(authenticated, "decks/draft-deck")));
    await assertFails(getDoc(doc(anonymous, "decks/free-deck")));
    await assertSucceeds(
      getDocs(
        query(
          collection(authenticated, "decks"),
          where("status", "==", "published")
        )
      )
    );
    await assertFails(getDocs(collection(authenticated, "decks")));
  });

  it("routes goal/progress sync through Functions and exposes only own entitlement", async () => {
    await seedFirestore(async (db) => {
      await setDoc(doc(db, "users/user-a/goals/deck-a"), { uid: "user-a" });
      await setDoc(doc(db, "users/user-a/deckProgress/deck-a"), {
        uid: "user-a",
      });
      await setDoc(doc(db, "users/user-a/entitlements/pro"), { uid: "user-a" });
    });
    const owner = environment.authenticatedContext("user-a").firestore();
    const other = environment.authenticatedContext("user-b").firestore();

    await assertFails(getDoc(doc(owner, "users/user-a/goals/deck-a")));
    await assertFails(getDoc(doc(owner, "users/user-a/deckProgress/deck-a")));
    await assertSucceeds(getDoc(doc(owner, "users/user-a/entitlements/pro")));
    await assertFails(getDoc(doc(other, "users/user-a/goals/deck-a")));
    await assertFails(
      setDoc(doc(owner, "users/user-a/goals/deck-b"), { active: true })
    );
    await assertFails(
      setDoc(doc(owner, "users/user-a/deckProgress/deck-a"), { forged: true })
    );
    await assertFails(
      setDoc(doc(owner, "users/user-a/entitlements/pro"), { plan: "pro" })
    );
  });

  it("never exposes premium bodies, delivery logs, counters, or receipt claims", async () => {
    await seedFirestore(async (db) => {
      await setDoc(doc(db, "deckContent/pro-deck/chunks/chunk-0"), {
        cards: ["secret"],
      });
      await setDoc(doc(db, "deliveryLogs/window-a"), { uid: "user-a" });
      await setDoc(doc(db, "deliveryCounters/user-a"), { count: 1 });
      await setDoc(doc(db, "receiptClaims/hash-a"), { uid: "user-a" });
      await setDoc(doc(db, "receiptAuthorityBarriers/hash-a"), {
        state: "pending",
        platform: "google-play",
      });
      await setDoc(doc(db, "subscriptionEvents/event-a"), { uid: "user-a" });
      await setDoc(doc(db, "storeReconciliationCursors/google-play-voided"), {
        completedThrough: "secret-cursor",
      });
      await setDoc(doc(db, "tossAuthCodeClaims/code-a"), { consumed: true });
      await setDoc(doc(db, "tossAuthExchangeCounters/ip-a"), { count: 1 });
      await setDoc(doc(db, "tossAppCheckRefreshCounters/user-a"), { count: 1 });
      await setDoc(doc(db, "notificationInstallations/install-a"), {
        uid: "user-a",
        fcmToken: "server-only-token",
      });
      await setDoc(doc(db, "notificationOutbox/event-a"), {
        kind: "deck-ready",
        requestId: "request-a",
      });
      await setDoc(doc(db, "catalogNotificationEvents/event-a"), {
        kind: "catalog-published",
        status: "claimed",
      });
      await setDoc(doc(db, "accountMerges/user-a"), { targetUid: "user-b" });
      await setDoc(doc(db, "accountDeletions/user-a"), { status: "pending" });
      await setDoc(doc(db, "users/user-a/sync/devicePolicy"), {
        primaryDeviceHash: "secret-hash",
      });
    });
    const owner = environment.authenticatedContext("user-a").firestore();
    await assertFails(
      getDoc(doc(owner, "deckContent/pro-deck/chunks/chunk-0"))
    );
    await assertFails(getDoc(doc(owner, "deliveryLogs/window-a")));
    await assertFails(getDoc(doc(owner, "deliveryCounters/user-a")));
    await assertFails(getDoc(doc(owner, "receiptClaims/hash-a")));
    await assertFails(getDoc(doc(owner, "receiptAuthorityBarriers/hash-a")));
    await assertFails(
      setDoc(doc(owner, "receiptAuthorityBarriers/hash-b"), {
        state: "pending",
        platform: "google-play",
      })
    );
    await assertFails(getDoc(doc(owner, "subscriptionEvents/event-a")));
    await assertFails(
      getDoc(doc(owner, "storeReconciliationCursors/google-play-voided"))
    );
    await assertFails(getDoc(doc(owner, "tossAuthCodeClaims/code-a")));
    await assertFails(getDoc(doc(owner, "tossAuthExchangeCounters/ip-a")));
    await assertFails(getDoc(doc(owner, "tossAppCheckRefreshCounters/user-a")));
    await assertFails(
      getDoc(doc(owner, "notificationInstallations/install-a"))
    );
    await assertFails(
      setDoc(doc(owner, "notificationInstallations/install-b"), {
        fcmToken: "forged",
      })
    );
    await assertFails(getDoc(doc(owner, "notificationOutbox/event-a")));
    await assertFails(
      setDoc(doc(owner, "notificationOutbox/event-b"), { status: "pending" })
    );
    await assertFails(getDoc(doc(owner, "catalogNotificationEvents/event-a")));
    await assertFails(
      setDoc(doc(owner, "catalogNotificationEvents/event-b"), {
        status: "delivered",
      })
    );
    await assertFails(getDoc(doc(owner, "accountMerges/user-a")));
    await assertFails(getDoc(doc(owner, "accountDeletions/user-a")));
    await assertFails(getDoc(doc(owner, "users/user-a/sync/devicePolicy")));
  });

  it("lets users read only their own requests and requires Functions for creation", async () => {
    await seedFirestore(async (db) => {
      await setDoc(doc(db, "deckRequests/request-a"), {
        uid: "user-a",
        topic: "관세법",
      });
    });
    const owner = environment.authenticatedContext("user-a").firestore();
    const other = environment.authenticatedContext("user-b").firestore();
    await assertSucceeds(getDoc(doc(owner, "deckRequests/request-a")));
    await assertFails(getDoc(doc(other, "deckRequests/request-a")));
    await assertFails(
      setDoc(doc(owner, "deckRequests/request-b"), {
        uid: "user-a",
        priority: "pro",
      })
    );
  });
});

describe("notification installation lifecycle", () => {
  it("upserts one installation owner, returns no identifier, and unregisters only the owner", async () => {
    const repository = new FirestoreRepository(adminDb, adminAuth);
    const service = new NotificationInstallationService(repository, {
      now: () => new Date("2026-07-12T00:00:00.000Z"),
    });
    const deviceId = "stable-notification-device-1234";
    const registration = {
      deviceId,
      fcmToken: "fcm-token-at-least-sixteen-characters",
      platform: "android" as const,
      locale: "ko-KR",
      appVersion: "1.0.0",
      buildNumber: "1",
    };

    const response = await service.register(
      "notification-user-a",
      registration
    );
    expect(response).toEqual({ registered: true });
    expect(JSON.stringify(response)).not.toMatch(/uid|token|device/i);
    const ref = adminDb.doc(
      `notificationInstallations/${notificationInstallationHash(deviceId)}`
    );
    expect((await ref.get()).data()).toMatchObject({
      uid: "notification-user-a",
      appId: "daoewo",
      platform: "android",
      deckReadyEnabled: true,
    });

    await service.register("notification-user-b", {
      ...registration,
      fcmToken: "rotated-fcm-token-at-least-sixteen",
    });
    expect((await ref.get()).data()?.uid).toBe("notification-user-b");
    await service.unregister("notification-user-a", { deviceId });
    expect((await ref.get()).exists).toBe(true);
    await service.unregister("notification-user-b", { deviceId });
    expect((await ref.get()).exists).toBe(false);
  });

  it("persists a deterministic recipient-free outbox and resolves the current owner at delivery", async () => {
    const now = new Date("2026-07-12T00:00:00.000Z");
    const uid = "notification-delivery-user";
    const requestId = "notification-ready-request";
    const rawToken = "fcm-token-that-must-never-enter-outbox";
    const repository = new FirestoreRepository(adminDb, adminAuth);
    await new NotificationInstallationService(repository, {
      now: () => now,
    }).register(uid, {
      deviceId: "stable-delivery-device-1234",
      fcmToken: rawToken,
      platform: "ios",
      locale: "ko-KR",
      appVersion: "1.0.0",
      buildNumber: "1",
    });
    await adminDb.doc(`deckRequests/${requestId}`).set({
      uid,
      topic: "private-ready-topic",
      note: "private-ready-note",
      status: "ready",
      readyDeckId: "ready-deck-a",
      readyRevision: 3,
      readyAt: Timestamp.fromDate(now),
    });
    const sendDeckReady = vi.fn(async () => ({
      deliveredCount: 1,
      invalidInstallationHashes: [],
      transientFailureCount: 0,
      permanentFailureCount: 0,
    }));
    const service = new DeckReadyNotificationService(
      repository,
      repository,
      { sendDeckReady },
      { now: () => now }
    );
    const transition = {
      requestId,
      before: { status: "queued" },
      after: {
        status: "ready",
        readyDeckId: "ready-deck-a",
        readyRevision: 3,
        readyAt: now,
      },
    };

    await expect(service.enqueue(transition)).resolves.toMatchObject({
      created: true,
      eventId: deckReadyNotificationEventId(requestId, 3),
    });
    await expect(service.enqueue(transition)).resolves.toMatchObject({
      created: false,
    });
    const eventId = deckReadyNotificationEventId(requestId, 3);
    const pending = await adminDb.doc(`notificationOutbox/${eventId}`).get();
    expect(JSON.stringify(pending.data())).not.toMatch(
      /notification-delivery-user|fcm-token-that-must-never-enter-outbox|private-ready-topic|private-ready-note/
    );

    await expect(service.process(eventId)).resolves.toEqual({
      outcome: "delivered",
    });
    expect(sendDeckReady).toHaveBeenCalledWith(
      {
        eventId,
      },
      [expect.objectContaining({ fcmToken: rawToken, platform: "ios" })]
    );
    const completed = await adminDb.doc(`notificationOutbox/${eventId}`).get();
    expect(completed.data()).toMatchObject({
      status: "delivered",
      completionReason: "delivered",
      deliveredCount: 1,
      attemptCount: 1,
    });
    expect(JSON.stringify(completed.data())).not.toMatch(
      /notification-delivery-user|fcm-token-that-must-never-enter-outbox|private-ready-topic|private-ready-note/
    );
  });

  it("leases one delivery transactionally and releases the lease before retry", async () => {
    const now = new Date("2026-07-12T01:00:00.000Z");
    const uid = "notification-lease-user";
    const requestId = "notification-lease-request";
    const rawToken = "lease-test-token-that-must-stay-out-of-outbox";
    const repository = new FirestoreRepository(adminDb, adminAuth);
    await new NotificationInstallationService(repository, {
      now: () => now,
    }).register(uid, {
      deviceId: "stable-lease-device-1234",
      fcmToken: rawToken,
      platform: "android",
      locale: "ko-KR",
      appVersion: "1.0.0",
      buildNumber: "1",
    });
    await adminDb.doc(`deckRequests/${requestId}`).set({
      uid,
      status: "ready",
      readyDeckId: "ready-deck-lease",
      readyRevision: 1,
      readyAt: Timestamp.fromDate(now),
    });
    let releaseFirstSend!: () => void;
    const firstSendReleased = new Promise<void>((resolve) => {
      releaseFirstSend = resolve;
    });
    let markFirstSendStarted!: () => void;
    const firstSendStarted = new Promise<void>((resolve) => {
      markFirstSendStarted = resolve;
    });
    let sendCount = 0;
    const sendDeckReady = vi.fn(async () => {
      sendCount += 1;
      if (sendCount === 1) {
        markFirstSendStarted();
        await firstSendReleased;
        return {
          deliveredCount: 0,
          invalidInstallationHashes: [],
          transientFailureCount: 1,
          permanentFailureCount: 0,
        };
      }
      return {
        deliveredCount: 1,
        invalidInstallationHashes: [],
        transientFailureCount: 0,
        permanentFailureCount: 0,
      };
    });
    const service = new DeckReadyNotificationService(
      repository,
      repository,
      { sendDeckReady },
      { now: () => now }
    );
    const transition = {
      requestId,
      before: { status: "queued" },
      after: {
        status: "ready",
        readyDeckId: "ready-deck-lease",
        readyRevision: 1,
        readyAt: now,
      },
    };
    await service.enqueue(transition);
    const eventId = deckReadyNotificationEventId(requestId, 1);

    const first = service.process(eventId);
    await firstSendStarted;
    await expect(service.process(eventId)).rejects.toMatchObject({
      safeCode: "delivery-contention",
    });
    expect(sendDeckReady).toHaveBeenCalledTimes(1);
    releaseFirstSend();
    await expect(first).rejects.toMatchObject({
      safeCode: "messaging-transient",
    });

    const retryable = await adminDb.doc(`notificationOutbox/${eventId}`).get();
    expect(retryable.data()).toMatchObject({
      status: "pending",
      attemptCount: 1,
      lastErrorCode: "messaging-transient",
    });
    expect(retryable.data()).not.toHaveProperty("leaseId");
    expect(retryable.data()).not.toHaveProperty("leaseUntil");
    expect(JSON.stringify(retryable.data())).not.toContain(rawToken);

    await expect(service.process(eventId)).resolves.toEqual({
      outcome: "delivered",
    });
    expect(sendDeckReady).toHaveBeenCalledTimes(2);
    const completed = await adminDb.doc(`notificationOutbox/${eventId}`).get();
    expect(completed.data()).toMatchObject({
      status: "delivered",
      attemptCount: 2,
    });
    expect(completed.data()).not.toHaveProperty("leaseId");
    expect(completed.data()).not.toHaveProperty("leaseUntil");
  });

  it("retries catalog event leases and multicasts only to current opt-in installations", async () => {
    const repository = new FirestoreRepository(adminDb, adminAuth);
    const now = new Date("2026-07-13T04:00:00.000Z");
    const expiresAt = new Date("2026-08-12T04:00:00.000Z");
    const leaseUntil = new Date("2026-07-13T04:05:00.000Z");
    const eventId = "catalog-event-hash";
    await Promise.all([
      adminDb.doc("notificationInstallations/catalog-live").set({
        schemaVersion: 1,
        appId: "daoewo",
        uid: "catalog-user",
        fcmToken: "catalog-live-token",
        fcmTokenHash: sha256("catalog-live-token"),
        platform: "android",
        locale: "ko-KR",
        deckReadyEnabled: true,
        expiresAt: Timestamp.fromDate(expiresAt),
      }),
      adminDb.doc("notificationInstallations/catalog-opted-out").set({
        schemaVersion: 1,
        appId: "daoewo",
        uid: "catalog-user",
        fcmToken: "catalog-opted-out-token",
        platform: "ios",
        deckReadyEnabled: false,
        expiresAt: Timestamp.fromDate(expiresAt),
      }),
      adminDb.doc("notificationInstallations/catalog-expired").set({
        schemaVersion: 1,
        appId: "daoewo",
        uid: "catalog-user",
        fcmToken: "catalog-expired-token",
        platform: "ios",
        deckReadyEnabled: true,
        expiresAt: Timestamp.fromDate(new Date("2026-07-12T00:00:00.000Z")),
      }),
    ]);

    await expect(
      repository.claimCatalogNotificationEvent({
        eventId,
        leaseId: "catalog-lease-1",
        now,
        leaseUntil,
        expiresAt,
        maxAttempts: 8,
      })
    ).resolves.toBe(true);
    await expect(
      repository.claimCatalogNotificationEvent({
        eventId,
        leaseId: "catalog-lease-concurrent",
        now,
        leaseUntil,
        expiresAt,
        maxAttempts: 8,
      })
    ).rejects.toMatchObject({
      code: "aborted",
      details: { kind: "catalog-notification-lease-active" },
    });
    await repository.completeCatalogNotificationEvent({
      eventId,
      leaseId: "catalog-lease-1",
      status: "failed",
      now,
    });
    await expect(
      repository.claimCatalogNotificationEvent({
        eventId,
        leaseId: "catalog-lease-2",
        now,
        leaseUntil,
        expiresAt,
        maxAttempts: 8,
      })
    ).resolves.toBe(true);

    await expect(
      repository.listCatalogNotificationInstallations(now)
    ).resolves.toEqual([
      {
        installationHash: "catalog-live",
        fcmToken: "catalog-live-token",
        platform: "android",
        locale: "ko-KR",
      },
    ]);
    await adminDb.doc("notificationInstallations/catalog-live").update({
      uid: "catalog-rebound-user",
      fcmToken: "catalog-rebound-token",
      fcmTokenHash: sha256("catalog-rebound-token"),
    });
    await repository.deleteCatalogNotificationInstallations([
      {
        installationHash: "catalog-live",
        fcmTokenHash: sha256("catalog-live-token"),
      },
    ]);
    expect(
      (await adminDb.doc("notificationInstallations/catalog-live").get())
        .exists
    ).toBe(true);
    await repository.deleteCatalogNotificationInstallations([
      {
        installationHash: "catalog-live",
        fcmTokenHash: sha256("catalog-rebound-token"),
      },
    ]);
    expect(
      (await adminDb.doc("notificationInstallations/catalog-live").get())
        .exists
    ).toBe(false);

    await repository.completeCatalogNotificationEvent({
      eventId,
      leaseId: "catalog-lease-2",
      status: "delivered",
      now,
    });
    await expect(
      repository.claimCatalogNotificationEvent({
        eventId,
        leaseId: "catalog-lease-3",
        now,
        leaseUntil,
        expiresAt,
        maxAttempts: 8,
      })
    ).resolves.toBe(false);
    const event = (
      await adminDb.doc(`catalogNotificationEvents/${eventId}`).get()
    ).data();
    expect(event).toMatchObject({
      kind: "catalog-published",
      status: "delivered",
      attemptCount: 2,
    });
    expect(event).not.toHaveProperty("leaseId");
    expect(event).not.toHaveProperty("leaseUntil");
    expect(JSON.stringify(event)).not.toMatch(/catalog-live-token|catalog-user/);
  });
});

describe("deck request operator completion", () => {
  it("atomically commits one queued -> ready transition and makes concurrent repeats idempotent", async () => {
    const repository = new FirestoreRepository(adminDb, adminAuth);
    const now = new Date("2026-07-13T03:04:05.000Z");
    await seedPublishedDeck("operator-ready-deck");
    await seedQueuedDeckRequest("operator-request-a");

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        repository.completeDeckRequest({
          requestId: "operator-request-a",
          readyDeckId: "operator-ready-deck",
          now,
        })
      )
    );

    expect(results.filter((result) => !result.idempotent)).toHaveLength(1);
    expect(results.filter((result) => result.idempotent)).toHaveLength(3);
    for (const result of results) {
      expect(result.request).toMatchObject({
        id: "operator-request-a",
        status: "ready",
        readyDeckId: "operator-ready-deck",
        readyRevision: 1,
        readyAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    }
    const stored = (
      await adminDb.doc("deckRequests/operator-request-a").get()
    ).data();
    expect(stored).toMatchObject({
      status: "ready",
      readyDeckId: "operator-ready-deck",
      readyRevision: 1,
    });
    expect(stored?.readyAt.toDate().toISOString()).toBe(now.toISOString());
    expect(stored?.updatedAt.toDate().toISOString()).toBe(now.toISOString());
  }, 10_000);

  it("allows only one of two concurrent target decks and preserves one consistent result", async () => {
    const repository = new FirestoreRepository(adminDb, adminAuth);
    const now = new Date("2026-07-13T03:04:05.000Z");
    await Promise.all([
      seedPublishedDeck("operator-ready-deck-a"),
      seedPublishedDeck("operator-ready-deck-b"),
    ]);
    await seedQueuedDeckRequest("operator-request-race");

    const results = await Promise.allSettled(
      ["operator-ready-deck-a", "operator-ready-deck-b"].map((readyDeckId) =>
        repository.completeDeckRequest({
          requestId: "operator-request-race",
          readyDeckId,
          now,
        })
      )
    );

    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "failed-precondition" },
    });
    const stored = (
      await adminDb.doc("deckRequests/operator-request-race").get()
    ).data();
    expect(stored?.status).toBe("ready");
    expect(["operator-ready-deck-a", "operator-ready-deck-b"]).toContain(
      stored?.readyDeckId
    );
    expect(stored?.readyRevision).toBe(1);
    expect(stored?.readyAt.toDate().toISOString()).toBe(now.toISOString());
  });

  it("rejects unpublished targets and malformed partial ready state without mutation", async () => {
    const repository = new FirestoreRepository(adminDb, adminAuth);
    const now = new Date("2026-07-13T03:04:05.000Z");
    await adminDb.doc("decks/operator-draft-deck").set({ status: "draft" });
    await seedQueuedDeckRequest("operator-request-draft");
    await seedQueuedDeckRequest("operator-request-partial", {
      readyDeckId: "operator-draft-deck",
    });

    await expect(
      repository.completeDeckRequest({
        requestId: "operator-request-draft",
        readyDeckId: "operator-draft-deck",
        now,
      })
    ).rejects.toMatchObject({
      code: "failed-precondition",
      details: { kind: "ready-deck-unavailable" },
    });
    await expect(
      repository.completeDeckRequest({
        requestId: "operator-request-partial",
        readyDeckId: "operator-draft-deck",
        now,
      })
    ).rejects.toMatchObject({
      code: "failed-precondition",
      details: { kind: "deck-request-state-invalid" },
    });
    expect(
      (await adminDb.doc("deckRequests/operator-request-draft").get()).data()
    ).not.toHaveProperty("readyAt");
  });
});

describe("Storage rules", () => {
  it("denies direct read and write of immutable deck chunks even when authenticated", async () => {
    const path = "decks/pro-deck/v1/chunk-0.json";
    await environment.withSecurityRulesDisabled(async (context) => {
      await uploadString(
        ref(context.storage(), path),
        JSON.stringify({ cards: [] })
      );
    });
    const storage = environment.authenticatedContext("user-a").storage();
    await assertFails(getBytes(ref(storage, path)));
    await assertFails(uploadString(ref(storage, path), "{}"));
  });
});

describe("Firestore reconciliation cursor", () => {
  it("resumes pagination and advances completed windows without storing payloads", async () => {
    const cursors = new FirestoreReconciliationCursorRepository(adminDb);
    const first = await cursors.acquireWindow({
      key: "google-play-voided",
      now: new Date("2026-07-12T03:00:00.000Z"),
      lookbackMs: 29 * 24 * 60 * 60 * 1_000,
      overlapMs: 60 * 60 * 1_000,
      staleWindowGraceMs: 23 * 60 * 60 * 1_000,
    });
    await cursors.advanceWindow({
      window: first,
      nextPageToken: "vendor-page-2",
      now: new Date("2026-07-12T03:01:00.000Z"),
    });
    const resumed = await cursors.acquireWindow({
      key: "google-play-voided",
      now: new Date("2026-07-12T03:02:00.000Z"),
      lookbackMs: 29 * 24 * 60 * 60 * 1_000,
      overlapMs: 60 * 60 * 1_000,
      staleWindowGraceMs: 23 * 60 * 60 * 1_000,
    });
    expect(resumed).toMatchObject({
      startTime: first.startTime,
      endTime: first.endTime,
      pageToken: "vendor-page-2",
    });
    await cursors.restartWindow({
      window: resumed,
      now: new Date("2026-07-12T03:02:30.000Z"),
    });
    const restarted = await cursors.acquireWindow({
      key: "google-play-voided",
      now: new Date("2026-07-12T03:02:45.000Z"),
      lookbackMs: 29 * 24 * 60 * 60 * 1_000,
      overlapMs: 60 * 60 * 1_000,
      staleWindowGraceMs: 23 * 60 * 60 * 1_000,
    });
    expect(restarted).toMatchObject({
      startTime: first.startTime,
      endTime: first.endTime,
      pageToken: null,
    });
    await cursors.advanceWindow({
      window: restarted,
      nextPageToken: null,
      now: new Date("2026-07-12T03:03:00.000Z"),
    });

    const stored = await adminDb
      .doc("storeReconciliationCursors/google-play-voided")
      .get();
    expect(stored.data()?.completedThrough.toDate()).toEqual(first.endTime);
    expect(stored.data()?.pageToken).toBeUndefined();
    expect(JSON.stringify(stored.data())).not.toMatch(
      /purchaseToken|signedPayload|transactionId|originalTransactionId/
    );
  });

  it("abandons an unpaged window only after the vendor lookback recovery margin expires", async () => {
    const cursors = new FirestoreReconciliationCursorRepository(adminDb);
    const firstNow = new Date("2026-07-12T03:00:00.000Z");
    const first = await cursors.acquireWindow({
      key: "app-store-production-history",
      now: firstNow,
      lookbackMs: 179 * 24 * 60 * 60 * 1_000,
      overlapMs: 6 * 60 * 60 * 1_000,
      staleWindowGraceMs: 23 * 60 * 60 * 1_000,
    });
    const recovered = await cursors.acquireWindow({
      key: "app-store-production-history",
      now: new Date(firstNow.getTime() + 24 * 60 * 60 * 1_000),
      lookbackMs: 179 * 24 * 60 * 60 * 1_000,
      overlapMs: 6 * 60 * 60 * 1_000,
      staleWindowGraceMs: 23 * 60 * 60 * 1_000,
    });

    expect(recovered.pageToken).toBeNull();
    expect(recovered.startTime.getTime()).toBeGreaterThan(
      first.startTime.getTime()
    );
    const stored = await adminDb
      .doc("storeReconciliationCursors/app-store-production-history")
      .get();
    expect(stored.data()?.abandonedWindowCount).toBe(1);
    expect(stored.data()?.lastAbandonedWindowStart.toDate()).toEqual(
      first.startTime
    );
  });
});

describe("FirestoreRepository account merge", () => {
  it("reconciles learning backup idempotently while direct clients cannot read or forge it", async () => {
    const repository = new FirestoreRepository(adminDb, adminAuth);
    const uid = "learning-backup-user";
    const now = new Date("2026-07-12T00:00:00.000Z");
    const state = createInitialCardProgress("free-card.1", "free-deck", now);
    const snapshot = {
      version: 1 as const,
      freeDecks: [
        {
          deckId: "free-deck",
          deckVersion: 1,
          active: true,
          goal: null,
          progresses: [{ cardIndex: 0, state }],
        },
      ],
      sessions: [],
    };

    const first = await repository.reconcileLearningBackup({
      uid,
      baseRevision: 0,
      mutationId: "sync_mutation_one",
      snapshot,
      maxActiveFreeDecks: 1,
      now,
    });
    const duplicate = await repository.reconcileLearningBackup({
      uid,
      baseRevision: 0,
      mutationId: "sync_mutation_one",
      snapshot: { version: 1, freeDecks: [], sessions: [] },
      maxActiveFreeDecks: 1,
      now: new Date("2026-07-12T00:01:00.000Z"),
    });
    const newerState = {
      ...state,
      knownCount: 1,
      updatedAt: "2026-07-12T00:02:00.000Z",
    };
    const staleMerge = await repository.reconcileLearningBackup({
      uid,
      baseRevision: 0,
      mutationId: "sync_mutation_two",
      snapshot: {
        ...snapshot,
        freeDecks: [
          {
            ...snapshot.freeDecks[0]!,
            progresses: [{ cardIndex: 0, state: newerState }],
          },
        ],
      },
      maxActiveFreeDecks: 1,
      now: new Date("2026-07-12T00:02:00.000Z"),
    });

    expect(first.revision).toBe(1);
    expect(duplicate).toEqual(first);
    expect(staleMerge).toMatchObject({ revision: 2 });
    expect(
      staleMerge.snapshot.freeDecks[0]?.progresses[0]?.state.knownCount
    ).toBe(1);
    const stored = await adminDb.doc(`users/${uid}/sync/learningBackup`).get();
    expect(JSON.stringify(stored.data())).not.toMatch(
      /front|back|cardSnapshots|deviceHash|recentBatches/
    );

    const owner = environment.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(owner, `users/${uid}/sync/learningBackup`)));
    await assertFails(
      setDoc(doc(owner, `users/${uid}/sync/learningBackup`), {
        revision: 999,
      })
    );
  });

  it("binds Free sync to one device while Pro can use another device", async () => {
    const repository = new FirestoreRepository(adminDb, adminAuth);
    const uid = "primary-device-user";
    const now = new Date("2026-07-12T00:00:00.000Z");

    await expect(
      repository.ensureDeviceAccess(uid, "device-a-hash", false, now)
    ).resolves.toBeUndefined();
    await expect(
      repository.ensureDeviceAccess(uid, "device-b-hash", false, now)
    ).rejects.toMatchObject({
      code: "permission-denied",
      details: { kind: "primary-device-mismatch" },
    });
    await expect(
      repository.ensureDeviceAccess(uid, "device-b-hash", true, now)
    ).resolves.toBeUndefined();
  });

  it("atomically moves progress, entitlement, receipt, and free-text requests", async () => {
    const sourceUid = "merge-source-success";
    const targetUid = "merge-target-success";
    await recreateAuthUsers(sourceUid, targetUid);
    await seedMergeAccount(sourceUid, "receipt-source", true);
    await adminDb.collection("receiptClaims").doc("receipt-source").set({
      uid: sourceUid,
      platform: "google-play",
    });
    await adminDb
      .collection("deckRequests")
      .doc("source-request")
      .set({
        uid: sourceUid,
        topic: "source-only-topic",
        note: "source-only-private-note",
        updatedAt: Timestamp.fromDate(new Date("2026-07-11T00:00:00.000Z")),
      });
    await adminDb
      .collection("notificationInstallations")
      .doc("source-installation")
      .set({
        schemaVersion: 1,
        appId: "daoewo",
        uid: sourceUid,
        fcmToken: "source-fcm-token-never-logged",
        fcmTokenHash: sha256("source-fcm-token-never-logged"),
        platform: "android",
        deckReadyEnabled: true,
        locale: "ko-KR",
        appVersion: "1.0.0",
        buildNumber: "1",
        createdAt: Timestamp.fromDate(new Date("2026-07-11T00:00:00.000Z")),
        tokenUpdatedAt: Timestamp.fromDate(
          new Date("2026-07-11T00:00:00.000Z")
        ),
        lastSeenAt: Timestamp.fromDate(new Date("2026-07-11T00:00:00.000Z")),
        updatedAt: Timestamp.fromDate(new Date("2026-07-11T00:00:00.000Z")),
        expiresAt: Timestamp.fromDate(new Date("2026-08-15T00:00:00.000Z")),
      });
    await Promise.all([
      adminDb.doc(`users/${sourceUid}/sync/learningBackup`).set({
        revision: 1,
        updatedAt: Timestamp.fromDate(new Date("2026-07-11T01:00:00.000Z")),
        snapshot: {
          version: 1,
          freeDecks: [],
          sessions: [
            backupSession("source-session", "2026-07-11T01:00:00.000Z"),
          ],
        },
        recentMutationIds: ["source_sync"],
      }),
      adminDb.doc(`users/${targetUid}/sync/learningBackup`).set({
        revision: 2,
        updatedAt: Timestamp.fromDate(new Date("2026-07-11T02:00:00.000Z")),
        snapshot: {
          version: 1,
          freeDecks: [],
          sessions: [
            backupSession("target-session", "2026-07-11T02:00:00.000Z"),
          ],
        },
        recentMutationIds: ["target_sync"],
      }),
    ]);
    const repository = new FirestoreRepository(adminDb, adminAuth);

    await expect(
      repository.mergeAnonymousAccount({
        sourceUid,
        targetUid,
        deviceHash: "primary-device-hash",
        now: new Date("2026-07-12T00:00:00.000Z"),
      })
    ).resolves.toMatchObject({
      merged: true,
      goalCount: 1,
      progressDeckCount: 1,
      entitlementMoved: true,
    });

    const [
      sourceProgress,
      targetProgress,
      targetEntitlement,
      claim,
      marker,
      request,
      sourceLearningBackup,
      targetLearningBackup,
      notificationInstallation,
    ] = await Promise.all([
      adminDb.doc(`users/${sourceUid}/deckProgress/deck-a`).get(),
      adminDb.doc(`users/${targetUid}/deckProgress/deck-a`).get(),
      adminDb.doc(`users/${targetUid}/entitlements/pro`).get(),
      adminDb.doc("receiptClaims/receipt-source").get(),
      adminDb.doc(`accountMerges/${sourceUid}`).get(),
      adminDb.doc("deckRequests/source-request").get(),
      adminDb.doc(`users/${sourceUid}/sync/learningBackup`).get(),
      adminDb.doc(`users/${targetUid}/sync/learningBackup`).get(),
      adminDb.doc("notificationInstallations/source-installation").get(),
    ]);
    expect(sourceProgress.exists).toBe(false);
    expect(targetProgress.data()?.uid).toBe(targetUid);
    expect(targetEntitlement.data()?.entitlement.plan).toBe("pro");
    expect(claim.data()?.uid).toBe(targetUid);
    expect(marker.data()?.targetUid).toBe(targetUid);
    expect(request.data()).toMatchObject({
      uid: targetUid,
      topic: "source-only-topic",
      note: "source-only-private-note",
    });
    expect(request.data()?.sourceUid).toBeUndefined();
    expect(sourceLearningBackup.exists).toBe(false);
    expect(
      targetLearningBackup
        .data()
        ?.snapshot.sessions.map((session: { id: string }) => session.id)
    ).toEqual(["source-session", "target-session"]);
    expect(targetLearningBackup.data()?.revision).toBe(3);
    expect(notificationInstallation.data()?.uid).toBe(targetUid);
    expect(notificationInstallation.data()?.mergedFromUid).toBeUndefined();
    expect(marker.data()).toMatchObject({
      schemaVersion: 2,
      sourceUid,
      targetUid,
      goalCount: 1,
      progressDeckCount: 1,
      entitlementMoved: true,
      cleanupStatus: "pending",
      cleanupAttemptCount: 0,
    });
    const mergedSourceClient = environment
      .authenticatedContext(sourceUid)
      .firestore();
    await assertFails(
      getDoc(doc(mergedSourceClient, `users/${sourceUid}`))
    );
    await expect(
      repository.mergeAnonymousAccount({
        sourceUid,
        targetUid,
        deviceHash: "primary-device-hash",
        now: new Date("2026-07-12T00:01:00.000Z"),
      })
    ).resolves.toMatchObject({
      merged: true,
      goalCount: 1,
      progressDeckCount: 1,
      entitlementMoved: true,
    });
    await expect(adminAuth.getUser(sourceUid)).resolves.toMatchObject({
      uid: sourceUid,
    });
    await expect(
      new AccountMergeCleanupService(
        repository,
        { now: () => new Date("2026-07-12T00:02:00.000Z") },
        () => "merge-cleanup-lease"
      ).process(sourceUid)
    ).resolves.toEqual({ outcome: "completed" });
    await expect(adminAuth.getUser(sourceUid)).rejects.toMatchObject({
      code: "auth/user-not-found",
    });
    await expect(adminAuth.getUser(targetUid)).resolves.toMatchObject({
      customClaims: { daoewoPlan: "pro" },
    });
    await expect(
      adminDb.doc(`accountMerges/${sourceUid}`).get()
    ).resolves.toMatchObject({
      exists: true,
    });
    expect(
      (await adminDb.doc(`accountMerges/${sourceUid}`).get()).data()
        ?.cleanupStatus
    ).toBe("complete");
  });

  it("fails closed when both accounts own different receipt entitlements", async () => {
    const sourceUid = "merge-source-conflict";
    const targetUid = "merge-target-conflict";
    await recreateAuthUsers(sourceUid, targetUid);
    await seedMergeAccount(sourceUid, "receipt-source-conflict", true);
    await seedMergeAccount(targetUid, "receipt-target-conflict", false);
    await Promise.all([
      adminDb.collection("receiptClaims").doc("receipt-source-conflict").set({
        uid: sourceUid,
      }),
      adminDb.collection("receiptClaims").doc("receipt-target-conflict").set({
        uid: targetUid,
      }),
    ]);
    const repository = new FirestoreRepository(adminDb, adminAuth);

    await expect(
      repository.mergeAnonymousAccount({
        sourceUid,
        targetUid,
        deviceHash: "primary-device-hash",
        now: new Date("2026-07-12T00:00:00.000Z"),
      })
    ).rejects.toMatchObject({
      code: "failed-precondition",
      details: { kind: "entitlement-ownership-conflict" },
    });
    await expect(
      adminDb.doc(`users/${sourceUid}/deckProgress/deck-a`).get()
    ).resolves.toMatchObject({ exists: true });
    await expect(
      adminDb.doc(`accountMerges/${sourceUid}`).get()
    ).resolves.toMatchObject({ exists: false });
    await expect(
      adminDb.doc("receiptClaims/receipt-source-conflict").get()
    ).resolves.toMatchObject({
      exists: true,
    });
  });

  it("keeps the newest ten notification installations across an account merge", async () => {
    const sourceUid = "merge-installation-cap-source";
    const targetUid = "merge-installation-cap-target";
    const installationCount = MAX_NOTIFICATION_INSTALLATIONS_PER_ACCOUNT + 6;
    const installations = Array.from(
      { length: installationCount },
      (_, index) => {
        const deviceId = `merge-notification-device-${String(index).padStart(2, "0")}`;
        const fcmToken = `merge-notification-token-${String(index).padStart(2, "0")}`;
        const seenAt = new Date(Date.UTC(2026, 6, 1, index));
        return {
          index,
          deviceId,
          fcmToken,
          installationHash: notificationInstallationHash(deviceId),
          uid: index % 2 === 0 ? sourceUid : targetUid,
          seenAt,
        };
      }
    );
    await recreateAuthUsers(sourceUid, targetUid);
    const batch = adminDb.batch();
    for (const installation of installations) {
      batch.set(
        adminDb.doc(
          `notificationInstallations/${installation.installationHash}`
        ),
        {
          schemaVersion: 1,
          appId: "daoewo",
          uid: installation.uid,
          fcmToken: installation.fcmToken,
          fcmTokenHash: sha256(installation.fcmToken),
          platform: installation.index % 2 === 0 ? "android" : "ios",
          deckReadyEnabled: true,
          locale: "ko-KR",
          appVersion: "1.0.0",
          buildNumber: "1",
          createdAt: Timestamp.fromDate(installation.seenAt),
          tokenUpdatedAt: Timestamp.fromDate(installation.seenAt),
          lastSeenAt: Timestamp.fromDate(installation.seenAt),
          // 병합 같은 운영 write가 실제 기기 lastSeen 우선순위를 덮지 않아야 한다.
          updatedAt: Timestamp.fromDate(
            installation.index === 0
              ? new Date("2026-07-11T23:00:00.000Z")
              : installation.seenAt
          ),
          expiresAt: Timestamp.fromDate(new Date("2026-08-15T00:00:00.000Z")),
        }
      );
    }
    await batch.commit();
    const repository = new FirestoreRepository(adminDb, adminAuth);

    await expect(
      repository.mergeAnonymousAccount({
        sourceUid,
        targetUid,
        deviceHash: "primary-device-hash",
        now: new Date("2026-07-12T00:00:00.000Z"),
      })
    ).resolves.toMatchObject({ merged: true });

    const merged = await adminDb
      .collection("notificationInstallations")
      .where("uid", "==", targetUid)
      .get();
    const expectedRetainedIds = new Set(
      installations
        .slice(-MAX_NOTIFICATION_INSTALLATIONS_PER_ACCOUNT)
        .map((installation) => installation.installationHash)
    );
    expect(merged.size).toBe(MAX_NOTIFICATION_INSTALLATIONS_PER_ACCOUNT);
    expect(new Set(merged.docs.map((document) => document.id))).toEqual(
      expectedRetainedIds
    );
    expect(
      (
        await adminDb
          .collection("notificationInstallations")
          .where("uid", "==", sourceUid)
          .get()
      ).empty
    ).toBe(true);

    const retainedSourceInstallation = installations.at(-2)!;
    expect(retainedSourceInstallation.uid).toBe(sourceUid);
    await expect(
      new NotificationInstallationService(repository, {
        now: () => new Date("2026-07-13T00:00:00.000Z"),
      }).register(targetUid, {
        deviceId: retainedSourceInstallation.deviceId,
        fcmToken: "rotated-token-after-account-merge",
        platform: "android",
        locale: "ko-KR",
        appVersion: "1.0.1",
        buildNumber: "2",
      })
    ).resolves.toEqual({ registered: true });
    expect(
      (
        await adminDb.doc(
          `notificationInstallations/${retainedSourceInstallation.installationHash}`
        ).get()
      ).data()?.fcmToken
    ).toBe("rotated-token-after-account-merge");
  });

  it("leases durable account-merge cleanup and safely reclaims failed work", async () => {
    const sourceUid = "merge-cleanup-lease-source";
    const targetUid = "merge-cleanup-lease-target";
    const now = new Date("2026-07-12T00:00:00.000Z");
    await adminDb.doc(`accountMerges/${sourceUid}`).set({
      schemaVersion: 2,
      sourceUid,
      targetUid,
      mergedAt: Timestamp.fromDate(now),
      billingBindingRetained: true,
      goalCount: 0,
      progressDeckCount: 0,
      entitlementMoved: false,
      cleanupStatus: "pending",
      cleanupAttemptCount: 0,
      cleanupUpdatedAt: Timestamp.fromDate(now),
    });
    const repository = new FirestoreRepository(adminDb, adminAuth);
    const firstLeaseUntil = new Date(now.getTime() + 5 * 60 * 1_000);

    await expect(
      repository.claimAccountMergeCleanup({
        sourceUid,
        leaseId: "lease-one",
        now,
        leaseUntil: firstLeaseUntil,
      })
    ).resolves.toEqual({ sourceUid, targetUid });
    await expect(
      repository.claimAccountMergeCleanup({
        sourceUid,
        leaseId: "lease-two",
        now: new Date(now.getTime() + 1_000),
        leaseUntil: new Date(now.getTime() + 6 * 60 * 1_000),
      })
    ).rejects.toMatchObject({
      code: "aborted",
      details: { kind: "account-merge-cleanup-lease-active" },
    });
    await repository.recordAccountMergeCleanupRetry({
      sourceUid,
      leaseId: "lease-one",
      failureCode: "source-auth",
      now: new Date(now.getTime() + 2_000),
    });
    await expect(
      repository.claimAccountMergeCleanup({
        sourceUid,
        leaseId: "lease-two",
        now: new Date(now.getTime() + 3_000),
        leaseUntil: new Date(now.getTime() + 7 * 60 * 1_000),
      })
    ).resolves.toEqual({ sourceUid, targetUid });
    await repository.completeAccountMergeCleanup({
      sourceUid,
      leaseId: "lease-two",
      now: new Date(now.getTime() + 4_000),
    });
    await expect(
      repository.claimAccountMergeCleanup({
        sourceUid,
        leaseId: "lease-three",
        now: new Date(now.getTime() + 5_000),
        leaseUntil: new Date(now.getTime() + 8 * 60 * 1_000),
      })
    ).resolves.toBeNull();
    expect(
      (await adminDb.doc(`accountMerges/${sourceUid}`).get()).data()
    ).toMatchObject({
      cleanupStatus: "complete",
      cleanupAttemptCount: 2,
    });
  });

  it("lists only due pending, failed, and expired-claimed cleanup markers in bounded order", async () => {
    const targetUid = "merge-cleanup-sweep-target";
    const base = new Date("2026-07-13T00:00:00.000Z");
    const marker = (cleanupStatus: string, minute: number) => ({
      schemaVersion: 2,
      targetUid,
      mergedAt: Timestamp.fromDate(base),
      billingBindingRetained: true,
      goalCount: 0,
      progressDeckCount: 0,
      entitlementMoved: false,
      cleanupStatus,
      cleanupAttemptCount: 0,
      cleanupUpdatedAt: Timestamp.fromDate(
        new Date(base.getTime() + minute * 60_000)
      ),
    });
    await Promise.all([
      adminDb.doc("accountMerges/sweep-pending").set({
        ...marker("pending", 0),
        sourceUid: "sweep-pending",
      }),
      adminDb.doc("accountMerges/sweep-failed").set({
        ...marker("failed", 1),
        sourceUid: "sweep-failed",
      }),
      adminDb.doc("accountMerges/sweep-expired-claimed").set({
        ...marker("claimed", 2),
        sourceUid: "sweep-expired-claimed",
        cleanupLeaseUntil: Timestamp.fromDate(
          new Date(base.getTime() + 7 * 60_000)
        ),
      }),
      adminDb.doc("accountMerges/sweep-active-claimed").set({
        ...marker("claimed", 8),
        sourceUid: "sweep-active-claimed",
        cleanupLeaseUntil: Timestamp.fromDate(
          new Date(base.getTime() + 13 * 60_000)
        ),
      }),
      adminDb.doc("accountMerges/sweep-complete").set({
        ...marker("complete", 0),
        sourceUid: "sweep-complete",
      }),
      adminDb.doc("accountMerges/sweep-legacy").set({
        sourceUid: "sweep-legacy",
        targetUid,
        mergedAt: Timestamp.fromDate(base),
        billingBindingRetained: true,
      }),
    ]);
    const repository = new FirestoreRepository(adminDb, adminAuth);
    const cutoff = new Date(base.getTime() + 5 * 60_000);

    await expect(
      repository.listAccountMergeCleanupCandidates({ cutoff, limit: 2 })
    ).resolves.toEqual(["sweep-pending", "sweep-failed"]);
    await expect(
      repository.listAccountMergeCleanupCandidates({ cutoff, limit: 10 })
    ).resolves.toEqual([
      "sweep-pending",
      "sweep-failed",
      "sweep-expired-claimed",
    ]);
  });

  it("counts installation rebinds toward the 450-write merge guard", async () => {
    const sourceUid = "merge-installation-overflow-source";
    const targetUid = "merge-installation-overflow-target";
    await recreateAuthUsers(sourceUid, targetUid);
    const batch = adminDb.batch();
    for (let index = 0; index < 443; index += 1) {
      batch.set(adminDb.doc(`notificationInstallations/overflow-${index}`), {
        uid: sourceUid,
      });
    }
    await batch.commit();
    const repository = new FirestoreRepository(adminDb, adminAuth);

    await expect(
      repository.mergeAnonymousAccount({
        sourceUid,
        targetUid,
        deviceHash: "primary-device-hash",
        now: new Date("2026-07-12T00:00:00.000Z"),
      })
    ).rejects.toMatchObject({
      code: "resource-exhausted",
      details: { kind: "account-merge-size", writeCount: 451 },
    });
    await expect(
      adminDb.doc(`accountMerges/${sourceUid}`).get()
    ).resolves.toMatchObject({ exists: false });
    expect(
      (await adminDb.doc("notificationInstallations/overflow-0").get()).data()
        ?.uid
    ).toBe(sourceUid);
  });

  it("blocks representative account-owned write transactions after a merge marker commits", async () => {
    const uid = "merged-write-race-source";
    const now = new Date("2026-07-13T00:00:00.000Z");
    await adminDb.doc(`accountMerges/${uid}`).set({
      schemaVersion: 2,
      sourceUid: uid,
      targetUid: "merged-write-race-target",
      mergedAt: Timestamp.fromDate(now),
      billingBindingRetained: true,
      goalCount: 0,
      progressDeckCount: 0,
      entitlementMoved: false,
      cleanupStatus: "pending",
      cleanupAttemptCount: 0,
      cleanupUpdatedAt: Timestamp.fromDate(now),
    });
    await adminDb.doc("receiptClaims/merged-write-race-receipt").set({ uid });
    const repository = new FirestoreRepository(adminDb, adminAuth);
    const accountMerged = {
      code: "failed-precondition",
      details: { kind: "account-merged" },
    };

    const writes = [
      () => repository.createOrResetGoal({
        uid,
        goal: {
          id: "race-goal",
          uid,
          deckId: "race-deck",
          deckVersion: 1,
          active: true,
          targetCount: 1,
          startDate: "2026-07-13",
          timezone: "Asia/Seoul",
          assignments: {},
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          revision: 0,
        },
        maxActiveGoals: 1,
        resetCooldownMs: 24 * 60 * 60 * 1_000,
        now,
      }),
      () => repository.reserveDelivery({
        window: {
          id: "race-window",
          uid,
          goalId: "race-goal",
          deckId: "race-deck",
          deckVersion: 1,
          dateKey: "2026-07-13",
          quotaDateKey: "2026-07-13",
          premium: false,
          deviceHash: "race-device-hash",
          cardIds: [],
          cardIndexes: [],
          issuedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        },
        cards: [],
        hardUserDailyLimit: 20,
        premiumUserDailySoftCap: null,
        premiumDeviceDailySoftCap: null,
      }),
      () => repository.commitProgress({
        uid,
        batchId: "race-batch",
        windowId: "race-window",
        answers: [],
        now,
        calculate: (current) => current,
      }),
      () => repository.createDeckRequest(
        {
          uid,
          topic: "race topic",
          category: "language",
          language: "ko",
          status: "queued",
          priority: "normal",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        1
      ),
      () => repository.applyVerifiedSubscriptionEvent(
        {
          eventId: "race-event",
          eventType: "subscription.status_changed",
          occurredAt: now.toISOString(),
          subscriptionId: "race-subscription",
          orderId: "race-order",
          sku: "daoewo.pro.monthly",
          receipt: {
            platform: "apps-in-toss",
            productId: "daoewo.pro.monthly",
            originalTransactionId: "race-subscription",
            active: true,
            purchasedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
            environment: "sandbox",
            entitlement: {
              plan: "pro",
              source: "apps-in-toss",
              validUntil: new Date(now.getTime() + 86_400_000).toISOString(),
            },
          },
        },
        "merged-write-race-receipt",
        now
      ),
    ];

    for (const write of writes) {
      await expect(write()).rejects.toMatchObject(accountMerged);
    }
    await expect(
      adminDb.doc(`users/${uid}/goals/race-goal`).get()
    ).resolves.toMatchObject({ exists: false });
    await expect(
      adminDb.doc(`users/${uid}/deckProgress/race-deck`).get()
    ).resolves.toMatchObject({ exists: false });
    expect(
      (
        await adminDb
          .collection("deckRequests")
          .where("uid", "==", uid)
          .get()
      ).empty
    ).toBe(true);
    await expect(
      adminDb.doc("subscriptionEvents/race-event").get()
    ).resolves.toMatchObject({ exists: false });
  });
});

function backupSession(id: string, completedAt: string) {
  return {
    id,
    deckId: "free-deck",
    date: completedAt.slice(0, 10),
    target: 1,
    completed: 1,
    known: 1,
    unknown: 0,
    reviewCount: 0,
    elapsedMs: 100,
    completedAt,
  };
}

describe("FirestoreRepository account deletion", () => {
  it("purges target and merged-source data while retaining an unclaimable receipt tombstone", async () => {
    const uid = "delete-target";
    const sourceUid = "delete-merged-source";
    const timestamp = Timestamp.fromDate(new Date("2026-07-12T00:00:00.000Z"));
    await recreateAuthUsers(uid, sourceUid);
    await Promise.all([
      adminDb
        .doc(`users/${uid}/goals/deck-a`)
        .set({ uid, updatedAt: timestamp }),
      adminDb.doc(`users/${uid}/entitlements/pro`).set({ uid, plan: "pro" }),
      adminDb.doc(`users/${sourceUid}/deckProgress/deck-a`).set({
        uid: sourceUid,
        updatedAt: timestamp,
      }),
      adminDb.doc(`accountMerges/${sourceUid}`).set({
        schemaVersion: 2,
        sourceUid,
        targetUid: uid,
        mergedAt: timestamp,
        billingBindingRetained: true,
        goalCount: 1,
        progressDeckCount: 1,
        entitlementMoved: false,
        cleanupStatus: "pending",
        cleanupAttemptCount: 0,
        cleanupUpdatedAt: timestamp,
      }),
      adminDb.doc("receiptClaims/deleted-receipt").set({
        uid,
        platform: "google-play",
        productId: "daoewo.pro.monthly",
        originalTransactionId: "deleted-transaction",
        mergedFromUid: sourceUid,
      }),
      adminDb.doc("receiptAuthorityBarriers/deleted-receipt").set({
        state: "pending",
        platform: "google-play",
        firstObservedAt: timestamp,
        lastObservedAt: timestamp,
        observationCount: 1,
        updatedAt: timestamp,
      }),
      adminDb.doc("deliveryLogs/delete-window").set({ uid }),
      adminDb.doc("deliveryCounters/delete-counter").set({ uid }),
      adminDb.doc("deckRequests/delete-request").set({ uid }),
      adminDb.doc("deckRequestCounters/delete-request-counter").set({ uid }),
      adminDb.doc("subscriptionEvents/delete-event").set({ uid }),
      adminDb.doc("tossAppCheckRefreshCounters/delete-refresh").set({
        uidHash: sha256(uid),
      }),
      adminDb.doc("deliveryLogs/delete-source-window").set({ uid: sourceUid }),
      adminDb.doc("notificationInstallations/delete-target-installation").set({
        uid,
      }),
      adminDb.doc("notificationInstallations/delete-source-installation").set({
        uid: sourceUid,
      }),
    ]);
    const repository = new FirestoreRepository(adminDb, adminAuth);
    const now = new Date("2026-07-12T12:00:00.000Z");

    await repository.beginAccountDeletion(uid, now);
    await expect(repository.assertAccountActive(uid)).rejects.toMatchObject({
      details: { kind: "account-deleting" },
    });
    await expect(
      repository.ensureDeviceAccess(uid, "late-device-hash", false, now)
    ).rejects.toMatchObject({
      details: { kind: "account-deleting" },
    });
    await expect(repository.purgeAccountData(uid, now)).resolves.toMatchObject({
      deletedUidCount: 2,
      retainedReceiptClaimCount: 1,
    });

    const [
      targetGoal,
      sourceProgress,
      request,
      targetWindow,
      sourceWindow,
      counter,
      requestCounter,
      event,
      refreshCounter,
      mergeMarker,
      sourceDeletionMarker,
      receiptClaim,
      receiptBarrier,
      deletionMarker,
      targetInstallation,
      sourceInstallation,
    ] = await Promise.all([
      adminDb.doc(`users/${uid}/goals/deck-a`).get(),
      adminDb.doc(`users/${sourceUid}/deckProgress/deck-a`).get(),
      adminDb.doc("deckRequests/delete-request").get(),
      adminDb.doc("deliveryLogs/delete-window").get(),
      adminDb.doc("deliveryLogs/delete-source-window").get(),
      adminDb.doc("deliveryCounters/delete-counter").get(),
      adminDb.doc("deckRequestCounters/delete-request-counter").get(),
      adminDb.doc("subscriptionEvents/delete-event").get(),
      adminDb.doc("tossAppCheckRefreshCounters/delete-refresh").get(),
      adminDb.doc(`accountMerges/${sourceUid}`).get(),
      adminDb.doc(`accountDeletions/${sourceUid}`).get(),
      adminDb.doc("receiptClaims/deleted-receipt").get(),
      adminDb.doc("receiptAuthorityBarriers/deleted-receipt").get(),
      adminDb.doc(`accountDeletions/${uid}`).get(),
      adminDb.doc("notificationInstallations/delete-target-installation").get(),
      adminDb.doc("notificationInstallations/delete-source-installation").get(),
    ]);
    for (const deleted of [
      targetGoal,
      sourceProgress,
      request,
      targetWindow,
      sourceWindow,
      counter,
      requestCounter,
      event,
      refreshCounter,
      mergeMarker,
      targetInstallation,
      sourceInstallation,
    ]) {
      expect(deleted.exists).toBe(false);
    }
    expect(receiptClaim.exists).toBe(true);
    expect(receiptClaim.data()).toMatchObject({
      ownershipState: "account-deleted",
      bindingRetained: true,
    });
    expect(receiptClaim.data()?.uid).toBeUndefined();
    expect(receiptClaim.data()?.platform).toBeUndefined();
    expect(receiptClaim.data()?.productId).toBeUndefined();
    expect(receiptClaim.data()?.originalTransactionId).toBeUndefined();
    expect(receiptClaim.data()?.mergedFromUid).toBeUndefined();
    expect(receiptBarrier.exists).toBe(false);
    expect(deletionMarker.data()?.status).toBe("data-purged");
    expect(sourceDeletionMarker.data()).toMatchObject({
      status: "blocked",
      reason: "merged-target-deleted",
      createdAt: Timestamp.fromDate(now),
    });
    expect(sourceDeletionMarker.data()?.targetUid).toBeUndefined();
    expect(sourceDeletionMarker.data()?.sourceUid).toBeUndefined();
    expect(sourceDeletionMarker.data()?.expiresAt).toBeUndefined();
    await expect(adminAuth.getUser(sourceUid)).rejects.toMatchObject({
      code: "auth/user-not-found",
    });
    await expect(adminAuth.getUser(uid)).resolves.toMatchObject({ uid });
    await expect(
      repository.assertAccountActive(sourceUid)
    ).rejects.toMatchObject({
      code: "failed-precondition",
      details: { kind: "account-deleting" },
    });

    await expect(
      repository.applyVerifiedReceipt(
        "attacker",
        {
          platform: "google-play",
          productId: "daoewo.pro.monthly",
          originalTransactionId: "deleted-transaction",
          active: true,
          purchasedAt: "2026-07-12T00:00:00.000Z",
          expiresAt: "2026-08-12T00:00:00.000Z",
          environment: "production",
          entitlement: {
            plan: "pro",
            source: "google-play",
            validUntil: "2026-08-12T00:00:00.000Z",
          },
        },
        "deleted-receipt",
        {
          startedAt: new Date(now.getTime() - 1_000).toISOString(),
          observedAt: new Date(now.getTime() - 500).toISOString(),
        },
        now
      )
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("keeps the merge marker when pending source Auth cleanup fails during target deletion", async () => {
    const uid = "delete-target-cleanup-retry";
    const sourceUid = "delete-source-cleanup-retry";
    const now = new Date("2026-07-12T12:00:00.000Z");
    const timestamp = Timestamp.fromDate(now);
    await adminDb.doc(`accountMerges/${sourceUid}`).set({
      schemaVersion: 2,
      sourceUid,
      targetUid: uid,
      mergedAt: timestamp,
      billingBindingRetained: true,
      goalCount: 0,
      progressDeckCount: 0,
      entitlementMoved: false,
      cleanupStatus: "pending",
      cleanupAttemptCount: 0,
      cleanupUpdatedAt: timestamp,
    });
    const repository = new FirestoreRepository(
      adminDb,
      {
        revokeRefreshTokens: vi.fn(async () => {
          throw new Error("temporary auth outage");
        }),
        deleteUser: vi.fn(async () => undefined),
      } as never
    );
    await repository.beginAccountDeletion(uid, now);

    await expect(repository.purgeAccountData(uid, now)).rejects.toThrow(
      "temporary auth outage"
    );
    await expect(
      adminDb.doc(`accountMerges/${sourceUid}`).get()
    ).resolves.toMatchObject({ exists: true });
    await expect(
      adminDb.doc(`accountDeletions/${sourceUid}`).get()
    ).resolves.toMatchObject({ exists: false });
  });
});

describe("FirestoreRepository store notifications", () => {
  it("atomically supersedes a linked Google Play claim and permanently rejects old-token restore/RTDN", async () => {
    const uid = "linked-migration-user";
    const oldToken = "raw-old-token-never-persisted";
    const newToken = "raw-new-token-never-persisted";
    const oldIdentity = googlePlayReceiptIdentity(
      "com.seorilabs.daoewo",
      oldToken
    );
    const newIdentity = googlePlayReceiptIdentity(
      "com.seorilabs.daoewo",
      newToken
    );
    const now = new Date("2026-07-12T12:00:00.000Z");
    await recreateAuthUsers(uid);
    await Promise.all([
      adminDb.doc(`receiptClaims/${oldIdentity.receiptFingerprint}`).set({
        uid,
        platform: "google-play",
        productId: "daoewo.pro.monthly",
        originalTransactionId: oldIdentity.originalTransactionId,
      }),
      adminDb.doc(`users/${uid}/entitlements/pro`).set({
        entitlement: {
          plan: "pro",
          source: "google-play",
          validUntil: "2026-08-01T00:00:00.000Z",
        },
        source: "google-play",
        productId: "daoewo.pro.monthly",
        originalTransactionId: oldIdentity.originalTransactionId,
        receiptFingerprint: oldIdentity.receiptFingerprint,
      }),
      adminDb
        .doc(`receiptAuthorityBarriers/${oldIdentity.receiptFingerprint}`)
        .set({
          state: "pending",
          platform: "google-play",
          firstObservedAt: Timestamp.fromDate(now),
          lastObservedAt: Timestamp.fromDate(now),
          observationCount: 1,
          updatedAt: Timestamp.fromDate(now),
        }),
    ]);
    const repository = new FirestoreRepository(adminDb, adminAuth);
    const verified = linkedGooglePlayReceipt(newIdentity, oldIdentity);

    await expect(
      repository.applyVerifiedReceipt(
        uid,
        verified,
        newIdentity.receiptFingerprint,
        { startedAt: now.toISOString(), observedAt: now.toISOString() },
        now
      )
    ).resolves.toMatchObject({
      authorityPending: false,
      entitlement: { plan: "pro" },
    });

    const [oldClaim, newClaim, entitlement, oldBarrier] = await Promise.all([
      adminDb.doc(`receiptClaims/${oldIdentity.receiptFingerprint}`).get(),
      adminDb.doc(`receiptClaims/${newIdentity.receiptFingerprint}`).get(),
      adminDb.doc(`users/${uid}/entitlements/pro`).get(),
      adminDb
        .doc(`receiptAuthorityBarriers/${oldIdentity.receiptFingerprint}`)
        .get(),
    ]);
    expect(oldClaim.data()).toMatchObject({
      uid,
      platform: "google-play",
      ownershipState: "superseded",
      bindingRetained: true,
      originalTransactionId: oldIdentity.originalTransactionId,
      supersededBy: newIdentity,
    });
    expect(oldClaim.data()?.productId).toBeUndefined();
    expect(newClaim.data()).toMatchObject({
      uid,
      platform: "google-play",
      originalTransactionId: newIdentity.originalTransactionId,
      predecessor: oldIdentity,
    });
    expect(entitlement.data()).toMatchObject({
      entitlement: { plan: "pro" },
      receiptFingerprint: newIdentity.receiptFingerprint,
      predecessor: oldIdentity,
    });
    expect(oldBarrier.exists).toBe(false);
    const stored = JSON.stringify({
      old: oldClaim.data(),
      current: newClaim.data(),
      entitlement: entitlement.data(),
    });
    expect(stored).not.toContain(oldToken);
    expect(stored).not.toContain(newToken);

    await expect(
      repository.applyVerifiedReceipt(
        uid,
        verified,
        newIdentity.receiptFingerprint,
        {
          startedAt: new Date(now.getTime() + 500).toISOString(),
          observedAt: new Date(now.getTime() + 500).toISOString(),
        },
        new Date(now.getTime() + 500)
      )
    ).resolves.toMatchObject({
      authorityPending: false,
      entitlement: { plan: "pro" },
    });
    expect(
      (
        await adminDb
          .doc(`receiptClaims/${oldIdentity.receiptFingerprint}`)
          .get()
      ).data()?.supersededAt
    ).toEqual(oldClaim.data()?.supersededAt);

    await expect(
      repository.resolveReceiptClaimForNotification({
        fingerprint: oldIdentity.receiptFingerprint,
        platform: "google-play",
        now: new Date(now.getTime() + 1_000),
      })
    ).resolves.toEqual({
      kind: "superseded",
      fingerprint: oldIdentity.receiptFingerprint,
      successorFingerprint: newIdentity.receiptFingerprint,
    });
    await expect(
      repository.applyAuthoritativeSubscriptionState(
        googleNotificationInput({
          uid,
          identity: oldIdentity,
          eventId: "late-old-token-rtdn",
          now: new Date(now.getTime() + 2_000),
          active: false,
        })
      )
    ).resolves.toEqual({ outcome: "superseded", uid: null });
    await expect(
      adminDb
        .doc(`subscriptionEvents/${sha256("google-play:late-old-token-rtdn")}`)
        .get()
    ).resolves.toMatchObject({ exists: false });
    expect(
      (await adminDb.doc(`users/${uid}/entitlements/pro`).get()).data()
        ?.receiptFingerprint
    ).toBe(newIdentity.receiptFingerprint);

    await expect(
      repository.applyVerifiedReceipt(
        uid,
        {
          ...activeVerifiedReceipt(),
          originalTransactionId: oldIdentity.originalTransactionId,
        },
        oldIdentity.receiptFingerprint,
        { startedAt: now.toISOString(), observedAt: now.toISOString() },
        new Date(now.getTime() + 3_000)
      )
    ).rejects.toMatchObject({
      code: "permission-denied",
      details: { kind: "receipt-binding-conflict" },
    });

    const thirdIdentity = googlePlayReceiptIdentity(
      "com.seorilabs.daoewo",
      "third-raw-token-never-persisted"
    );
    await expect(
      repository.applyVerifiedReceipt(
        uid,
        linkedGooglePlayReceipt(thirdIdentity, oldIdentity),
        thirdIdentity.receiptFingerprint,
        { startedAt: now.toISOString(), observedAt: now.toISOString() },
        new Date(now.getTime() + 4_000)
      )
    ).rejects.toMatchObject({
      details: { kind: "google-play-linked-purchase-conflict" },
    });
    await expect(
      adminDb.doc(`receiptClaims/${thirdIdentity.receiptFingerprint}`).get()
    ).resolves.toMatchObject({ exists: false });

    await repository.beginAccountDeletion(uid, new Date(now.getTime() + 5_000));
    await expect(
      repository.purgeAccountData(uid, new Date(now.getTime() + 6_000))
    ).resolves.toMatchObject({ retainedReceiptClaimCount: 2 });
    for (const identity of [oldIdentity, newIdentity]) {
      const deletedClaim = await adminDb
        .doc(`receiptClaims/${identity.receiptFingerprint}`)
        .get();
      expect(deletedClaim.data()).toMatchObject({
        ownershipState: "account-deleted",
        bindingRetained: true,
      });
      expect(deletedClaim.data()?.uid).toBeUndefined();
      expect(deletedClaim.data()?.predecessor).toBeUndefined();
      expect(deletedClaim.data()?.supersededBy).toBeUndefined();
    }
  });

  it("creates a minimal predecessor tombstone when unclaimed and rejects a deleted predecessor", async () => {
    const uid = "linked-missing-predecessor-user";
    const deletedUid = "linked-deleted-predecessor-user";
    const predecessor = googlePlayReceiptIdentity(
      "com.seorilabs.daoewo",
      "never-claimed-old-token"
    );
    const successor = googlePlayReceiptIdentity(
      "com.seorilabs.daoewo",
      "successor-for-missing-old-token"
    );
    const deletedPredecessor = googlePlayReceiptIdentity(
      "com.seorilabs.daoewo",
      "deleted-old-token"
    );
    const rejectedSuccessor = googlePlayReceiptIdentity(
      "com.seorilabs.daoewo",
      "successor-for-deleted-old-token"
    );
    const now = new Date("2026-07-12T12:05:00.000Z");
    await recreateAuthUsers(uid, deletedUid);
    const repository = new FirestoreRepository(adminDb, adminAuth);

    await expect(
      repository.applyVerifiedReceipt(
        uid,
        linkedGooglePlayReceipt(successor, {
          ...predecessor,
          receiptFingerprint: sha256("inconsistent-predecessor-fingerprint"),
        }),
        successor.receiptFingerprint,
        { startedAt: now.toISOString(), observedAt: now.toISOString() },
        now
      )
    ).rejects.toMatchObject({
      details: { kind: "google-play-linked-purchase-conflict" },
    });

    await expect(
      repository.applyVerifiedReceipt(
        uid,
        linkedGooglePlayReceipt(successor, predecessor),
        successor.receiptFingerprint,
        { startedAt: now.toISOString(), observedAt: now.toISOString() },
        now
      )
    ).resolves.toMatchObject({ entitlement: { plan: "pro" } });
    const tombstone = await adminDb
      .doc(`receiptClaims/${predecessor.receiptFingerprint}`)
      .get();
    expect(tombstone.data()).toMatchObject({
      uid,
      platform: "google-play",
      originalTransactionId: predecessor.originalTransactionId,
      ownershipState: "superseded",
      supersededBy: successor,
    });
    expect(Object.keys(tombstone.data() ?? {}).sort()).toEqual([
      "bindingRetained",
      "originalTransactionId",
      "ownershipState",
      "platform",
      "supersededAt",
      "supersededBy",
      "uid",
      "updatedAt",
    ]);

    await adminDb
      .doc(`receiptClaims/${deletedPredecessor.receiptFingerprint}`)
      .set({ ownershipState: "account-deleted", bindingRetained: true });
    await expect(
      repository.applyVerifiedReceipt(
        deletedUid,
        linkedGooglePlayReceipt(rejectedSuccessor, deletedPredecessor),
        rejectedSuccessor.receiptFingerprint,
        { startedAt: now.toISOString(), observedAt: now.toISOString() },
        now
      )
    ).rejects.toMatchObject({
      code: "permission-denied",
      details: { kind: "google-play-linked-purchase-owner-conflict" },
    });
    await expect(
      adminDb.doc(`receiptClaims/${rejectedSuccessor.receiptFingerprint}`).get()
    ).resolves.toMatchObject({ exists: false });
  });

  it("rejects unrelated ownership but accepts a verified merge target for linked migration", async () => {
    const sourceUid = "linked-owner-source";
    const targetUid = "linked-owner-target";
    const oldIdentity = googlePlayReceiptIdentity(
      "com.seorilabs.daoewo",
      "linked-owner-old-token"
    );
    const newIdentity = googlePlayReceiptIdentity(
      "com.seorilabs.daoewo",
      "linked-owner-new-token"
    );
    const now = new Date("2026-07-12T12:10:00.000Z");
    await recreateAuthUsers(sourceUid, targetUid);
    await adminDb.doc(`receiptClaims/${oldIdentity.receiptFingerprint}`).set({
      uid: sourceUid,
      platform: "google-play",
      productId: "daoewo.pro.monthly",
      originalTransactionId: oldIdentity.originalTransactionId,
    });
    const repository = new FirestoreRepository(adminDb, adminAuth);

    await expect(
      repository.applyVerifiedReceipt(
        targetUid,
        linkedGooglePlayReceipt(newIdentity, oldIdentity),
        newIdentity.receiptFingerprint,
        { startedAt: now.toISOString(), observedAt: now.toISOString() },
        now
      )
    ).rejects.toMatchObject({
      code: "permission-denied",
      details: { kind: "google-play-linked-purchase-owner-conflict" },
    });
    await expect(
      adminDb.doc(`receiptClaims/${newIdentity.receiptFingerprint}`).get()
    ).resolves.toMatchObject({ exists: false });

    await adminDb.doc(`accountMerges/${sourceUid}`).set({
      sourceUid,
      targetUid,
      mergedAt: Timestamp.fromDate(now),
      billingBindingRetained: true,
    });
    await expect(
      repository.applyVerifiedReceipt(
        targetUid,
        linkedGooglePlayReceipt(newIdentity, oldIdentity),
        newIdentity.receiptFingerprint,
        { startedAt: now.toISOString(), observedAt: now.toISOString() },
        new Date(now.getTime() + 1_000)
      )
    ).resolves.toMatchObject({ entitlement: { plan: "pro" } });
    expect(
      (
        await adminDb
          .doc(`receiptClaims/${oldIdentity.receiptFingerprint}`)
          .get()
      ).data()?.uid
    ).toBe(targetUid);
  });

  it("keeps a linked migration fail-closed behind the new-token pre-claim barrier", async () => {
    const uid = "linked-preclaim-user";
    const oldIdentity = googlePlayReceiptIdentity(
      "com.seorilabs.daoewo",
      "linked-preclaim-old-token"
    );
    const newIdentity = googlePlayReceiptIdentity(
      "com.seorilabs.daoewo",
      "linked-preclaim-new-token"
    );
    const now = new Date("2026-07-12T12:20:00.000Z");
    await recreateAuthUsers(uid);
    await Promise.all([
      adminDb.doc(`receiptClaims/${oldIdentity.receiptFingerprint}`).set({
        uid,
        platform: "google-play",
        productId: "daoewo.pro.monthly",
        originalTransactionId: oldIdentity.originalTransactionId,
      }),
      adminDb.doc(`users/${uid}/entitlements/pro`).set({
        entitlement: {
          plan: "pro",
          source: "google-play",
          validUntil: "2026-08-01T00:00:00.000Z",
        },
        source: "google-play",
        productId: "daoewo.pro.monthly",
        originalTransactionId: oldIdentity.originalTransactionId,
        receiptFingerprint: oldIdentity.receiptFingerprint,
      }),
    ]);
    const repository = new FirestoreRepository(adminDb, adminAuth);
    await repository.resolveReceiptClaimForNotification({
      fingerprint: newIdentity.receiptFingerprint,
      platform: "google-play",
      now,
    });

    await expect(
      repository.applyVerifiedReceipt(
        uid,
        linkedGooglePlayReceipt(newIdentity, oldIdentity),
        newIdentity.receiptFingerprint,
        { startedAt: now.toISOString(), observedAt: now.toISOString() },
        new Date(now.getTime() + 1_000)
      )
    ).resolves.toMatchObject({
      authorityPending: true,
      entitlement: { plan: "free" },
    });
    expect(
      (await adminDb.doc(`users/${uid}/entitlements/pro`).get()).data()
    ).toMatchObject({
      entitlement: { plan: "free" },
      receiptFingerprint: newIdentity.receiptFingerprint,
      authorityPending: true,
    });
    const claim = await repository.resolveReceiptClaimForNotification({
      fingerprint: newIdentity.receiptFingerprint,
      platform: "google-play",
      now: new Date(now.getTime() + 2_000),
    });
    if (claim.kind !== "claimed")
      throw new Error("new linked claim is missing");
    expect(claim.predecessor).toEqual(oldIdentity);

    const linkedNotification = googleNotificationInput({
      uid,
      identity: newIdentity,
      predecessor: oldIdentity,
      eventId: "linked-new-token-rtdn",
      now: new Date(now.getTime() + 3_000),
      active: true,
    });
    const conflictingPredecessor = googlePlayReceiptIdentity(
      "com.seorilabs.daoewo",
      "unrelated-linked-token"
    );
    await expect(
      repository.applyAuthoritativeSubscriptionState({
        ...linkedNotification,
        state: {
          ...linkedNotification.state,
          predecessor: conflictingPredecessor,
        },
      })
    ).rejects.toMatchObject({
      code: "aborted",
      details: { kind: "receipt-binding-conflict" },
    });
    await expect(
      adminDb
        .doc(`receiptAuthorityBarriers/${newIdentity.receiptFingerprint}`)
        .get()
    ).resolves.toMatchObject({ exists: true });

    await expect(
      repository.applyAuthoritativeSubscriptionState(linkedNotification)
    ).resolves.toMatchObject({
      outcome: "applied",
      entitlement: { plan: "pro" },
    });
    await expect(
      adminDb
        .doc(`receiptAuthorityBarriers/${newIdentity.receiptFingerprint}`)
        .get()
    ).resolves.toMatchObject({ exists: false });
    const linkedEvent = await adminDb
      .doc(`subscriptionEvents/${sha256("google-play:linked-new-token-rtdn")}`)
      .get();
    expect(JSON.stringify(linkedEvent.data())).not.toContain(
      "raw-notification-token-never-persisted"
    );
    expect(JSON.stringify(linkedEvent.data())).not.toContain(
      "linked-preclaim-old-token"
    );
    expect(JSON.stringify(linkedEvent.data())).not.toContain(
      "linked-preclaim-new-token"
    );
  });

  it("holds a direct grant behind a durable raw-free pre-claim barrier until notification authority settles", async () => {
    const uid = "preclaim-barrier-user";
    const fingerprint = sha256("preclaim-barrier-fingerprint");
    const firstObservedAt = new Date("2026-07-12T11:59:00.000Z");
    const directCommitAt = new Date("2026-07-12T12:00:00.000Z");
    const notificationCommitAt = new Date("2026-07-12T12:01:00.000Z");
    await recreateAuthUsers(uid);
    const repository = new FirestoreRepository(adminDb, adminAuth);

    await expect(
      repository.resolveReceiptClaimForNotification({
        fingerprint: "raw-purchase-token",
        platform: "google-play",
        now: firstObservedAt,
      })
    ).rejects.toMatchObject({ code: "internal" });
    await expect(
      adminDb.doc("receiptAuthorityBarriers/raw-purchase-token").get()
    ).resolves.toMatchObject({ exists: false });

    await expect(
      repository.resolveReceiptClaimForNotification({
        fingerprint,
        platform: "google-play",
        now: firstObservedAt,
      })
    ).resolves.toEqual({ kind: "missing", fingerprint });
    await expect(
      repository.resolveReceiptClaimForNotification({
        fingerprint,
        platform: "google-play",
        now: new Date(firstObservedAt.getTime() + 1_000),
      })
    ).resolves.toEqual({ kind: "missing", fingerprint });

    const pendingBeforeClaim = await adminDb
      .doc(`receiptAuthorityBarriers/${fingerprint}`)
      .get();
    expect(pendingBeforeClaim.data()).toMatchObject({
      state: "pending",
      platform: "google-play",
      observationCount: 2,
      firstObservedAt: Timestamp.fromDate(firstObservedAt),
    });
    expect(Object.keys(pendingBeforeClaim.data() ?? {}).sort()).toEqual([
      "firstObservedAt",
      "lastObservedAt",
      "observationCount",
      "platform",
      "state",
      "updatedAt",
    ]);
    expect(JSON.stringify(pendingBeforeClaim.data())).not.toContain(
      "raw-token-must-not-be-persisted"
    );
    expect(JSON.stringify(pendingBeforeClaim.data())).not.toContain(
      "original-a"
    );
    expect(JSON.stringify(pendingBeforeClaim.data())).not.toContain("event-a");

    await expect(
      repository.applyVerifiedReceipt(
        uid,
        activeVerifiedReceipt(),
        fingerprint,
        {
          startedAt: "2026-07-12T11:59:30.000Z",
          observedAt: "2026-07-12T11:59:45.000Z",
        },
        directCommitAt
      )
    ).resolves.toMatchObject({
      authorityPending: true,
      entitlement: { plan: "free" },
    });

    const [
      claimAfterDirect,
      heldEntitlement,
      barrierAfterDirect,
      userAfterDirect,
    ] = await Promise.all([
      adminDb.doc(`receiptClaims/${fingerprint}`).get(),
      adminDb.doc(`users/${uid}/entitlements/pro`).get(),
      adminDb.doc(`receiptAuthorityBarriers/${fingerprint}`).get(),
      adminAuth.getUser(uid),
    ]);
    expect(claimAfterDirect.data()).toMatchObject({
      uid,
      platform: "google-play",
    });
    expect(heldEntitlement.data()).toMatchObject({
      entitlement: { plan: "free" },
      receiptFingerprint: fingerprint,
      authorityPending: true,
    });
    expect(barrierAfterDirect.exists).toBe(true);
    expect(userAfterDirect.customClaims).toMatchObject({ daoewoPlan: "free" });

    const expectedClaim = await repository.resolveReceiptClaimForNotification({
      fingerprint,
      platform: "google-play",
      now: notificationCommitAt,
    });
    if (expectedClaim.kind !== "claimed") {
      throw new Error("expected the direct verification to create a claim");
    }
    const notificationInput = storeNotificationInput(
      uid,
      fingerprint,
      "preclaim-authority-event",
      notificationCommitAt
    );
    const authoritativeActive = activeAuthoritativeState();
    await expect(
      repository.applyAuthoritativeSubscriptionState({
        ...notificationInput,
        expectedClaim,
        state: authoritativeActive,
      })
    ).resolves.toMatchObject({
      outcome: "applied",
      uid,
      entitlement: { plan: "pro" },
    });

    const [settledEntitlement, clearedBarrier, event, settledUser] =
      await Promise.all([
        adminDb.doc(`users/${uid}/entitlements/pro`).get(),
        adminDb.doc(`receiptAuthorityBarriers/${fingerprint}`).get(),
        adminDb
          .doc(
            `subscriptionEvents/${sha256(
              "google-play:preclaim-authority-event"
            )}`
          )
          .get(),
        adminAuth.getUser(uid),
      ]);
    expect(settledEntitlement.data()?.entitlement).toMatchObject({
      plan: "pro",
    });
    expect(settledEntitlement.data()?.authorityPending).toBeUndefined();
    expect(clearedBarrier.exists).toBe(false);
    expect(event.data()).toMatchObject({ applied: true, active: true });
    expect(settledUser.customClaims).toMatchObject({ daoewoPlan: "pro" });
    await expect(
      repository.applyAuthoritativeSubscriptionState({
        ...notificationInput,
        expectedClaim,
        state: authoritativeActive,
      })
    ).resolves.toMatchObject({
      outcome: "idempotent",
      entitlement: { plan: "pro" },
    });
  });

  it("keeps the barrier and claim authoritative across an account merge", async () => {
    const sourceUid = "preclaim-merge-source";
    const targetUid = "preclaim-merge-target";
    const fingerprint = sha256("preclaim-merge-fingerprint");
    const now = new Date("2026-07-12T12:00:00.000Z");
    await recreateAuthUsers(sourceUid, targetUid);
    const repository = new FirestoreRepository(adminDb, adminAuth);
    await repository.resolveReceiptClaimForNotification({
      fingerprint,
      platform: "google-play",
      now,
    });
    await repository.applyVerifiedReceipt(
      sourceUid,
      activeVerifiedReceipt(),
      fingerprint,
      { startedAt: now.toISOString(), observedAt: now.toISOString() },
      now
    );

    await expect(
      repository.mergeAnonymousAccount({
        sourceUid,
        targetUid,
        deviceHash: "preclaim-merge-device",
        now: new Date(now.getTime() + 1_000),
      })
    ).resolves.toMatchObject({ merged: true, entitlementMoved: true });
    const claim = await repository.resolveReceiptClaimForNotification({
      fingerprint,
      platform: "google-play",
      now: new Date(now.getTime() + 2_000),
    });
    if (claim.kind !== "claimed") throw new Error("merged claim is missing");
    expect(claim.uid).toBe(targetUid);
    await expect(
      adminDb.doc(`receiptAuthorityBarriers/${fingerprint}`).get()
    ).resolves.toMatchObject({ exists: true });

    const input = storeNotificationInput(
      targetUid,
      fingerprint,
      "preclaim-merge-event",
      new Date(now.getTime() + 3_000)
    );
    await expect(
      repository.applyAuthoritativeSubscriptionState({
        ...input,
        expectedClaim: claim,
        state: activeAuthoritativeState(),
      })
    ).resolves.toMatchObject({ outcome: "applied", uid: targetUid });
    await expect(
      adminDb.doc(`receiptAuthorityBarriers/${fingerprint}`).get()
    ).resolves.toMatchObject({ exists: false });
  });

  it("applies a revocation once, reprojects custom claims, and stores no raw token", async () => {
    const uid = "notification-user";
    const fingerprint = "notification-receipt";
    const now = new Date("2026-07-12T12:00:00.000Z");
    await recreateAuthUsers(uid);
    await Promise.all([
      adminDb.doc(`receiptClaims/${fingerprint}`).set({
        uid,
        platform: "google-play",
        productId: "daoewo.pro.monthly",
        originalTransactionId: "original-a",
      }),
      adminDb.doc(`users/${uid}/entitlements/pro`).set({
        entitlement: {
          plan: "pro",
          source: "google-play",
          validUntil: "2026-08-12T00:00:00.000Z",
        },
        source: "google-play",
        productId: "daoewo.pro.monthly",
        originalTransactionId: "original-a",
        receiptFingerprint: fingerprint,
      }),
    ]);
    const repository = new FirestoreRepository(adminDb, adminAuth);
    const baseInput = storeNotificationInput(uid, fingerprint, "event-a", now);
    const voidedOrderFingerprint = sha256(
      "google-play:voided-order:com.seorilabs.daoewo:GPA.raw-order-never-stored"
    );
    const input = {
      ...baseInput,
      notification: {
        ...baseInput.notification,
        notificationType: "voided-purchase" as const,
        voidedRefundType: 1 as const,
        voidedOrderId: "GPA.raw-order-never-stored",
        voidedOrderFingerprint,
      },
    };

    await expect(
      repository.applyAuthoritativeSubscriptionState(input)
    ).resolves.toMatchObject({
      outcome: "applied",
      entitlement: { plan: "free" },
    });
    await expect(
      repository.applyAuthoritativeSubscriptionState(input)
    ).resolves.toMatchObject({
      outcome: "idempotent",
      entitlement: { plan: "free" },
    });

    const [entitlement, event, user] = await Promise.all([
      adminDb.doc(`users/${uid}/entitlements/pro`).get(),
      adminDb.doc(`subscriptionEvents/${sha256("google-play:event-a")}`).get(),
      adminAuth.getUser(uid),
    ]);
    expect(entitlement.data()?.entitlement).toMatchObject({ plan: "free" });
    expect(event.data()).not.toHaveProperty("purchaseToken");
    expect(event.data()).not.toHaveProperty("signedPayload");
    expect(event.data()).not.toHaveProperty("voidedOrderId");
    expect(event.data()?.voidedOrderFingerprint).toBe(voidedOrderFingerprint);
    expect(user.customClaims).toMatchObject({ daoewoPlan: "free" });
  });

  it("keeps a newer cursor and a newer receipt fingerprint authoritative", async () => {
    const uid = "notification-order-user";
    const oldFingerprint = "old-receipt";
    const currentFingerprint = "new-receipt";
    const now = new Date("2026-07-12T12:00:00.000Z");
    await recreateAuthUsers(uid);
    await Promise.all([
      adminDb.doc(`receiptClaims/${oldFingerprint}`).set({
        uid,
        platform: "google-play",
        productId: "daoewo.pro.monthly",
        originalTransactionId: "original-a",
      }),
      adminDb.doc(`users/${uid}/entitlements/pro`).set({
        entitlement: {
          plan: "pro",
          source: "google-play",
          validUntil: "2026-09-12T00:00:00.000Z",
        },
        source: "google-play",
        productId: "daoewo.pro.yearly",
        originalTransactionId: "original-new",
        receiptFingerprint: currentFingerprint,
        storeEventOccurredAt: Timestamp.fromDate(
          new Date("2026-07-12T13:00:00.000Z")
        ),
        storeEventId: "newer-event",
        authorityObservationStartedAt: Timestamp.fromDate(
          new Date("2026-07-12T13:00:00.000Z")
        ),
        authorityObservedAt: Timestamp.fromDate(
          new Date("2026-07-12T13:00:00.000Z")
        ),
        authorityObservationId: "google-play:newer-event",
      }),
    ]);
    const repository = new FirestoreRepository(adminDb, adminAuth);

    await expect(
      repository.applyAuthoritativeSubscriptionState(
        storeNotificationInput(uid, oldFingerprint, "old-token-event", now)
      )
    ).resolves.toMatchObject({ outcome: "superseded" });
    const current = await adminDb.doc(`users/${uid}/entitlements/pro`).get();
    expect(current.data()?.receiptFingerprint).toBe(currentFingerprint);
    expect(current.data()?.entitlement).toMatchObject({ plan: "pro" });

    await adminDb.doc(`receiptClaims/${currentFingerprint}`).set({
      uid,
      platform: "google-play",
      productId: "daoewo.pro.yearly",
      originalTransactionId: "original-new",
    });
    await expect(
      repository.applyAuthoritativeSubscriptionState({
        ...storeNotificationInput(
          uid,
          currentFingerprint,
          "older-same-token-event",
          new Date("2026-07-12T11:00:00.000Z")
        ),
        notification: {
          ...storeNotificationInput(
            uid,
            currentFingerprint,
            "older-same-token-event",
            new Date("2026-07-12T11:00:00.000Z")
          ).notification,
          originalTransactionId: "original-new",
        },
        expectedClaim: {
          kind: "claimed",
          fingerprint: currentFingerprint,
          uid,
          platform: "google-play",
          productId: "daoewo.pro.yearly",
          originalTransactionId: "original-new",
        },
        state: {
          active: false,
          platform: "google-play",
          productId: "daoewo.pro.yearly",
          originalTransactionId: "original-new",
          environment: "production",
          storeState: "SUBSCRIPTION_STATE_EXPIRED",
          authorityObservation: {
            startedAt: "2026-07-12T11:00:00.000Z",
            observedAt: "2026-07-12T11:00:00.000Z",
          },
          reason: "expired",
          lastKnownExpiry: "2026-07-11T00:00:00.000Z",
          entitlement: {
            plan: "free",
            source: "google-play",
            validUntil: null,
          },
        },
      })
    ).resolves.toMatchObject({ outcome: "stale" });
    expect(
      (await adminDb.doc(`users/${uid}/entitlements/pro`).get()).data()
        ?.entitlement
    ).toMatchObject({ plan: "pro" });
  });

  it("does not let a direct verification started before a revocation restore Pro", async () => {
    const uid = "direct-notification-race-user";
    const fingerprint = "direct-notification-race-receipt";
    const verificationStartedAt = new Date("2026-07-12T11:59:00.000Z");
    const notificationObservedAt = new Date("2026-07-12T12:00:00.000Z");
    const directCommitAt = new Date("2026-07-12T12:01:00.000Z");
    await recreateAuthUsers(uid);
    await Promise.all([
      adminDb.doc(`receiptClaims/${fingerprint}`).set({
        uid,
        platform: "google-play",
        productId: "daoewo.pro.monthly",
        originalTransactionId: "original-a",
      }),
      adminDb.doc(`users/${uid}/entitlements/pro`).set({
        entitlement: {
          plan: "pro",
          source: "google-play",
          validUntil: "2026-08-12T00:00:00.000Z",
        },
        source: "google-play",
        productId: "daoewo.pro.monthly",
        originalTransactionId: "original-a",
        receiptFingerprint: fingerprint,
      }),
    ]);
    const repository = new FirestoreRepository(adminDb, adminAuth);
    await expect(
      repository.applyAuthoritativeSubscriptionState(
        storeNotificationInput(
          uid,
          fingerprint,
          "revoked-during-direct-verification",
          notificationObservedAt
        )
      )
    ).resolves.toMatchObject({
      outcome: "applied",
      entitlement: { plan: "free" },
    });

    await expect(
      repository.applyVerifiedReceipt(
        uid,
        {
          platform: "google-play",
          productId: "daoewo.pro.monthly",
          originalTransactionId: "original-a",
          active: true,
          purchasedAt: "2026-07-01T00:00:00.000Z",
          expiresAt: "2026-08-12T00:00:00.000Z",
          environment: "production",
          entitlement: {
            plan: "pro",
            source: "google-play",
            validUntil: "2026-08-12T00:00:00.000Z",
          },
        },
        fingerprint,
        {
          startedAt: verificationStartedAt.toISOString(),
          observedAt: "2026-07-12T12:00:30.000Z",
        },
        directCommitAt
      )
    ).rejects.toMatchObject({
      code: "aborted",
      details: { kind: "stale-receipt-verification" },
    });
    const [entitlement, user] = await Promise.all([
      adminDb.doc(`users/${uid}/entitlements/pro`).get(),
      adminAuth.getUser(uid),
    ]);
    expect(entitlement.data()?.entitlement).toMatchObject({ plan: "free" });
    expect(user.customClaims).toMatchObject({ daoewoPlan: "free" });
  });

  it("lets an overlapping revocation response beat a direct active grant", async () => {
    const uid = "notification-response-after-direct-user";
    const fingerprint = "notification-response-after-direct-receipt";
    const directStartedAt = new Date("2026-07-12T11:59:00.000Z");
    const directObservedAt = new Date("2026-07-12T12:00:00.000Z");
    const directCommitAt = new Date("2026-07-12T12:00:30.000Z");
    const notificationObservedAt = new Date("2026-07-12T12:01:00.000Z");
    await recreateAuthUsers(uid);
    const repository = new FirestoreRepository(adminDb, adminAuth);
    await expect(
      repository.applyVerifiedReceipt(
        uid,
        {
          platform: "google-play",
          productId: "daoewo.pro.monthly",
          originalTransactionId: "original-a",
          active: true,
          purchasedAt: "2026-07-01T00:00:00.000Z",
          expiresAt: "2026-08-12T00:00:00.000Z",
          environment: "production",
          entitlement: {
            plan: "pro",
            source: "google-play",
            validUntil: "2026-08-12T00:00:00.000Z",
          },
        },
        fingerprint,
        {
          startedAt: directStartedAt.toISOString(),
          observedAt: directObservedAt.toISOString(),
        },
        directCommitAt
      )
    ).resolves.toMatchObject({
      authorityPending: false,
      entitlement: { plan: "pro" },
    });

    const input = storeNotificationInput(
      uid,
      fingerprint,
      "slow-revocation-response",
      notificationObservedAt
    );
    input.state.authorityObservation = {
      startedAt: "2026-07-12T11:59:30.000Z",
      observedAt: notificationObservedAt.toISOString(),
    };
    await expect(
      repository.applyAuthoritativeSubscriptionState(input)
    ).resolves.toMatchObject({
      outcome: "applied",
      entitlement: { plan: "free" },
    });
    expect(
      (await adminDb.doc(`users/${uid}/entitlements/pro`).get()).data()
        ?.entitlement
    ).toMatchObject({ plan: "free" });
  });

  it("atomically migrates an allowlisted Apple product on the same original transaction", async () => {
    const uid = "apple-crossgrade-user";
    const fingerprint = "apple-crossgrade-receipt";
    const originalTransactionId = "apple-original-a";
    const now = new Date("2026-07-12T12:00:00.000Z");
    await recreateAuthUsers(uid);
    await Promise.all([
      adminDb.doc(`receiptClaims/${fingerprint}`).set({
        uid,
        platform: "app-store",
        productId: "daoewo.pro.monthly",
        originalTransactionId,
      }),
      adminDb.doc(`users/${uid}/entitlements/pro`).set({
        entitlement: {
          plan: "pro",
          source: "app-store",
          validUntil: "2026-08-12T00:00:00.000Z",
        },
        source: "app-store",
        productId: "daoewo.pro.monthly",
        originalTransactionId,
        receiptFingerprint: fingerprint,
      }),
    ]);
    const repository = new FirestoreRepository(adminDb, adminAuth);
    await expect(
      repository.applyAuthoritativeSubscriptionState({
        notification: {
          platform: "app-store",
          eventType: "subscription.status_changed",
          notificationType: "DID_CHANGE_RENEWAL_PREF",
          environment: "production",
          transactionId: "apple-transaction-yearly",
          productId: "daoewo.pro.monthly",
          originalTransactionId,
          receiptFingerprint: fingerprint,
          cursor: {
            eventId: "apple-crossgrade",
            occurredAt: now.toISOString(),
          },
        },
        expectedClaim: {
          kind: "claimed",
          fingerprint,
          uid,
          platform: "app-store",
          productId: "daoewo.pro.monthly",
          originalTransactionId,
        },
        state: {
          active: true,
          platform: "app-store",
          productId: "daoewo.pro.yearly",
          originalTransactionId,
          environment: "production",
          storeState: "1",
          authorityObservation: {
            startedAt: now.toISOString(),
            observedAt: now.toISOString(),
          },
          purchasedAt: "2026-07-12T00:00:00.000Z",
          validUntil: "2027-07-12T00:00:00.000Z",
          entitlement: {
            plan: "pro",
            source: "app-store",
            validUntil: "2027-07-12T00:00:00.000Z",
          },
        },
        now,
      })
    ).resolves.toMatchObject({ outcome: "applied" });

    const [claim, entitlement] = await Promise.all([
      adminDb.doc(`receiptClaims/${fingerprint}`).get(),
      adminDb.doc(`users/${uid}/entitlements/pro`).get(),
    ]);
    expect(claim.data()?.productId).toBe("daoewo.pro.yearly");
    expect(entitlement.data()?.productId).toBe("daoewo.pro.yearly");
  });

  it("resolves an account-deleted receipt tombstone without a uid", async () => {
    await adminDb.doc("receiptClaims/deleted-notification-receipt").set({
      ownershipState: "account-deleted",
      bindingRetained: true,
    });
    const repository = new FirestoreRepository(adminDb, adminAuth);
    await expect(
      repository.resolveReceiptClaim("deleted-notification-receipt")
    ).resolves.toEqual({
      kind: "account-deleted",
      fingerprint: "deleted-notification-receipt",
    });
  });
});

describe("Firestore lifecycle index policy", () => {
  it("expires notification delivery state but not permanent resurrection blockers", () => {
    const indexConfig = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "../firebase/firestore.indexes.json"),
        "utf8"
      )
    ) as {
      fieldOverrides?: Array<{
        collectionGroup?: string;
        fieldPath?: string;
        ttl?: boolean;
      }>;
    };
    expect(indexConfig.fieldOverrides).not.toContainEqual(
      expect.objectContaining({
        collectionGroup: "accountDeletions",
        ttl: true,
      })
    );
    expect(indexConfig.fieldOverrides).not.toContainEqual(
      expect.objectContaining({
        collectionGroup: "receiptAuthorityBarriers",
        ttl: true,
      })
    );
    for (const collectionGroup of [
      "notificationInstallations",
      "notificationOutbox",
      "catalogNotificationEvents",
    ]) {
      expect(indexConfig.fieldOverrides).toContainEqual(
        expect.objectContaining({
          collectionGroup,
          fieldPath: "expiresAt",
          ttl: true,
        })
      );
    }
  });
});

function linkedGooglePlayReceipt(
  identity: { originalTransactionId: string; receiptFingerprint: string },
  predecessor: { originalTransactionId: string; receiptFingerprint: string }
) {
  return {
    platform: "google-play" as const,
    productId: "daoewo.pro.monthly",
    originalTransactionId: identity.originalTransactionId,
    predecessor,
    active: true,
    purchasedAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-08-12T00:00:00.000Z",
    environment: "production" as const,
    entitlement: {
      plan: "pro" as const,
      source: "google-play",
      validUntil: "2026-08-12T00:00:00.000Z",
    },
  };
}

function googleNotificationInput(input: {
  uid: string;
  identity: { originalTransactionId: string; receiptFingerprint: string };
  predecessor?: { originalTransactionId: string; receiptFingerprint: string };
  eventId: string;
  now: Date;
  active: boolean;
}) {
  const notification = {
    platform: "google-play" as const,
    eventType: "subscription.status_changed" as const,
    notificationType: 12,
    packageName: "com.seorilabs.daoewo",
    purchaseToken: "raw-notification-token-never-persisted",
    receiptFingerprint: input.identity.receiptFingerprint,
    originalTransactionId: input.identity.originalTransactionId,
    cursor: { eventId: input.eventId, occurredAt: input.now.toISOString() },
  };
  const expectedClaim = {
    kind: "claimed" as const,
    fingerprint: input.identity.receiptFingerprint,
    uid: input.uid,
    platform: "google-play" as const,
    productId: "daoewo.pro.monthly",
    originalTransactionId: input.identity.originalTransactionId,
    ...(input.predecessor === undefined
      ? {}
      : { predecessor: input.predecessor }),
  };
  const base = {
    platform: "google-play" as const,
    productId: "daoewo.pro.monthly",
    originalTransactionId: input.identity.originalTransactionId,
    environment: "production" as const,
    storeState: input.active
      ? "SUBSCRIPTION_STATE_ACTIVE"
      : "SUBSCRIPTION_STATE_EXPIRED",
    authorityObservation: {
      startedAt: input.now.toISOString(),
      observedAt: input.now.toISOString(),
    },
    ...(input.predecessor === undefined
      ? {}
      : { predecessor: input.predecessor }),
  };
  if (input.active) {
    return {
      notification,
      expectedClaim,
      state: {
        ...base,
        active: true as const,
        purchasedAt: "2026-07-01T00:00:00.000Z",
        validUntil: "2026-08-12T00:00:00.000Z",
        entitlement: {
          plan: "pro" as const,
          source: "google-play",
          validUntil: "2026-08-12T00:00:00.000Z",
        },
      },
      now: input.now,
    };
  }
  return {
    notification,
    expectedClaim,
    state: {
      ...base,
      active: false as const,
      reason: "expired" as const,
      lastKnownExpiry: "2026-07-01T00:00:00.000Z",
      entitlement: {
        plan: "free" as const,
        source: "google-play",
        validUntil: null,
      },
    },
    now: input.now,
  };
}

function activeVerifiedReceipt() {
  return {
    platform: "google-play" as const,
    productId: "daoewo.pro.monthly",
    originalTransactionId: "original-a",
    active: true,
    purchasedAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-08-12T00:00:00.000Z",
    environment: "production" as const,
    entitlement: {
      plan: "pro" as const,
      source: "google-play",
      validUntil: "2026-08-12T00:00:00.000Z",
    },
  };
}

function activeAuthoritativeState() {
  return {
    active: true as const,
    platform: "google-play" as const,
    productId: "daoewo.pro.monthly",
    originalTransactionId: "original-a",
    environment: "production" as const,
    storeState: "SUBSCRIPTION_STATE_ACTIVE",
    authorityObservation: {
      startedAt: "2026-07-12T12:00:30.000Z",
      observedAt: "2026-07-12T12:00:45.000Z",
    },
    purchasedAt: "2026-07-01T00:00:00.000Z",
    validUntil: "2026-08-12T00:00:00.000Z",
    entitlement: {
      plan: "pro" as const,
      source: "google-play",
      validUntil: "2026-08-12T00:00:00.000Z",
    },
  };
}

function storeNotificationInput(
  uid: string,
  fingerprint: string,
  eventId: string,
  occurredAt: Date
) {
  return {
    notification: {
      platform: "google-play" as const,
      eventType: "subscription.status_changed" as const,
      notificationType: 12,
      packageName: "com.seorilabs.daoewo",
      purchaseToken: "raw-token-must-not-be-persisted",
      receiptFingerprint: fingerprint,
      originalTransactionId: "original-a",
      cursor: { eventId, occurredAt: occurredAt.toISOString() },
    },
    expectedClaim: {
      kind: "claimed" as const,
      fingerprint,
      uid,
      platform: "google-play" as const,
      productId: "daoewo.pro.monthly",
      originalTransactionId: "original-a",
    },
    state: {
      active: false as const,
      platform: "google-play" as const,
      productId: "daoewo.pro.monthly",
      originalTransactionId: "original-a",
      environment: "production" as const,
      storeState: "SUBSCRIPTION_STATE_EXPIRED",
      reason: "expired" as const,
      lastKnownExpiry: "2026-07-11T00:00:00.000Z",
      authorityObservation: {
        startedAt: occurredAt.toISOString(),
        observedAt: occurredAt.toISOString(),
      },
      entitlement: {
        plan: "free" as const,
        source: "google-play",
        validUntil: null,
      },
    },
    now: occurredAt,
  };
}

async function seedFirestore(
  seed: (db: Firestore) => Promise<void> | void
): Promise<void> {
  await environment.withSecurityRulesDisabled(async (context) => {
    await seed(context.firestore() as unknown as Firestore);
  });
}

async function seedPublishedDeck(deckId: string): Promise<void> {
  await adminDb.doc(`decks/${deckId}`).set({ status: "published" });
}

async function seedQueuedDeckRequest(
  requestId: string,
  override: Readonly<Record<string, unknown>> = {}
): Promise<void> {
  const createdAt = Timestamp.fromDate(new Date("2026-07-12T00:00:00.000Z"));
  await adminDb.doc(`deckRequests/${requestId}`).set({
    uid: "requester-a",
    topic: "관세법",
    category: "시험",
    language: "ko",
    status: "queued",
    priority: "normal",
    createdAt,
    updatedAt: createdAt,
    ...override,
  });
}

async function recreateAuthUsers(...uids: string[]): Promise<void> {
  await Promise.all(
    uids.map(async (uid) => {
      try {
        await adminAuth.deleteUser(uid);
      } catch {
        // Emulator test isolation: absence is expected on the first run.
      }
      await adminAuth.createUser({ uid });
    })
  );
}

async function seedMergeAccount(
  uid: string,
  receiptFingerprint: string,
  withState: boolean
): Promise<void> {
  const timestamp = Timestamp.fromDate(new Date("2026-07-11T00:00:00.000Z"));
  await adminDb.doc(`users/${uid}/entitlements/pro`).set({
    entitlement: {
      plan: "pro",
      source: "google-play",
      validUntil: "2026-08-01T00:00:00.000Z",
    },
    source: "google-play",
    productId: "daoewo.pro.monthly",
    originalTransactionId: receiptFingerprint,
    receiptFingerprint,
    updatedAt: timestamp,
  });
  if (!withState) return;
  await Promise.all([
    adminDb.doc(`users/${uid}/goals/deck-a`).set({
      uid,
      deckId: "deck-a",
      deckVersion: 1,
      active: true,
      targetCount: 2,
      dailyTarget: 2,
      startDate: "2026-07-12",
      timezone: "Asia/Seoul",
      assignments: { "2026-07-12": [0, 1] },
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
    }),
    adminDb.doc(`users/${uid}/deckProgress/deck-a`).set({
      uid,
      deckId: "deck-a",
      deckVersion: 1,
      cards: {},
      deliveredCardIds: ["card-0"],
      recentBatches: {},
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    adminDb.doc(`users/${uid}/sync/devicePolicy`).set({
      primaryDeviceHash: "primary-device-hash",
      boundAt: timestamp,
      lastSeenAt: timestamp,
    }),
  ]);
}
