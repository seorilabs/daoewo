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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore, Timestamp } from "firebase-admin/firestore";
import { FirestoreRepository } from "../../src/repositories/firestore-repository.js";
import { sha256 } from "../../src/utils/hash.js";

let environment: RulesTestEnvironment;
const adminApp = initializeAdminApp(
  { projectId: "demo-daoewo-rules" },
  "daoewo-repository-tests",
);
const adminDb = getAdminFirestore(adminApp);
const adminAuth = getAdminAuth(adminApp);

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-daoewo-rules",
    firestore: {
      rules: readFileSync(resolve(process.cwd(), "../firebase/firestore.rules"), "utf8"),
    },
    storage: {
      rules: readFileSync(resolve(process.cwd(), "../firebase/storage.rules"), "utf8"),
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
      await setDoc(doc(db, "decks/free-deck"), { status: "published", tier: "free" });
      await setDoc(doc(db, "decks/pro-deck"), { status: "published", tier: "pro" });
      await setDoc(doc(db, "decks/draft-deck"), { status: "draft", tier: "pro" });
    });
    const authenticated = environment.authenticatedContext("user-a").firestore();
    const anonymous = environment.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(authenticated, "decks/free-deck")));
    await assertSucceeds(getDoc(doc(authenticated, "decks/pro-deck")));
    await assertFails(getDoc(doc(authenticated, "decks/draft-deck")));
    await assertFails(getDoc(doc(anonymous, "decks/free-deck")));
    await assertSucceeds(
      getDocs(query(collection(authenticated, "decks"), where("status", "==", "published"))),
    );
    await assertFails(getDocs(collection(authenticated, "decks")));
  });

  it("routes goal/progress sync through Functions and exposes only own entitlement", async () => {
    await seedFirestore(async (db) => {
      await setDoc(doc(db, "users/user-a/goals/deck-a"), { uid: "user-a" });
      await setDoc(doc(db, "users/user-a/deckProgress/deck-a"), { uid: "user-a" });
      await setDoc(doc(db, "users/user-a/entitlements/pro"), { uid: "user-a" });
    });
    const owner = environment.authenticatedContext("user-a").firestore();
    const other = environment.authenticatedContext("user-b").firestore();

    await assertFails(getDoc(doc(owner, "users/user-a/goals/deck-a")));
    await assertFails(getDoc(doc(owner, "users/user-a/deckProgress/deck-a")));
    await assertSucceeds(getDoc(doc(owner, "users/user-a/entitlements/pro")));
    await assertFails(getDoc(doc(other, "users/user-a/goals/deck-a")));
    await assertFails(setDoc(doc(owner, "users/user-a/goals/deck-b"), { active: true }));
    await assertFails(
      setDoc(doc(owner, "users/user-a/deckProgress/deck-a"), { forged: true }),
    );
    await assertFails(
      setDoc(doc(owner, "users/user-a/entitlements/pro"), { plan: "pro" }),
    );
  });

  it("never exposes premium bodies, delivery logs, counters, or receipt claims", async () => {
    await seedFirestore(async (db) => {
      await setDoc(doc(db, "deckContent/pro-deck/chunks/chunk-0"), { cards: ["secret"] });
      await setDoc(doc(db, "deliveryLogs/window-a"), { uid: "user-a" });
      await setDoc(doc(db, "deliveryCounters/user-a"), { count: 1 });
      await setDoc(doc(db, "receiptClaims/hash-a"), { uid: "user-a" });
      await setDoc(doc(db, "subscriptionEvents/event-a"), { uid: "user-a" });
      await setDoc(doc(db, "tossAuthCodeClaims/code-a"), { consumed: true });
      await setDoc(doc(db, "tossAuthExchangeCounters/ip-a"), { count: 1 });
      await setDoc(doc(db, "tossAppCheckRefreshCounters/user-a"), { count: 1 });
      await setDoc(doc(db, "accountMerges/user-a"), { targetUid: "user-b" });
      await setDoc(doc(db, "accountDeletions/user-a"), { status: "pending" });
      await setDoc(doc(db, "users/user-a/sync/devicePolicy"), {
        primaryDeviceHash: "secret-hash",
      });
    });
    const owner = environment.authenticatedContext("user-a").firestore();
    await assertFails(getDoc(doc(owner, "deckContent/pro-deck/chunks/chunk-0")));
    await assertFails(getDoc(doc(owner, "deliveryLogs/window-a")));
    await assertFails(getDoc(doc(owner, "deliveryCounters/user-a")));
    await assertFails(getDoc(doc(owner, "receiptClaims/hash-a")));
    await assertFails(getDoc(doc(owner, "subscriptionEvents/event-a")));
    await assertFails(getDoc(doc(owner, "tossAuthCodeClaims/code-a")));
    await assertFails(getDoc(doc(owner, "tossAuthExchangeCounters/ip-a")));
    await assertFails(getDoc(doc(owner, "tossAppCheckRefreshCounters/user-a")));
    await assertFails(getDoc(doc(owner, "accountMerges/user-a")));
    await assertFails(getDoc(doc(owner, "accountDeletions/user-a")));
    await assertFails(getDoc(doc(owner, "users/user-a/sync/devicePolicy")));
  });

  it("lets users read only their own requests and requires Functions for creation", async () => {
    await seedFirestore(async (db) => {
      await setDoc(doc(db, "deckRequests/request-a"), { uid: "user-a", topic: "관세법" });
    });
    const owner = environment.authenticatedContext("user-a").firestore();
    const other = environment.authenticatedContext("user-b").firestore();
    await assertSucceeds(getDoc(doc(owner, "deckRequests/request-a")));
    await assertFails(getDoc(doc(other, "deckRequests/request-a")));
    await assertFails(
      setDoc(doc(owner, "deckRequests/request-b"), { uid: "user-a", priority: "pro" }),
    );
  });
});

describe("Storage rules", () => {
  it("denies direct read and write of immutable deck chunks even when authenticated", async () => {
    const path = "decks/pro-deck/v1/chunk-0.json";
    await environment.withSecurityRulesDisabled(async (context) => {
      await uploadString(ref(context.storage(), path), JSON.stringify({ cards: [] }));
    });
    const storage = environment.authenticatedContext("user-a").storage();
    await assertFails(getBytes(ref(storage, path)));
    await assertFails(uploadString(ref(storage, path), "{}"));
  });
});

describe("FirestoreRepository account merge", () => {
  it("binds Free sync to one device while Pro can use another device", async () => {
    const repository = new FirestoreRepository(adminDb, adminAuth);
    const uid = "primary-device-user";
    const now = new Date("2026-07-12T00:00:00.000Z");

    await expect(
      repository.ensureDeviceAccess(uid, "device-a-hash", false, now),
    ).resolves.toBeUndefined();
    await expect(
      repository.ensureDeviceAccess(uid, "device-b-hash", false, now),
    ).rejects.toMatchObject({
      code: "permission-denied",
      details: { kind: "primary-device-mismatch" },
    });
    await expect(
      repository.ensureDeviceAccess(uid, "device-b-hash", true, now),
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
    await adminDb.collection("deckRequests").doc("source-request").set({
      uid: sourceUid,
      topic: "source-only-topic",
      note: "source-only-private-note",
      updatedAt: Timestamp.fromDate(new Date("2026-07-11T00:00:00.000Z")),
    });
    const repository = new FirestoreRepository(adminDb, adminAuth);

    await expect(
      repository.mergeAnonymousAccount({
        sourceUid,
        targetUid,
        deviceHash: "primary-device-hash",
        now: new Date("2026-07-12T00:00:00.000Z"),
      }),
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
    ] =
      await Promise.all([
        adminDb.doc(`users/${sourceUid}/deckProgress/deck-a`).get(),
        adminDb.doc(`users/${targetUid}/deckProgress/deck-a`).get(),
        adminDb.doc(`users/${targetUid}/entitlements/pro`).get(),
        adminDb.doc("receiptClaims/receipt-source").get(),
        adminDb.doc(`accountMerges/${sourceUid}`).get(),
        adminDb.doc("deckRequests/source-request").get(),
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
    await expect(adminAuth.getUser(sourceUid)).rejects.toMatchObject({
      code: "auth/user-not-found",
    });
    await expect(adminAuth.getUser(targetUid)).resolves.toMatchObject({
      customClaims: { daoewoPlan: "pro" },
    });
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
      }),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      details: { kind: "entitlement-ownership-conflict" },
    });
    await expect(
      adminDb.doc(`users/${sourceUid}/deckProgress/deck-a`).get(),
    ).resolves.toMatchObject({ exists: true });
    await expect(
      adminDb.doc(`accountMerges/${sourceUid}`).get(),
    ).resolves.toMatchObject({ exists: false });
    await expect(adminDb.doc("receiptClaims/receipt-source-conflict").get()).resolves.toMatchObject({
      exists: true,
    });
  });
});

describe("FirestoreRepository account deletion", () => {
  it("purges target and merged-source data while retaining an unclaimable receipt tombstone", async () => {
    const uid = "delete-target";
    const sourceUid = "delete-merged-source";
    const timestamp = Timestamp.fromDate(new Date("2026-07-12T00:00:00.000Z"));
    await Promise.all([
      adminDb.doc(`users/${uid}/goals/deck-a`).set({ uid, updatedAt: timestamp }),
      adminDb.doc(`users/${uid}/entitlements/pro`).set({ uid, plan: "pro" }),
      adminDb.doc(`users/${sourceUid}/deckProgress/deck-a`).set({
        uid: sourceUid,
        updatedAt: timestamp,
      }),
      adminDb.doc(`accountMerges/${sourceUid}`).set({
        sourceUid,
        targetUid: uid,
        mergedAt: timestamp,
        billingBindingRetained: true,
      }),
      adminDb.doc("receiptClaims/deleted-receipt").set({
        uid,
        platform: "google-play",
        productId: "daoewo.pro.monthly",
        originalTransactionId: "deleted-transaction",
        mergedFromUid: sourceUid,
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
    ]);
    const repository = new FirestoreRepository(adminDb, adminAuth);
    const now = new Date("2026-07-12T12:00:00.000Z");

    await repository.beginAccountDeletion(uid, now);
    await expect(repository.assertAccountActive(uid)).rejects.toMatchObject({
      details: { kind: "account-deleting" },
    });
    await expect(
      repository.ensureDeviceAccess(uid, "late-device-hash", false, now),
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
      deletionMarker,
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
      adminDb.doc(`accountDeletions/${uid}`).get(),
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
    expect(deletionMarker.data()?.status).toBe("data-purged");
    expect(sourceDeletionMarker.data()).toMatchObject({
      status: "blocked",
      reason: "merged-target-deleted",
      createdAt: Timestamp.fromDate(now),
    });
    expect(sourceDeletionMarker.data()?.targetUid).toBeUndefined();
    expect(sourceDeletionMarker.data()?.sourceUid).toBeUndefined();
    expect(sourceDeletionMarker.data()?.expiresAt).toBeUndefined();
    await expect(repository.assertAccountActive(sourceUid)).rejects.toMatchObject({
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
        now,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("FirestoreRepository store notifications", () => {
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
    const input = storeNotificationInput(uid, fingerprint, "event-a", now);

    await expect(repository.applyAuthoritativeSubscriptionState(input)).resolves.toMatchObject({
      outcome: "applied",
      entitlement: { plan: "free" },
    });
    await expect(repository.applyAuthoritativeSubscriptionState(input)).resolves.toMatchObject({
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
          new Date("2026-07-12T13:00:00.000Z"),
        ),
        storeEventId: "newer-event",
        authorityObservationStartedAt: Timestamp.fromDate(
          new Date("2026-07-12T13:00:00.000Z"),
        ),
        authorityObservedAt: Timestamp.fromDate(
          new Date("2026-07-12T13:00:00.000Z"),
        ),
        authorityObservationId: "google-play:newer-event",
      }),
    ]);
    const repository = new FirestoreRepository(adminDb, adminAuth);

    await expect(
      repository.applyAuthoritativeSubscriptionState(
        storeNotificationInput(uid, oldFingerprint, "old-token-event", now),
      ),
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
          new Date("2026-07-12T11:00:00.000Z"),
        ),
        notification: {
          ...storeNotificationInput(
            uid,
            currentFingerprint,
            "older-same-token-event",
            new Date("2026-07-12T11:00:00.000Z"),
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
      }),
    ).resolves.toMatchObject({ outcome: "stale" });
    expect(
      (await adminDb.doc(`users/${uid}/entitlements/pro`).get()).data()?.entitlement,
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
          notificationObservedAt,
        ),
      ),
    ).resolves.toMatchObject({ outcome: "applied", entitlement: { plan: "free" } });

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
        directCommitAt,
      ),
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
        directCommitAt,
      ),
    ).resolves.toMatchObject({ plan: "pro" });

    const input = storeNotificationInput(
      uid,
      fingerprint,
      "slow-revocation-response",
      notificationObservedAt,
    );
    input.state.authorityObservation = {
      startedAt: "2026-07-12T11:59:30.000Z",
      observedAt: notificationObservedAt.toISOString(),
    };
    await expect(
      repository.applyAuthoritativeSubscriptionState(input),
    ).resolves.toMatchObject({ outcome: "applied", entitlement: { plan: "free" } });
    expect(
      (await adminDb.doc(`users/${uid}/entitlements/pro`).get()).data()?.entitlement,
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
          cursor: { eventId: "apple-crossgrade", occurredAt: now.toISOString() },
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
      }),
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
      repository.resolveReceiptClaim("deleted-notification-receipt"),
    ).resolves.toEqual({
      kind: "account-deleted",
      fingerprint: "deleted-notification-receipt",
    });
  });
});

describe("Firestore lifecycle index policy", () => {
  it("does not expire permanent account resurrection blockers", () => {
    const indexConfig = JSON.parse(
      readFileSync(resolve(process.cwd(), "../firebase/firestore.indexes.json"), "utf8"),
    ) as {
      fieldOverrides?: Array<{
        collectionGroup?: string;
        fieldPath?: string;
        ttl?: boolean;
      }>;
    };
    expect(indexConfig.fieldOverrides).not.toContainEqual(
      expect.objectContaining({ collectionGroup: "accountDeletions", ttl: true }),
    );
  });
});

function storeNotificationInput(
  uid: string,
  fingerprint: string,
  eventId: string,
  occurredAt: Date,
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
  seed: (db: Firestore) => Promise<void> | void,
): Promise<void> {
  await environment.withSecurityRulesDisabled(async (context) => {
    await seed(context.firestore() as unknown as Firestore);
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
    }),
  );
}

async function seedMergeAccount(
  uid: string,
  receiptFingerprint: string,
  withState: boolean,
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
