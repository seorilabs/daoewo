import { isEntitled, type Entitlement } from "@daoewo/product-core";
import type { Auth } from "firebase-admin/auth";
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Query,
  type Transaction,
} from "firebase-admin/firestore";
import type {
  DeckMetadata,
  DeckProgress,
  DeckRequestRecord,
  DeliveryWindow,
  ProgressBatchReceipt,
  StudyGoal,
} from "../domain/types.js";
import { assertBackend } from "../errors.js";
import type {
  CatalogFilter,
  AccountDeletionRepository,
  AccountDeletionSummary,
  AccountAccessRepository,
  AppsInTossIdentityRepository,
  CatalogRepository,
  DeckRequestRepository,
  DeliveryReservationInput,
  EntitlementRepository,
  GoalRepository,
  GoalWriteInput,
  ProgressCommitInput,
  ProgressCommitResult,
  ReceiptEntitlementRepository,
  StudyRepository,
} from "./contracts.js";
import type {
  AuthorityObservationWindow,
  VerifiedStoreReceipt,
} from "../receipts/providers.js";
import { addHours, utcDateKey } from "../utils/time.js";
import { sha256 } from "../utils/hash.js";
import {
  decideStoreNotificationUpdate,
  isIncomingAuthorityNewer,
  type CurrentEntitlementProjection,
} from "../store-notifications/policy.js";
import type {
  ReceiptClaimResolution,
  StoreNotificationApplyResult,
  StoreNotificationRepository,
} from "../store-notifications/types.js";
import { convergeEntitlementCustomClaims } from "../store-notifications/custom-claims-projector.js";

export class FirestoreRepository
  implements
    AccountAccessRepository,
    AccountDeletionRepository,
    CatalogRepository,
    EntitlementRepository,
    GoalRepository,
    StudyRepository,
    DeckRequestRepository,
    ReceiptEntitlementRepository,
    AppsInTossIdentityRepository,
    StoreNotificationRepository
{
  constructor(
    private readonly db: Firestore,
    private readonly auth: Auth,
  ) {}

  async listPublishedDecks(filter: CatalogFilter): Promise<DeckMetadata[]> {
    let query: Query<DocumentData> = this.db
      .collection("decks")
      .where("status", "==", "published");
    if (filter.category !== undefined) {
      query = query.where("category", "==", filter.category);
    }
    if (filter.language !== undefined) {
      query = query.where("language", "==", filter.language);
    }
    const snapshot = await query.orderBy("publishedAt", "desc").limit(100).get();
    return snapshot.docs.map((doc) => parseDeck(doc.id, doc.data()));
  }

  async getDeck(deckId: string): Promise<DeckMetadata | null> {
    const snapshot = await this.db.collection("decks").doc(deckId).get();
    return snapshot.exists ? parseDeck(snapshot.id, snapshot.data() ?? {}) : null;
  }

  async getEntitlement(uid: string): Promise<Entitlement | null> {
    const snapshot = await this.db
      .collection("users")
      .doc(uid)
      .collection("entitlements")
      .doc("pro")
      .get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() ?? {};
    return parseEntitlement(data.entitlement ?? data);
  }

  async getGoal(uid: string, goalId: string): Promise<StudyGoal | null> {
    const snapshot = await this.goalRef(uid, goalId).get();
    return snapshot.exists ? parseGoal(snapshot.id, snapshot.data() ?? {}) : null;
  }

  async isFreeActiveGoalAllowed(uid: string, goalId: string): Promise<boolean> {
    const snapshot = await this.db
      .collection("users")
      .doc(uid)
      .collection("goals")
      .where("active", "==", true)
      .orderBy("updatedAt", "desc")
      .limit(1)
      .get();
    return snapshot.docs[0]?.id === goalId;
  }

  async createOrResetGoal(input: GoalWriteInput): Promise<StudyGoal> {
    const goalRef = this.goalRef(input.uid, input.goal.id);
    const activeQuery = this.db
      .collection("users")
      .doc(input.uid)
      .collection("goals")
      .where("active", "==", true)
      .limit((input.maxActiveGoals ?? 20) + 1);

    return this.db.runTransaction(async (transaction) => {
      await this.assertTransactionAccountNotDeleting(transaction, input.uid);
      const [existingSnapshot, activeSnapshot] = await Promise.all([
        transaction.get(goalRef),
        input.maxActiveGoals === null ? Promise.resolve(null) : transaction.get(activeQuery),
      ]);
      const existing = existingSnapshot.exists
        ? parseGoal(existingSnapshot.id, existingSnapshot.data() ?? {})
        : null;

      if (existing !== null) {
        const cooldownBase = Date.parse(existing.lastResetAt ?? existing.createdAt);
        const retryAt = cooldownBase + input.resetCooldownMs;
        assertBackend(
          input.now.getTime() >= retryAt,
          "resource-exhausted",
          "This deck goal can only be reset once every 24 hours.",
          { retryAt: new Date(retryAt).toISOString(), kind: "goal-reset-cooldown" },
        );
      }

      if (activeSnapshot !== null && input.maxActiveGoals !== null) {
        const otherActiveGoals = activeSnapshot.docs.filter((doc) => doc.id !== input.goal.id);
        assertBackend(
          otherActiveGoals.length < input.maxActiveGoals,
          "failed-precondition",
          `Free plans can have at most ${input.maxActiveGoals} active deck.`,
          { kind: "active-goal-limit", limit: input.maxActiveGoals },
        );
      }

      const stored: StudyGoal = {
        ...input.goal,
        createdAt: existing?.createdAt ?? input.goal.createdAt,
        updatedAt: input.now.toISOString(),
        revision: (existing?.revision ?? 0) + 1,
        ...(existing === null ? {} : { lastResetAt: input.now.toISOString() }),
      };
      transaction.set(goalRef, serializeGoal(stored));
      return stored;
    });
  }

  async deactivateGoal(uid: string, goalId: string, now: Date): Promise<void> {
    const ref = this.goalRef(uid, goalId);
    await this.db.runTransaction(async (transaction) => {
      await this.assertTransactionAccountNotDeleting(transaction, uid);
      const snapshot = await transaction.get(ref);
      assertBackend(snapshot.exists, "not-found", "Study goal not found.");
      const goal = parseGoal(snapshot.id, snapshot.data() ?? {});
      transaction.update(ref, {
        active: false,
        updatedAt: Timestamp.fromDate(now),
        revision: goal.revision + 1,
      });
    });
  }

  async getProgress(uid: string, deckId: string): Promise<DeckProgress | null> {
    const snapshot = await this.progressRef(uid, deckId).get();
    return snapshot.exists ? parseProgress(snapshot.data() ?? {}) : null;
  }

  async ensureDeviceAccess(
    uid: string,
    deviceHash: string,
    pro: boolean,
    now: Date,
  ): Promise<void> {
    if (pro) return;
    const ref = this.db
      .collection("users")
      .doc(uid)
      .collection("sync")
      .doc("devicePolicy");
    await this.db.runTransaction(async (transaction) => {
      await this.assertTransactionAccountNotDeleting(transaction, uid);
      const snapshot = await transaction.get(ref);
      const primaryDeviceHash = snapshot.data()?.primaryDeviceHash;
      assertBackend(
        primaryDeviceHash === undefined || primaryDeviceHash === deviceHash,
        "permission-denied",
        "Free cloud sync is bound to another primary device.",
        { kind: "primary-device-mismatch" },
      );
      transaction.set(
        ref,
        {
          primaryDeviceHash: deviceHash,
          boundAt: snapshot.data()?.boundAt ?? Timestamp.fromDate(now),
          lastSeenAt: Timestamp.fromDate(now),
        },
        { merge: true },
      );
    });
  }

  async getSyncState(uid: string) {
    const userRef = this.db.collection("users").doc(uid);
    const [goals, progress] = await Promise.all([
      userRef.collection("goals").get(),
      userRef.collection("deckProgress").get(),
    ]);
    return {
      goals: goals.docs.map((doc) => parseGoal(doc.id, doc.data())),
      progress: progress.docs.map((doc) => parseProgress(doc.data())),
    };
  }

  async assertAccountActive(uid: string): Promise<void> {
    const [mergeSnapshot, deletionSnapshot] = await Promise.all([
      this.db.collection("accountMerges").doc(uid).get(),
      this.accountDeletionRef(uid).get(),
    ]);
    assertBackend(
      !mergeSnapshot.exists,
      "failed-precondition",
      "This account was merged into another Firebase account.",
      { kind: "account-merged" },
    );
    assertBackend(
      !deletionSnapshot.exists,
      "failed-precondition",
      "This account is being deleted.",
      { kind: "account-deleting" },
    );
  }

  async beginAccountDeletion(uid: string, now: Date): Promise<void> {
    const markerRef = this.accountDeletionRef(uid);
    const mergeMarkerRef = this.db.collection("accountMerges").doc(uid);
    await this.db.runTransaction(async (transaction) => {
      const [marker, mergeMarker] = await Promise.all([
        transaction.get(markerRef),
        transaction.get(mergeMarkerRef),
      ]);
      assertBackend(
        !mergeMarker.exists,
        "failed-precondition",
        "A merged source account cannot be deleted again.",
        { kind: "account-merged" },
      );
      if (marker.exists) {
        transaction.set(
          markerRef,
          { status: marker.data()?.status ?? "pending", updatedAt: Timestamp.fromDate(now) },
          { merge: true },
        );
        return;
      }
      transaction.create(markerRef, {
        status: "pending",
        startedAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      });
    });
  }

  async purgeAccountData(uid: string, now: Date): Promise<AccountDeletionSummary> {
    const markerRef = this.accountDeletionRef(uid);
    const marker = await markerRef.get();
    assertBackend(
      marker.exists,
      "failed-precondition",
      "Account deletion must be marked before data cleanup.",
      { kind: "account-deletion-marker-required" },
    );

    const mergeMarkers = await this.db
      .collection("accountMerges")
      .where("targetUid", "==", uid)
      .get();
    const ownedUids = [...new Set([uid, ...mergeMarkers.docs.map((doc) => doc.id)])];
    let deletedDocumentCount = 0;
    let retainedReceiptClaimCount = 0;

    for (const ownedUid of ownedUids) {
      const userRef = this.db.collection("users").doc(ownedUid);
      const [userRoot, goals, progress, entitlements, sync, receiptClaims] =
        await Promise.all([
          userRef.get(),
          userRef.collection("goals").get(),
          userRef.collection("deckProgress").get(),
          userRef.collection("entitlements").get(),
          userRef.collection("sync").get(),
          this.db.collection("receiptClaims").where("uid", "==", ownedUid).get(),
        ]);
      deletedDocumentCount +=
        (userRoot.exists ? 1 : 0) +
        goals.size +
        progress.size +
        entitlements.size +
        sync.size;

      // receipt fingerprint는 환불/복원 탈취 방지를 위해 삭제하지 않고 소유자 식별자만 제거한다.
      for (const claim of receiptClaims.docs) {
        await this.db.runTransaction(async (transaction) => {
          const current = await transaction.get(claim.ref);
          assertBackend(
            current.exists && current.data()?.uid === ownedUid,
            "aborted",
            "Receipt claim ownership changed during account deletion.",
            { kind: "receipt-binding-conflict" },
          );
          transaction.update(claim.ref, {
            uid: FieldValue.delete(),
            platform: FieldValue.delete(),
            productId: FieldValue.delete(),
            originalTransactionId: FieldValue.delete(),
            mergedFromUid: FieldValue.delete(),
            ownershipState: "account-deleted",
            bindingRetained: true,
            ownerDeletedAt: Timestamp.fromDate(now),
            updatedAt: Timestamp.fromDate(now),
          });
        });
        retainedReceiptClaimCount += 1;
      }

      const ownedQueries = [
        this.db.collection("deliveryLogs").where("uid", "==", ownedUid),
        this.db.collection("deliveryCounters").where("uid", "==", ownedUid),
        this.db.collection("deckRequests").where("uid", "==", ownedUid),
        this.db.collection("deckRequestCounters").where("uid", "==", ownedUid),
        this.db.collection("subscriptionEvents").where("uid", "==", ownedUid),
        this.db
          .collection("tossAppCheckRefreshCounters")
          .where("uidHash", "==", sha256(ownedUid)),
      ];
      for (const query of ownedQueries) {
        deletedDocumentCount += await this.deleteQueryDocuments(query);
      }

      await this.db.recursiveDelete(userRef);
    }

    // source의 merge blocker를 먼저 지우면 폐기 확인 없는 stale ID token이 source UID를
    // 다시 활성화할 수 있다. 각 source마다 deletion tombstone 생성과 merge marker 삭제를
    // 같은 atomic batch로 전환해 blocker가 없는 순간을 만들지 않는다.
    for (const mergeMarker of mergeMarkers.docs) {
      const sourceUid = mergeMarker.id;
      const transition = this.db.batch();
      transition.create(this.accountDeletionRef(sourceUid), {
        status: "blocked",
        reason: "merged-target-deleted",
        createdAt: Timestamp.fromDate(now),
      });
      transition.delete(mergeMarker.ref);
      await transition.commit();
      deletedDocumentCount += 1;
    }
    await markerRef.set(
      {
        status: "data-purged",
        dataPurgedAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
        deletedUidCount: ownedUids.length,
        deletedDocumentCount,
        retainedReceiptClaimCount,
      },
      { merge: true },
    );

    return {
      deletedUidCount: ownedUids.length,
      deletedDocumentCount,
      retainedReceiptClaimCount,
    };
  }

  async mergeAnonymousAccount(input: {
    sourceUid: string;
    targetUid: string;
    deviceHash: string;
    now: Date;
  }): Promise<{
    merged: true;
    goalCount: number;
    progressDeckCount: number;
    entitlementMoved: boolean;
  }> {
    const sourceUser = this.db.collection("users").doc(input.sourceUid);
    const targetUser = this.db.collection("users").doc(input.targetUid);
    const sourceEntitlementRef = sourceUser.collection("entitlements").doc("pro");
    const targetEntitlementRef = targetUser.collection("entitlements").doc("pro");
    const sourcePolicyRef = sourceUser.collection("sync").doc("devicePolicy");
    const targetPolicyRef = targetUser.collection("sync").doc("devicePolicy");
    const sourceMarkerRef = this.db.collection("accountMerges").doc(input.sourceUid);
    const targetMarkerRef = this.db.collection("accountMerges").doc(input.targetUid);
    const sourceClaimsQuery = this.db
      .collection("receiptClaims")
      .where("uid", "==", input.sourceUid);
    const sourceDeckRequestsQuery = this.db
      .collection("deckRequests")
      .where("uid", "==", input.sourceUid);

    const result = await this.db.runTransaction(async (transaction) => {
      await Promise.all([
        this.assertTransactionAccountNotDeleting(transaction, input.sourceUid),
        this.assertTransactionAccountNotDeleting(transaction, input.targetUid),
      ]);
      const [
        sourceGoals,
        targetGoals,
        sourceProgress,
        targetProgress,
        sourceEntitlement,
        targetEntitlement,
        sourcePolicy,
        targetPolicy,
        sourceMarker,
        targetMarker,
        sourceClaims,
        sourceDeckRequests,
      ] = await Promise.all([
        transaction.get(sourceUser.collection("goals")),
        transaction.get(targetUser.collection("goals")),
        transaction.get(sourceUser.collection("deckProgress")),
        transaction.get(targetUser.collection("deckProgress")),
        transaction.get(sourceEntitlementRef),
        transaction.get(targetEntitlementRef),
        transaction.get(sourcePolicyRef),
        transaction.get(targetPolicyRef),
        transaction.get(sourceMarkerRef),
        transaction.get(targetMarkerRef),
        transaction.get(sourceClaimsQuery),
        transaction.get(sourceDeckRequestsQuery),
      ]);
      assertBackend(
        !sourceMarker.exists && !targetMarker.exists,
        "failed-precondition",
        "One of the Firebase accounts was already merged.",
        { kind: "account-merge-conflict" },
      );

      const sourceEntitlementData = sourceEntitlement.data();
      const targetEntitlementData = targetEntitlement.data();
      const sourceFingerprint = stringOrUndefined(
        sourceEntitlementData?.receiptFingerprint,
      );
      const targetFingerprint = stringOrUndefined(
        targetEntitlementData?.receiptFingerprint,
      );
      const sourceEntitlementSource = stringOrUndefined(
        sourceEntitlementData?.source,
      );
      if (
        sourceEntitlement.exists &&
        sourceEntitlementSource !== undefined &&
        ["google-play", "app-store", "apps-in-toss"].includes(
          sourceEntitlementSource,
        )
      ) {
        assertBackend(
          sourceFingerprint !== undefined,
          "failed-precondition",
          "Source store entitlement has no authoritative receipt fingerprint.",
          { kind: "receipt-binding-conflict" },
        );
      }
      if (sourceEntitlement.exists && targetEntitlement.exists) {
        assertBackend(
          sourceFingerprint !== undefined &&
            sourceFingerprint === targetFingerprint,
          "failed-precondition",
          "Source and target accounts have conflicting store entitlements.",
          { kind: "entitlement-ownership-conflict" },
        );
      }
      if (sourceEntitlement.exists && sourceFingerprint !== undefined) {
        assertBackend(
          sourceClaims.docs.some((claim) => claim.id === sourceFingerprint),
          "failed-precondition",
          "Source entitlement is missing its authoritative receipt binding.",
          { kind: "receipt-binding-conflict" },
        );
      }
      for (const claim of sourceClaims.docs) {
        assertBackend(
          claim.data().uid === input.sourceUid,
          "failed-precondition",
          "Receipt claim ownership changed during account merge.",
          { kind: "receipt-binding-conflict" },
        );
      }

      const mergedEntitlementData = selectEntitlementData(
        sourceEntitlementData,
        targetEntitlementData,
        input.now,
      );
      const mergedEntitlement =
        mergedEntitlementData === null
          ? null
          : parseEntitlement(
              mergedEntitlementData.entitlement ?? mergedEntitlementData,
            );
      const pro = mergedEntitlement !== null && isEntitled(mergedEntitlement, input.now);

      const goals = new Map<string, StudyGoal>();
      for (const doc of targetGoals.docs) goals.set(doc.id, parseGoal(doc.id, doc.data()));
      for (const doc of sourceGoals.docs) {
        const source = parseGoal(doc.id, doc.data());
        goals.set(
          doc.id,
          mergeGoal(goals.get(doc.id) ?? null, source, input.targetUid, input.now),
        );
      }
      if (!pro) {
        const active = [...goals.values()]
          .filter((goal) => goal.active)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const allowedGoalId = active[0]?.id;
        for (const [id, goal] of goals) {
          if (goal.active && id !== allowedGoalId) {
            goals.set(id, {
              ...goal,
              active: false,
              updatedAt: input.now.toISOString(),
              revision: goal.revision + 1,
            });
          }
        }
      }

      const progress = new Map<string, DeckProgress>();
      for (const doc of targetProgress.docs) {
        progress.set(doc.id, parseProgress(doc.data()));
      }
      for (const doc of sourceProgress.docs) {
        const source = parseProgress(doc.data());
        progress.set(
          doc.id,
          mergeDeckProgress(
            progress.get(doc.id) ?? null,
            source,
            input.targetUid,
            input.now,
          ),
        );
      }

      const writeCount =
        goals.size +
        progress.size +
        sourceGoals.size +
        sourceProgress.size +
        sourceClaims.size +
        sourceDeckRequests.size +
        8;
      assertBackend(
        writeCount <= 450,
        "resource-exhausted",
        "Account has too much state for one atomic merge.",
        { kind: "account-merge-size", writeCount },
      );

      for (const [id, goal] of goals) {
        transaction.set(targetUser.collection("goals").doc(id), serializeGoal(goal));
      }
      for (const doc of sourceGoals.docs) transaction.delete(doc.ref);
      for (const [id, state] of progress) {
        transaction.set(
          targetUser.collection("deckProgress").doc(id),
          serializeProgress(state),
        );
      }
      for (const doc of sourceProgress.docs) transaction.delete(doc.ref);

      if (mergedEntitlementData !== null) {
        transaction.set(targetEntitlementRef, {
          ...mergedEntitlementData,
          mergedFromUid: input.sourceUid,
          updatedAt: Timestamp.fromDate(input.now),
        });
      }
      if (sourceEntitlement.exists) transaction.delete(sourceEntitlementRef);
      for (const claim of sourceClaims.docs) {
        transaction.update(claim.ref, {
          uid: input.targetUid,
          mergedFromUid: input.sourceUid,
          updatedAt: Timestamp.fromDate(input.now),
        });
      }
      for (const request of sourceDeckRequests.docs) {
        transaction.update(request.ref, {
          uid: input.targetUid,
          updatedAt: Timestamp.fromDate(input.now),
        });
      }

      const sourcePrimary = stringOrUndefined(sourcePolicy.data()?.primaryDeviceHash);
      const targetPrimary = stringOrUndefined(targetPolicy.data()?.primaryDeviceHash);
      if (!pro) {
        assertBackend(
          (sourcePrimary === undefined || sourcePrimary === input.deviceHash) &&
            (targetPrimary === undefined || targetPrimary === input.deviceHash),
          "failed-precondition",
          "Free account device ownership conflicts during merge.",
          { kind: "primary-device-conflict" },
        );
      }
      transaction.set(targetPolicyRef, {
        primaryDeviceHash: targetPrimary ?? sourcePrimary ?? input.deviceHash,
        boundAt:
          targetPolicy.data()?.boundAt ??
          sourcePolicy.data()?.boundAt ??
          Timestamp.fromDate(input.now),
        lastSeenAt: Timestamp.fromDate(input.now),
      });
      if (sourcePolicy.exists) transaction.delete(sourcePolicyRef);
      transaction.create(sourceMarkerRef, {
        sourceUid: input.sourceUid,
        targetUid: input.targetUid,
        mergedAt: Timestamp.fromDate(input.now),
        billingBindingRetained: true,
      });

      return {
        merged: true as const,
        goalCount: goals.size,
        progressDeckCount: progress.size,
        entitlementMoved: sourceEntitlement.exists && !targetEntitlement.exists,
        entitlement: mergedEntitlement,
      };
    });

    if (result.entitlement !== null) {
      await this.syncEntitlementClaims(input.targetUid, input.now);
    }
    try {
      await this.auth.revokeRefreshTokens(input.sourceUid);
      await this.auth.deleteUser(input.sourceUid);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code !== "auth/user-not-found") throw error;
    }
    return {
      merged: true,
      goalCount: result.goalCount,
      progressDeckCount: result.progressDeckCount,
      entitlementMoved: result.entitlementMoved,
    };
  }

  async reserveDelivery(input: DeliveryReservationInput): Promise<DeliveryWindow> {
    const { window } = input;
    const windowRef = this.db.collection("deliveryLogs").doc(window.id);
    const progressRef = this.progressRef(window.uid, window.deckId);
    const userCounterRef = this.db
      .collection("deliveryCounters")
      .doc(`${window.premium ? "premium" : "free"}-user_${window.uid}_${window.quotaDateKey}`);
    const deviceCounterRef = window.premium
      ? this.db
          .collection("deliveryCounters")
          .doc(`premium-device_${window.deviceHash}_${window.quotaDateKey}`)
      : null;

    return this.db.runTransaction(async (transaction) => {
      await this.assertTransactionAccountNotDeleting(transaction, window.uid);
      const [existingWindow, progressSnapshot, userCounter, deviceCounter] = await Promise.all([
        transaction.get(windowRef),
        transaction.get(progressRef),
        transaction.get(userCounterRef),
        deviceCounterRef === null ? Promise.resolve(null) : transaction.get(deviceCounterRef),
      ]);
      if (existingWindow.exists) {
        return parseWindow(existingWindow.id, existingWindow.data() ?? {});
      }

      const cardKeys = input.cards.map((card) => `${window.deckId}:${card.id}`);
      const existingUserKeys = stringArray(userCounter.data()?.uniqueCardKeys);
      const nextUserKeys = mergeUnique(existingUserKeys, cardKeys);
      if (input.hardUserDailyLimit !== null) {
        assertBackend(
          nextUserKeys.length <= input.hardUserDailyLimit,
          "resource-exhausted",
          `The Free daily limit is ${input.hardUserDailyLimit} cards.`,
          { kind: "free-daily-limit", limit: input.hardUserDailyLimit },
        );
      }
      if (input.premiumUserDailySoftCap !== null) {
        assertBackend(
          nextUserKeys.length <= input.premiumUserDailySoftCap,
          "resource-exhausted",
          "Premium delivery was temporarily throttled for unusual activity.",
          {
            kind: "abuse-soft-cap",
            scope: "user",
            softCap: input.premiumUserDailySoftCap,
          },
        );
      }

      let nextDeviceKeys: string[] | null = null;
      if (deviceCounterRef !== null && input.premiumDeviceDailySoftCap !== null) {
        nextDeviceKeys = mergeUnique(
          stringArray(deviceCounter?.data()?.uniqueCardKeys),
          cardKeys,
        );
        assertBackend(
          nextDeviceKeys.length <= input.premiumDeviceDailySoftCap,
          "resource-exhausted",
          "Premium delivery was temporarily throttled for unusual device activity.",
          {
            kind: "abuse-soft-cap",
            scope: "device",
            softCap: input.premiumDeviceDailySoftCap,
          },
        );
      }

      const issuedAt = new Date(window.issuedAt);
      transaction.set(userCounterRef, {
        scope: "user",
        premium: window.premium,
        uid: window.uid,
        dateKey: window.quotaDateKey,
        uniqueCardKeys: nextUserKeys,
        count: nextUserKeys.length,
        updatedAt: Timestamp.fromDate(issuedAt),
        expiresAt: Timestamp.fromDate(addHours(issuedAt, 72)),
      });
      if (deviceCounterRef !== null && nextDeviceKeys !== null) {
        transaction.set(deviceCounterRef, {
          scope: "device",
          premium: true,
          deviceHash: window.deviceHash,
          dateKey: window.quotaDateKey,
          uniqueCardKeys: nextDeviceKeys,
          count: nextDeviceKeys.length,
          updatedAt: Timestamp.fromDate(issuedAt),
          expiresAt: Timestamp.fromDate(addHours(issuedAt, 72)),
        });
      }

      const parsedProgress = progressSnapshot.exists
        ? parseProgress(progressSnapshot.data() ?? {})
        : null;
      const existingProgress =
        parsedProgress?.deckVersion === window.deckVersion
          ? parsedProgress
          : emptyProgress(window.uid, window.deckId, window.deckVersion, issuedAt);
      const progress: DeckProgress = {
        ...existingProgress,
        deckVersion: window.deckVersion,
        deliveredCardIds: mergeUnique(existingProgress.deliveredCardIds, window.cardIds),
        revision: existingProgress.revision + 1,
        updatedAt: window.issuedAt,
      };
      transaction.set(progressRef, serializeProgress(progress));
      transaction.create(windowRef, serializeWindow(window));
      return window;
    });
  }

  async getDeliveryWindow(uid: string, windowId: string): Promise<DeliveryWindow | null> {
    const snapshot = await this.db.collection("deliveryLogs").doc(windowId).get();
    if (!snapshot.exists) return null;
    const window = parseWindow(snapshot.id, snapshot.data() ?? {});
    return window.uid === uid ? window : null;
  }

  async commitProgress(input: ProgressCommitInput): Promise<ProgressCommitResult> {
    const windowRef = this.db.collection("deliveryLogs").doc(input.windowId);

    return this.db.runTransaction(async (transaction) => {
      await this.assertTransactionAccountNotDeleting(transaction, input.uid);
      const windowSnapshot = await transaction.get(windowRef);
      assertBackend(windowSnapshot.exists, "not-found", "Delivery window not found.");
      const window = parseWindow(windowSnapshot.id, windowSnapshot.data() ?? {});
      assertBackend(window.uid === input.uid, "permission-denied", "Delivery window owner mismatch.");
      assertBackend(
        Date.parse(window.expiresAt) > input.now.getTime(),
        "failed-precondition",
        "Delivery window has expired.",
      );
      assertBackend(
        window.batchId === undefined || window.batchId === input.batchId,
        "failed-precondition",
        "Delivery window was already submitted with another batch.",
      );
      const allowedCards = new Set(window.cardIds);
      assertBackend(
        input.answers.every((answer) => allowedCards.has(answer.cardId)),
        "permission-denied",
        "Progress contains a card outside the delivery window.",
      );

      const progressRef = this.progressRef(input.uid, window.deckId);
      const progressSnapshot = await transaction.get(progressRef);
      const current = progressSnapshot.exists
        ? parseProgress(progressSnapshot.data() ?? {})
        : emptyProgress(input.uid, window.deckId, window.deckVersion, input.now);
      const priorReceipt = current.recentBatches[input.batchId];
      if (priorReceipt !== undefined) {
        return {
          idempotent: true,
          progress: current,
          receipt: { batchId: input.batchId, ...priorReceipt },
        };
      }

      const calculated = input.calculate(current, input.answers);
      const receipt: ProgressBatchReceipt = {
        submittedAt: input.now.toISOString(),
        updatedCount: input.answers.length,
        windowId: window.id,
      };
      const next: DeckProgress = {
        ...calculated,
        recentBatches: trimBatchReceipts({
          ...calculated.recentBatches,
          [input.batchId]: receipt,
        }),
      };
      transaction.set(progressRef, serializeProgress(next));
      transaction.update(windowRef, {
        completedAt: Timestamp.fromDate(input.now),
        batchId: input.batchId,
      });
      return {
        idempotent: false,
        progress: next,
        receipt: { batchId: input.batchId, ...receipt },
      };
    });
  }

  async createDeckRequest(
    request: Omit<DeckRequestRecord, "id">,
    dailyLimit: number,
  ): Promise<DeckRequestRecord> {
    const dateKey = utcDateKey(new Date(request.createdAt));
    const requestRef = this.db.collection("deckRequests").doc();
    const counterRef = this.db
      .collection("deckRequestCounters")
      .doc(`${request.uid}_${dateKey}`);

    return this.db.runTransaction(async (transaction) => {
      await this.assertTransactionAccountNotDeleting(transaction, request.uid);
      const counter = await transaction.get(counterRef);
      const count = numberValue(counter.data()?.count, 0);
      assertBackend(
        count < dailyLimit,
        "resource-exhausted",
        `Deck requests are limited to ${dailyLimit} per day.`,
        { kind: "deck-request-rate-limit", limit: dailyLimit },
      );
      const result: DeckRequestRecord = { id: requestRef.id, ...request };
      transaction.create(requestRef, serializeDeckRequest(result));
      transaction.set(counterRef, {
        uid: request.uid,
        dateKey,
        count: count + 1,
        updatedAt: Timestamp.fromDate(new Date(request.createdAt)),
        expiresAt: Timestamp.fromDate(addHours(new Date(request.createdAt), 72)),
      });
      return result;
    });
  }

  async applyVerifiedReceipt(
    uid: string,
    receipt: VerifiedStoreReceipt,
    receiptFingerprint: string,
    authorityObservation: AuthorityObservationWindow,
    now: Date,
  ): Promise<Entitlement> {
    const claimRef = this.db.collection("receiptClaims").doc(receiptFingerprint);
    const entitlementRef = this.db
      .collection("users")
      .doc(uid)
      .collection("entitlements")
      .doc("pro");

    const entitlement = await this.db.runTransaction(async (transaction) => {
      const [claim, currentEntitlement] = await Promise.all([
        transaction.get(claimRef),
        transaction.get(entitlementRef),
        this.assertTransactionAccountNotDeleting(transaction, uid),
      ]);
      if (claim.exists) {
        assertBackend(
          claim.data()?.uid === uid && claim.data()?.ownershipState !== "account-deleted",
          "permission-denied",
          "This store purchase is already bound to another account.",
        );
      }
      const currentProjection = currentEntitlementProjection(
        currentEntitlement.data(),
      );
      const incomingObservation = {
        ...authorityObservation,
        observationId: `direct:${receiptFingerprint}`,
      };
      const incomingStartedAt = Date.parse(authorityObservation.startedAt);
      const incomingObservedAt = Date.parse(authorityObservation.observedAt);
      assertBackend(
        Number.isFinite(incomingStartedAt) &&
          Number.isFinite(incomingObservedAt) &&
          incomingStartedAt <= incomingObservedAt,
        "internal",
        "Store verification returned an invalid authority observation.",
      );
      assertBackend(
        currentProjection?.authorityObservation === undefined ||
          isIncomingAuthorityNewer({
            current: currentProjection.authorityObservation,
            currentActive: currentProjection.entitlement.plan === "pro",
            incoming: incomingObservation,
            incomingActive: true,
          }),
        "aborted",
        "A newer store notification was applied during receipt verification.",
        { kind: "stale-receipt-verification" },
      );
      transaction.set(claimRef, {
        uid,
        platform: receipt.platform,
        productId: receipt.productId,
        originalTransactionId: receipt.originalTransactionId,
        claimedAt: claim.data()?.claimedAt ?? Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      });
      transaction.set(entitlementRef, {
        entitlement: receipt.entitlement,
        source: receipt.platform,
        productId: receipt.productId,
        originalTransactionId: receipt.originalTransactionId,
        receiptFingerprint,
        environment: receipt.environment,
        authorityObservationStartedAt: Timestamp.fromDate(
          new Date(authorityObservation.startedAt),
        ),
        authorityObservedAt: Timestamp.fromDate(
          new Date(authorityObservation.observedAt),
        ),
        authorityObservationId: `direct:${receiptFingerprint}`,
        directVerificationStartedAt: Timestamp.fromDate(
          new Date(authorityObservation.startedAt),
        ),
        authorityCommittedAt: Timestamp.fromDate(now),
        verifiedAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      });
      return receipt.entitlement;
    });

    await this.syncEntitlementClaims(uid, now);
    return entitlement;
  }

  async resolveReceiptClaim(
    fingerprint: string,
  ): Promise<ReceiptClaimResolution> {
    const claim = await this.db.collection("receiptClaims").doc(fingerprint).get();
    const resolution = parseStoreReceiptClaim(fingerprint, claim.exists, claim.data());
    if (resolution.kind !== "claimed") return resolution;
    const deletion = await this.accountDeletionRef(resolution.uid).get();
    return deletion.exists
      ? { kind: "account-deleted", fingerprint }
      : resolution;
  }

  async applyAuthoritativeSubscriptionState(input: {
    notification: import("../store-notifications/types.js").VerifiedStoreSubscriptionNotification;
    expectedClaim: Extract<ReceiptClaimResolution, { kind: "claimed" }>;
    state: import("../store-notifications/types.js").AuthoritativeSubscriptionState;
    now: Date;
  }): Promise<StoreNotificationApplyResult> {
    const fingerprint = input.notification.receiptFingerprint;
    const claimRef = this.db.collection("receiptClaims").doc(fingerprint);
    const eventRef = this.db
      .collection("subscriptionEvents")
      .doc(sha256(`${input.notification.platform}:${input.notification.cursor.eventId}`));

    const result = await this.db.runTransaction(async (transaction) => {
      const [claimSnapshot, priorEvent] = await Promise.all([
        transaction.get(claimRef),
        transaction.get(eventRef),
      ]);
      const claim = parseStoreReceiptClaim(
        fingerprint,
        claimSnapshot.exists,
        claimSnapshot.data(),
      );
      if (claim.kind !== "claimed") {
        return { outcome: claim.kind, uid: null } as const;
      }
      assertBackend(
        claim.uid === input.expectedClaim.uid &&
          claim.platform === input.expectedClaim.platform &&
          claim.productId === input.expectedClaim.productId &&
          claim.originalTransactionId === input.expectedClaim.originalTransactionId &&
          claim.platform === input.notification.platform &&
          (claim.productId === input.state.productId ||
            (claim.platform === "app-store" &&
              input.notification.platform === "app-store")) &&
          claim.originalTransactionId === input.state.originalTransactionId,
        "aborted",
        "Receipt claim ownership changed while processing a store notification.",
        { kind: "receipt-binding-conflict" },
      );

      const entitlementRef = this.db
        .collection("users")
        .doc(claim.uid)
        .collection("entitlements")
        .doc("pro");
      const [deletion, currentSnapshot] = await Promise.all([
        transaction.get(this.accountDeletionRef(claim.uid)),
        transaction.get(entitlementRef),
      ]);
      if (deletion.exists) {
        return { outcome: "account-deleted", uid: null } as const;
      }

      if (priorEvent.exists) {
        assertBackend(
          currentSnapshot.exists,
          "internal",
          "Store notification exists without an entitlement projection.",
        );
        return {
          outcome: "idempotent",
          uid: claim.uid,
          entitlement: parseEntitlement(
            currentSnapshot.data()?.entitlement ?? currentSnapshot.data(),
          ),
        } as const;
      }

      const current = currentEntitlementProjection(currentSnapshot.data());
      const decision = decideStoreNotificationUpdate({
        current,
        incomingFingerprint: fingerprint,
        incomingCursor: input.notification.cursor,
        incomingObservation: {
          ...input.state.authorityObservation,
          observationId: `${input.notification.platform}:${input.notification.cursor.eventId}`,
        },
        incomingState: input.state,
        now: input.now,
      });
      const eventData: DocumentData = {
        platform: input.notification.platform,
        eventType: input.notification.eventType,
        notificationType: input.notification.notificationType,
        eventId: input.notification.cursor.eventId,
        occurredAt: Timestamp.fromDate(new Date(input.notification.cursor.occurredAt)),
        receivedAt: Timestamp.fromDate(input.now),
        uid: claim.uid,
        productId: input.state.productId,
        receiptFingerprint: fingerprint,
        environment: input.state.environment,
        storeState: input.state.storeState,
        active: input.state.active,
        outcome: decision,
        applied: decision === "apply",
        ...(input.notification.platform === "app-store" &&
        input.notification.subtype !== undefined
          ? { subtype: input.notification.subtype }
          : {}),
        ...(input.notification.platform === "google-play" &&
        input.notification.voidedRefundType !== undefined
          ? { voidedRefundType: input.notification.voidedRefundType }
          : {}),
      };
      transaction.create(eventRef, eventData);

      if (decision !== "apply") {
        assertBackend(
          current !== null,
          "internal",
          "A store notification was skipped without a current entitlement.",
        );
        return {
          outcome: decision,
          uid: claim.uid,
          entitlement: current.entitlement,
        } as const;
      }

      if (
        claim.platform === "app-store" &&
        claim.productId !== input.state.productId
      ) {
        transaction.update(claimRef, {
          productId: input.state.productId,
          updatedAt: Timestamp.fromDate(input.now),
        });
      }

      transaction.set(entitlementRef, {
        entitlement: input.state.entitlement,
        source: input.state.platform,
        productId: input.state.productId,
        originalTransactionId: input.state.originalTransactionId,
        receiptFingerprint: fingerprint,
        environment: input.state.environment,
        storeState: input.state.storeState,
        storeEventOccurredAt: Timestamp.fromDate(
          new Date(input.notification.cursor.occurredAt),
        ),
        storeEventId: input.notification.cursor.eventId,
        authorityObservationStartedAt: Timestamp.fromDate(
          new Date(input.state.authorityObservation.startedAt),
        ),
        authorityObservedAt: Timestamp.fromDate(
          new Date(input.state.authorityObservation.observedAt),
        ),
        authorityObservationId: `${input.notification.platform}:${input.notification.cursor.eventId}`,
        notificationAppliedAt: Timestamp.fromDate(input.now),
        authorityCommittedAt: Timestamp.fromDate(input.now),
        verifiedAt: Timestamp.fromDate(input.now),
        updatedAt: Timestamp.fromDate(input.now),
      });
      return {
        outcome: "applied",
        uid: claim.uid,
        entitlement: input.state.entitlement,
      } as const;
    });

    if (result.uid !== null) {
      try {
        // Firestore commit 뒤 custom claim 반영이 실패해도 같은 event 재처리에서 다시 투영한다.
        await this.syncEntitlementClaims(result.uid, input.now);
      } catch (error) {
        const currentClaim = await this.resolveReceiptClaim(fingerprint);
        if (currentClaim.kind === "account-deleted") {
          return { outcome: "account-deleted", uid: null };
        }
        throw error;
      }
    }
    return result;
  }

  async applyVerifiedSubscriptionEvent(
    event: import("../apps-in-toss/provider.js").VerifiedTossSubscriptionEvent,
    receiptFingerprint: string,
    now: Date,
  ): Promise<{
    uid: string;
    entitlement: Entitlement;
    applied: boolean;
    idempotent: boolean;
  }> {
    const claimRef = this.db.collection("receiptClaims").doc(receiptFingerprint);
    const eventRef = this.db.collection("subscriptionEvents").doc(event.eventId);

    const result = await this.db.runTransaction(async (transaction) => {
      const claim = await transaction.get(claimRef);
      assertBackend(
        claim.exists && typeof claim.data()?.uid === "string",
        "failed-precondition",
        "AppsInToss subscription is not bound to a verified account.",
      );
      const uid = claim.data()?.uid as string;
      const entitlementRef = this.db
        .collection("users")
        .doc(uid)
        .collection("entitlements")
        .doc("pro");
      const [priorEvent, currentEntitlementSnapshot] = await Promise.all([
        transaction.get(eventRef),
        transaction.get(entitlementRef),
        this.assertTransactionAccountNotDeleting(transaction, uid),
      ]);
      if (priorEvent.exists) {
        assertBackend(
          currentEntitlementSnapshot.exists,
          "internal",
          "Subscription event exists without an entitlement record.",
        );
        return {
          uid,
          entitlement: parseEntitlement(
            currentEntitlementSnapshot.data()?.entitlement ??
              currentEntitlementSnapshot.data(),
          ),
          applied: priorEvent.data()?.applied === true,
          idempotent: true,
        };
      }

      const currentData = currentEntitlementSnapshot.data() ?? {};
      const previousOccurredAt = dateValue(currentData.storeEventOccurredAt);
      const stale =
        currentEntitlementSnapshot.exists &&
        Date.parse(previousOccurredAt) >= Date.parse(event.occurredAt);
      transaction.create(eventRef, {
        platform: "apps-in-toss",
        eventType: event.eventType,
        subscriptionId: event.subscriptionId,
        orderId: event.orderId,
        sku: event.sku,
        occurredAt: Timestamp.fromDate(new Date(event.occurredAt)),
        receivedAt: Timestamp.fromDate(now),
        uid,
        applied: !stale,
      });
      if (stale) {
        return {
          uid,
          entitlement: parseEntitlement(
            currentData.entitlement ?? currentData,
          ),
          applied: false,
          idempotent: false,
        };
      }

      transaction.set(entitlementRef, {
        entitlement: event.receipt.entitlement,
        source: "apps-in-toss",
        productId: event.sku,
        originalTransactionId: event.subscriptionId,
        receiptFingerprint,
        environment: event.receipt.environment,
        verifiedAt: Timestamp.fromDate(now),
        storeEventOccurredAt: Timestamp.fromDate(new Date(event.occurredAt)),
        updatedAt: Timestamp.fromDate(now),
      });
      return {
        uid,
        entitlement: event.receipt.entitlement,
        applied: true,
        idempotent: false,
      };
    });

    await this.syncEntitlementClaims(result.uid, now);
    return result;
  }

  async claimOneTimeAuthorizationCode(
    fingerprint: string,
    requesterHash: string,
    hourlyLimit: number,
    now: Date,
  ): Promise<void> {
    const ref = this.db.collection("tossAuthCodeClaims").doc(fingerprint);
    const hourKey = now.toISOString().slice(0, 13).replace(/[-T:]/g, "");
    const counterRef = this.db
      .collection("tossAuthExchangeCounters")
      .doc(`${requesterHash}_${hourKey}`);
    await this.db.runTransaction(async (transaction) => {
      const [existing, counter] = await Promise.all([
        transaction.get(ref),
        transaction.get(counterRef),
      ]);
      assertBackend(
        !existing.exists,
        "already-exists",
        "AppsInToss authorizationCode was already consumed.",
      );
      const count = numberValue(counter.data()?.count, 0);
      assertBackend(
        count < hourlyLimit,
        "resource-exhausted",
        "AppsInToss login exchange was temporarily rate limited.",
        { kind: "toss-auth-rate-limit", limit: hourlyLimit },
      );
      transaction.create(ref, {
        consumedAt: Timestamp.fromDate(now),
        expiresAt: Timestamp.fromDate(addHours(now, 1)),
      });
      transaction.set(counterRef, {
        requesterHash,
        hourKey,
        count: count + 1,
        updatedAt: Timestamp.fromDate(now),
        expiresAt: Timestamp.fromDate(addHours(now, 2)),
      });
    });
  }

  async consumeAppCheckRefreshQuota(
    uid: string,
    requesterHash: string,
    hourlyLimit: number,
    now: Date,
  ): Promise<void> {
    const hourKey = now.toISOString().slice(0, 13).replace(/[-T:]/g, "");
    const userRef = this.db
      .collection("tossAppCheckRefreshCounters")
      .doc(`user_${sha256(uid)}_${hourKey}`);
    const requesterRef = this.db
      .collection("tossAppCheckRefreshCounters")
      .doc(`requester_${requesterHash}_${hourKey}`);
    await this.db.runTransaction(async (transaction) => {
      await this.assertTransactionAccountNotDeleting(transaction, uid);
      const [userCounter, requesterCounter] = await Promise.all([
        transaction.get(userRef),
        transaction.get(requesterRef),
      ]);
      const userCount = numberValue(userCounter.data()?.count, 0);
      const requesterCount = numberValue(requesterCounter.data()?.count, 0);
      assertBackend(
        userCount < hourlyLimit && requesterCount < hourlyLimit,
        "resource-exhausted",
        "AppsInToss App Check refresh was temporarily rate limited.",
        { kind: "toss-app-check-refresh-rate-limit", limit: hourlyLimit },
      );
      const common = {
        hourKey,
        updatedAt: Timestamp.fromDate(now),
        expiresAt: Timestamp.fromDate(addHours(now, 2)),
      };
      transaction.set(userRef, {
        ...common,
        scope: "user",
        uidHash: sha256(uid),
        count: userCount + 1,
      });
      transaction.set(requesterRef, {
        ...common,
        scope: "requester",
        requesterHash,
        count: requesterCount + 1,
      });
    });
  }

  private async syncEntitlementClaims(uid: string, now: Date): Promise<void> {
    const entitlementRef = this.db
      .collection("users")
      .doc(uid)
      .collection("entitlements")
      .doc("pro");
    await convergeEntitlementCustomClaims({
      readProjection: async () => {
        const snapshot = await entitlementRef.get();
        if (!snapshot.exists) return null;
        const data = snapshot.data() ?? {};
        return {
          version: sha256(
            JSON.stringify([
              data.receiptFingerprint ?? null,
              data.source ?? null,
              data.storeEventId ?? null,
              dateValue(data.updatedAt),
              data.entitlement ?? data,
            ]),
          ),
          entitlement: parseEntitlement(data.entitlement ?? data),
        };
      },
      readCustomClaims: async () =>
        (await this.auth.getUser(uid)).customClaims ?? {},
      writeCustomClaims: async (claims) =>
        this.auth.setCustomUserClaims(uid, claims),
      now,
    });
  }

  private accountDeletionRef(uid: string) {
    return this.db.collection("accountDeletions").doc(uid);
  }

  private async assertTransactionAccountNotDeleting(
    transaction: Transaction,
    uid: string,
  ): Promise<void> {
    const marker = await transaction.get(this.accountDeletionRef(uid));
    assertBackend(
      !marker.exists,
      "failed-precondition",
      "This account is being deleted.",
      { kind: "account-deleting" },
    );
  }

  private async deleteQueryDocuments(query: Query<DocumentData>): Promise<number> {
    const snapshot = await query.get();
    return this.deleteDocumentReferences(snapshot.docs.map((doc) => doc.ref));
  }

  private async deleteDocumentReferences(
    refs: readonly DocumentReference<DocumentData>[],
  ): Promise<number> {
    for (let start = 0; start < refs.length; start += 400) {
      const batch = this.db.batch();
      for (const ref of refs.slice(start, start + 400)) batch.delete(ref);
      await batch.commit();
    }
    return refs.length;
  }

  private goalRef(uid: string, goalId: string) {
    return this.db.collection("users").doc(uid).collection("goals").doc(goalId);
  }

  private progressRef(uid: string, deckId: string) {
    return this.db.collection("users").doc(uid).collection("deckProgress").doc(deckId);
  }
}

function parseDeck(id: string, data: DocumentData): DeckMetadata {
  const tier = data.tier;
  const status = data.status;
  assertBackend(tier === "free" || tier === "pro", "failed-precondition", "Deck tier is invalid.");
  assertBackend(
    status === "draft" || status === "published" || status === "archived",
    "failed-precondition",
    "Deck status is invalid.",
  );
  const deck: DeckMetadata = {
    id,
    title: stringValue(data.title),
    description: stringValue(data.description),
    category: stringValue(data.category),
    language: stringValue(data.language),
    tier,
    status,
    version: numberValue(data.version, 1),
    cardCount: numberValue(data.cardCount, 0),
    chunkSize: numberValue(data.chunkSize, 200),
    tags: stringArray(data.tags),
    publishedAt: dateValue(data.publishedAt),
    updatedAt: dateValue(data.updatedAt),
  };
  if (typeof data.coverImageUrl === "string") deck.coverImageUrl = data.coverImageUrl;
  return deck;
}

function parseEntitlement(value: unknown): Entitlement {
  assertBackend(value !== null && typeof value === "object", "failed-precondition", "Entitlement is invalid.");
  const data = value as Record<string, unknown>;
  assertBackend(data.plan === "free" || data.plan === "pro", "failed-precondition", "Entitlement plan is invalid.");
  assertBackend(typeof data.source === "string", "failed-precondition", "Entitlement source is invalid.");
  assertBackend(
    data.validUntil === null || typeof data.validUntil === "string",
    "failed-precondition",
    "Entitlement validity is invalid.",
  );
  return {
    plan: data.plan,
    source: data.source,
    validUntil: data.validUntil,
  };
}

function parseStoreReceiptClaim(
  fingerprint: string,
  exists: boolean,
  data: DocumentData | undefined,
): ReceiptClaimResolution {
  if (!exists) return { kind: "missing", fingerprint };
  const value = data ?? {};
  if (
    value.ownershipState === "account-deleted" &&
    value.bindingRetained === true &&
    value.uid === undefined
  ) {
    return { kind: "account-deleted", fingerprint };
  }
  const platform = value.platform;
  assertBackend(
    (platform === "google-play" || platform === "app-store") &&
      typeof value.uid === "string" &&
      value.uid.length > 0 &&
      typeof value.productId === "string" &&
      value.productId.length > 0 &&
      typeof value.originalTransactionId === "string" &&
      value.originalTransactionId.length > 0 &&
      value.ownershipState !== "account-deleted",
    "failed-precondition",
    "Store receipt claim is invalid.",
    { kind: "receipt-binding-conflict" },
  );
  return {
    kind: "claimed",
    fingerprint,
    uid: value.uid,
    platform,
    productId: value.productId,
    originalTransactionId: value.originalTransactionId,
  };
}

function currentEntitlementProjection(
  data: DocumentData | undefined,
): CurrentEntitlementProjection | null {
  if (data === undefined) return null;
  const receiptFingerprint = stringOrUndefined(data.receiptFingerprint);
  const storeEventId = stringOrUndefined(data.storeEventId);
  const storeEventOccurredAt = dateValue(data.storeEventOccurredAt);
  const authorityObservationStartedAt =
    timestampMilliseconds(data.authorityObservationStartedAt) ??
    timestampMilliseconds(data.directVerificationStartedAt) ??
    timestampMilliseconds(data.notificationAppliedAt);
  const authorityObservedAt =
    timestampMilliseconds(data.authorityObservedAt) ??
    timestampMilliseconds(data.authorityCommittedAt) ??
    authorityObservationStartedAt;
  const authorityObservationId =
    stringOrUndefined(data.authorityObservationId) ??
    (storeEventId === undefined
      ? receiptFingerprint === undefined
        ? undefined
        : `direct:${receiptFingerprint}`
      : `legacy-notification:${storeEventId}`);
  return {
    entitlement: parseEntitlement(data.entitlement ?? data),
    ...(receiptFingerprint === undefined ? {} : { receiptFingerprint }),
    ...(storeEventId === undefined || storeEventOccurredAt === new Date(0).toISOString()
      ? {}
      : {
          cursor: {
            eventId: storeEventId,
            occurredAt: storeEventOccurredAt,
          },
        }),
    ...(authorityObservationStartedAt === null ||
    authorityObservedAt === null ||
    authorityObservationId === undefined
      ? {}
      : {
          authorityObservation: {
            startedAt: new Date(authorityObservationStartedAt).toISOString(),
            observedAt: new Date(authorityObservedAt).toISOString(),
            observationId: authorityObservationId,
          },
        }),
  };
}

function parseGoal(id: string, data: DocumentData): StudyGoal {
  const goal: StudyGoal = {
    id,
    uid: stringValue(data.uid),
    deckId: stringValue(data.deckId),
    deckVersion: numberValue(data.deckVersion, 1),
    active: data.active === true,
    targetCount: numberValue(data.targetCount, 0),
    startDate: stringValue(data.startDate),
    timezone: stringValue(data.timezone, "UTC"),
    assignments: numericArrayMap(data.assignments),
    createdAt: dateValue(data.createdAt),
    updatedAt: dateValue(data.updatedAt),
    revision: numberValue(data.revision, 1),
  };
  if (typeof data.endDate === "string") goal.endDate = data.endDate;
  if (typeof data.dailyTarget === "number") goal.dailyTarget = data.dailyTarget;
  if (data.lastResetAt !== undefined) goal.lastResetAt = dateValue(data.lastResetAt);
  return goal;
}

function serializeGoal(goal: StudyGoal): DocumentData {
  return {
    uid: goal.uid,
    deckId: goal.deckId,
    deckVersion: goal.deckVersion,
    active: goal.active,
    targetCount: goal.targetCount,
    startDate: goal.startDate,
    timezone: goal.timezone,
    assignments: goal.assignments,
    createdAt: Timestamp.fromDate(new Date(goal.createdAt)),
    updatedAt: Timestamp.fromDate(new Date(goal.updatedAt)),
    revision: goal.revision,
    ...(goal.endDate === undefined ? {} : { endDate: goal.endDate }),
    ...(goal.dailyTarget === undefined ? {} : { dailyTarget: goal.dailyTarget }),
    ...(goal.lastResetAt === undefined
      ? {}
      : { lastResetAt: Timestamp.fromDate(new Date(goal.lastResetAt)) }),
  };
}

function emptyProgress(
  uid: string,
  deckId: string,
  deckVersion: number,
  now: Date,
): DeckProgress {
  return {
    uid,
    deckId,
    deckVersion,
    cards: {},
    deliveredCardIds: [],
    recentBatches: {},
    revision: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function parseProgress(data: DocumentData): DeckProgress {
  return {
    uid: stringValue(data.uid),
    deckId: stringValue(data.deckId),
    deckVersion: numberValue(data.deckVersion, 1),
    cards:
      data.cards !== null && typeof data.cards === "object"
        ? (data.cards as DeckProgress["cards"])
        : {},
    deliveredCardIds: stringArray(data.deliveredCardIds),
    recentBatches:
      data.recentBatches !== null && typeof data.recentBatches === "object"
        ? (data.recentBatches as DeckProgress["recentBatches"])
        : {},
    revision: numberValue(data.revision, 0),
    createdAt: dateValue(data.createdAt),
    updatedAt: dateValue(data.updatedAt),
  };
}

function serializeProgress(progress: DeckProgress): DocumentData {
  return {
    uid: progress.uid,
    deckId: progress.deckId,
    deckVersion: progress.deckVersion,
    cards: progress.cards,
    deliveredCardIds: progress.deliveredCardIds,
    recentBatches: progress.recentBatches,
    revision: progress.revision,
    createdAt: Timestamp.fromDate(new Date(progress.createdAt)),
    updatedAt: Timestamp.fromDate(new Date(progress.updatedAt)),
  };
}

function parseWindow(id: string, data: DocumentData): DeliveryWindow {
  const window: DeliveryWindow = {
    id,
    uid: stringValue(data.uid),
    goalId: stringValue(data.goalId),
    deckId: stringValue(data.deckId),
    deckVersion: numberValue(data.deckVersion, 1),
    dateKey: stringValue(data.dateKey),
    quotaDateKey: stringValue(data.quotaDateKey),
    premium: data.premium === true,
    deviceHash: stringValue(data.deviceHash),
    cardIds: stringArray(data.cardIds),
    cardIndexes: numberArray(data.cardIndexes),
    issuedAt: dateValue(data.issuedAt),
    expiresAt: dateValue(data.expiresAt),
  };
  if (data.completedAt !== undefined) window.completedAt = dateValue(data.completedAt);
  if (typeof data.batchId === "string") window.batchId = data.batchId;
  return window;
}

function serializeWindow(window: DeliveryWindow): DocumentData {
  return {
    uid: window.uid,
    goalId: window.goalId,
    deckId: window.deckId,
    deckVersion: window.deckVersion,
    dateKey: window.dateKey,
    quotaDateKey: window.quotaDateKey,
    premium: window.premium,
    deviceHash: window.deviceHash,
    cardIds: window.cardIds,
    cardIndexes: window.cardIndexes,
    issuedAt: Timestamp.fromDate(new Date(window.issuedAt)),
    expiresAt: Timestamp.fromDate(new Date(window.expiresAt)),
  };
}

function serializeDeckRequest(request: DeckRequestRecord): DocumentData {
  return {
    uid: request.uid,
    topic: request.topic,
    category: request.category,
    language: request.language,
    status: request.status,
    priority: request.priority,
    createdAt: Timestamp.fromDate(new Date(request.createdAt)),
    updatedAt: Timestamp.fromDate(new Date(request.updatedAt)),
    ...(request.note === undefined ? {} : { note: request.note }),
  };
}

function trimBatchReceipts(
  receipts: Record<string, ProgressBatchReceipt>,
): Record<string, ProgressBatchReceipt> {
  return Object.fromEntries(
    Object.entries(receipts)
      .sort(([, left], [, right]) => right.submittedAt.localeCompare(left.submittedAt))
      .slice(0, 20),
  );
}

function mergeGoal(
  target: StudyGoal | null,
  source: StudyGoal,
  targetUid: string,
  now: Date,
): StudyGoal {
  if (target !== null) {
    assertBackend(
      target.deckVersion === source.deckVersion,
      "failed-precondition",
      `Goal ${source.id} has conflicting deck versions during account merge.`,
      { kind: "goal-version-conflict", goalId: source.id },
    );
  }
  const selected =
    target === null || source.updatedAt > target.updatedAt ? source : target;
  return {
    ...selected,
    uid: targetUid,
    createdAt:
      target === null || source.createdAt < target.createdAt
        ? source.createdAt
        : target.createdAt,
    updatedAt: now.toISOString(),
    revision: Math.max(target?.revision ?? 0, source.revision) + 1,
  };
}

function mergeDeckProgress(
  target: DeckProgress | null,
  source: DeckProgress,
  targetUid: string,
  now: Date,
): DeckProgress {
  if (target !== null) {
    assertBackend(
      target.deckVersion === source.deckVersion,
      "failed-precondition",
      `Progress ${source.deckId} has conflicting deck versions during account merge.`,
      { kind: "progress-version-conflict", deckId: source.deckId },
    );
  }
  const cards = { ...(target?.cards ?? {}) };
  for (const [cardId, sourceCard] of Object.entries(source.cards)) {
    const targetCard = cards[cardId];
    if (
      targetCard === undefined ||
      sourceCard.state.updatedAt > targetCard.state.updatedAt
    ) {
      cards[cardId] = sourceCard;
    }
  }
  return {
    uid: targetUid,
    deckId: source.deckId,
    deckVersion: source.deckVersion,
    cards,
    deliveredCardIds: mergeUnique(
      target?.deliveredCardIds ?? [],
      source.deliveredCardIds,
    ),
    recentBatches: trimBatchReceipts({
      ...(target?.recentBatches ?? {}),
      ...source.recentBatches,
    }),
    revision: Math.max(target?.revision ?? 0, source.revision) + 1,
    createdAt:
      target === null || source.createdAt < target.createdAt
        ? source.createdAt
        : target.createdAt,
    updatedAt: now.toISOString(),
  };
}

function selectEntitlementData(
  source: DocumentData | undefined,
  target: DocumentData | undefined,
  now: Date,
): DocumentData | null {
  if (source === undefined) return target ?? null;
  if (target === undefined) return source;
  const sourceEntitlement = parseEntitlement(source.entitlement ?? source);
  const targetEntitlement = parseEntitlement(target.entitlement ?? target);
  const sourceActive = isEntitled(sourceEntitlement, now);
  const targetActive = isEntitled(targetEntitlement, now);
  if (sourceActive !== targetActive) return sourceActive ? source : target;
  const sourceExpiry = entitlementExpiry(sourceEntitlement);
  const targetExpiry = entitlementExpiry(targetEntitlement);
  if (sourceExpiry !== targetExpiry) return sourceExpiry > targetExpiry ? source : target;
  return dateValue(source.updatedAt) > dateValue(target.updatedAt) ? source : target;
}

function entitlementExpiry(entitlement: Entitlement): number {
  return entitlement.validUntil === null
    ? Number.POSITIVE_INFINITY
    : Date.parse(entitlement.validUntil);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function dateValue(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
}

function timestampMilliseconds(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const result = Date.parse(value);
    return Number.isFinite(result) ? result : null;
  }
  return null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === "number")
    : [];
}

function numericArrayMap(value: unknown): Record<string, number[]> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entries]) => [
      key,
      numberArray(entries),
    ]),
  );
}

function mergeUnique(left: readonly string[], right: readonly string[]): string[] {
  return [...new Set([...left, ...right])];
}
