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
  LearningBackupEnvelope,
  LearningBackupSnapshot,
  ProgressBatchReceipt,
  StudyGoal,
} from "../domain/types.js";
import { decideDeckRequestCompletion } from "../domain/deck-request.js";
import { BackendError, assertBackend } from "../errors.js";
import type {
  CatalogFilter,
  AccountDeletionRepository,
  AccountDeletionSummary,
  AccountAccessRepository,
  AccountMergeCleanupRepository,
  AccountMergeResult,
  AccountMergeRepository,
  AppsInTossIdentityRepository,
  CatalogNotificationEventClaimInput,
  CatalogNotificationEventCompletionInput,
  CatalogNotificationEventRepository,
  CatalogRepository,
  CompleteDeckRequestWriteInput,
  DeckRequestCompletionResult,
  DeckRequestOperatorRepository,
  DeckRequestRepository,
  DeliveryReservationInput,
  EntitlementRepository,
  GoalRepository,
  GoalWriteInput,
  LearningBackupReconcileInput,
  NotificationInstallationWriteInput,
  NotificationOutboxClaimInput,
  NotificationOutboxCompletionInput,
  NotificationRepository,
  NotificationOutboxRetryInput,
  ProgressCommitInput,
  ProgressCommitResult,
  ReceiptEntitlementRepository,
  StudyRepository,
} from "./contracts.js";
import {
  MAX_RECENT_BACKUP_MUTATIONS,
  emptyLearningBackupEnvelope,
  mergeLearningBackupSnapshots,
} from "../domain/learning-backup.js";
import type {
  AuthorityObservationWindow,
  ReceiptPredecessor,
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
  StoreNotificationClaimLookup,
  StoreNotificationApplyResult,
  StoreNotificationRepository,
} from "../store-notifications/types.js";
import { convergeEntitlementCustomClaims } from "../store-notifications/custom-claims-projector.js";
import type {
  DeckReadyNotificationOutbox,
  NotificationDeliveryTarget,
  NotificationInstallationInvalidation,
  NotificationInstallationRecord,
} from "../notifications/types.js";
import { MAX_NOTIFICATION_INSTALLATIONS_PER_ACCOUNT } from "../notifications/policy.js";

const ACCOUNT_MERGE_CLEANUP_STATUSES = new Set([
  "pending",
  "claimed",
  "failed",
  "complete",
]);

export class FirestoreRepository
  implements
    AccountAccessRepository,
    AccountMergeRepository,
    AccountMergeCleanupRepository,
    AccountDeletionRepository,
    CatalogNotificationEventRepository,
    CatalogRepository,
    EntitlementRepository,
    GoalRepository,
    StudyRepository,
    DeckRequestRepository,
    DeckRequestOperatorRepository,
    NotificationRepository,
    ReceiptEntitlementRepository,
    AppsInTossIdentityRepository,
    StoreNotificationRepository
{
  constructor(private readonly db: Firestore, private readonly auth: Auth) {}

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
    const snapshot = await query
      .orderBy("publishedAt", "desc")
      .limit(100)
      .get();
    return snapshot.docs.map((doc) => parseDeck(doc.id, doc.data()));
  }

  async getDeck(deckId: string): Promise<DeckMetadata | null> {
    const snapshot = await this.db.collection("decks").doc(deckId).get();
    return snapshot.exists
      ? parseDeck(snapshot.id, snapshot.data() ?? {})
      : null;
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
    return snapshot.exists
      ? parseGoal(snapshot.id, snapshot.data() ?? {})
      : null;
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
      await this.assertTransactionAccountActive(transaction, input.uid);
      const [existingSnapshot, activeSnapshot] = await Promise.all([
        transaction.get(goalRef),
        input.maxActiveGoals === null
          ? Promise.resolve(null)
          : transaction.get(activeQuery),
      ]);
      const existing = existingSnapshot.exists
        ? parseGoal(existingSnapshot.id, existingSnapshot.data() ?? {})
        : null;

      if (existing !== null) {
        const cooldownBase = Date.parse(
          existing.lastResetAt ?? existing.createdAt
        );
        const retryAt = cooldownBase + input.resetCooldownMs;
        assertBackend(
          input.now.getTime() >= retryAt,
          "resource-exhausted",
          "This deck goal can only be reset once every 24 hours.",
          {
            retryAt: new Date(retryAt).toISOString(),
            kind: "goal-reset-cooldown",
          }
        );
      }

      if (activeSnapshot !== null && input.maxActiveGoals !== null) {
        const otherActiveGoals = activeSnapshot.docs.filter(
          (doc) => doc.id !== input.goal.id
        );
        assertBackend(
          otherActiveGoals.length < input.maxActiveGoals,
          "failed-precondition",
          `Free plans can have at most ${input.maxActiveGoals} active deck.`,
          { kind: "active-goal-limit", limit: input.maxActiveGoals }
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
      await this.assertTransactionAccountActive(transaction, uid);
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
    now: Date
  ): Promise<void> {
    if (pro) return;
    const ref = this.db
      .collection("users")
      .doc(uid)
      .collection("sync")
      .doc("devicePolicy");
    await this.db.runTransaction(async (transaction) => {
      await this.assertTransactionAccountActive(transaction, uid);
      const snapshot = await transaction.get(ref);
      const primaryDeviceHash = snapshot.data()?.primaryDeviceHash;
      assertBackend(
        primaryDeviceHash === undefined || primaryDeviceHash === deviceHash,
        "permission-denied",
        "Free cloud sync is bound to another primary device.",
        { kind: "primary-device-mismatch" }
      );
      transaction.set(
        ref,
        {
          primaryDeviceHash: deviceHash,
          boundAt: snapshot.data()?.boundAt ?? Timestamp.fromDate(now),
          lastSeenAt: Timestamp.fromDate(now),
        },
        { merge: true }
      );
    });
  }

  async getSyncState(uid: string) {
    const userRef = this.db.collection("users").doc(uid);
    const [goals, progress, learningBackup] = await Promise.all([
      userRef.collection("goals").get(),
      userRef.collection("deckProgress").get(),
      this.learningBackupRef(uid).get(),
    ]);
    return {
      goals: goals.docs.map((doc) => parseGoal(doc.id, doc.data())),
      progress: progress.docs.map((doc) => parseProgress(doc.data())),
      learningBackup: learningBackup.exists
        ? parseLearningBackupEnvelope(learningBackup.data())
        : emptyLearningBackupEnvelope(),
    };
  }

  async reconcileLearningBackup(
    input: LearningBackupReconcileInput
  ): Promise<LearningBackupEnvelope> {
    const ref = this.learningBackupRef(input.uid);
    return this.db.runTransaction(async (transaction) => {
      await this.assertTransactionAccountActive(transaction, input.uid);
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists
        ? parseLearningBackupEnvelope(snapshot.data())
        : emptyLearningBackupEnvelope();
      const recentMutationIds = snapshot.exists
        ? stringArray(snapshot.data()?.recentMutationIds)
        : [];
      assertBackend(
        input.baseRevision <= current.revision,
        "aborted",
        "Learning backup base revision is ahead of the server.",
        { kind: "learning-backup-future-revision" }
      );
      if (recentMutationIds.includes(input.mutationId)) {
        return current;
      }

      let merged = mergeLearningBackupSnapshots(
        current.snapshot,
        input.snapshot,
        input.baseRevision === current.revision
      );
      if (input.maxActiveFreeDecks !== null) {
        const maxActiveFreeDecks = input.maxActiveFreeDecks;
        const preferredActiveDeckId =
          input.snapshot.freeDecks.find((deck) => deck.active)?.deckId ??
          merged.freeDecks.find((deck) => deck.active)?.deckId;
        merged = {
          ...merged,
          freeDecks: merged.freeDecks.map((deck) => ({
            ...deck,
            active:
              maxActiveFreeDecks > 0 && deck.deckId === preferredActiveDeckId,
          })),
        };
      }

      const next: LearningBackupEnvelope = {
        revision: current.revision + 1,
        updatedAt: input.now.toISOString(),
        lastMutationId: input.mutationId,
        snapshot: merged,
      };
      transaction.set(ref, {
        revision: next.revision,
        updatedAt: Timestamp.fromDate(input.now),
        lastMutationId: input.mutationId,
        snapshot: serializeLearningBackupSnapshot(next.snapshot),
        recentMutationIds: [
          ...recentMutationIds.filter((id) => id !== input.mutationId),
          input.mutationId,
        ].slice(-MAX_RECENT_BACKUP_MUTATIONS),
      });
      return next;
    });
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
      { kind: "account-merged" }
    );
    assertBackend(
      !deletionSnapshot.exists,
      "failed-precondition",
      "This account is being deleted.",
      { kind: "account-deleting" }
    );
  }

  async getAccountMergeResult(
    sourceUid: string,
    targetUid: string
  ): Promise<AccountMergeResult | null> {
    const marker = await this.db.collection("accountMerges").doc(sourceUid).get();
    if (!marker.exists) return null;
    return parseAccountMergeResult(sourceUid, targetUid, marker.data() ?? {});
  }

  async listAccountMergeCleanupCandidates(input: {
    readonly cutoff: Date;
    readonly limit: number;
  }): Promise<readonly string[]> {
    assertBackend(
      Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= 100,
      "invalid-argument",
      "Account merge cleanup sweep limit is invalid."
    );
    const snapshot = await this.db
      .collection("accountMerges")
      .where("schemaVersion", "==", 2)
      .where("cleanupStatus", "in", ["pending", "failed", "claimed"])
      .where("cleanupUpdatedAt", "<=", Timestamp.fromDate(input.cutoff))
      .orderBy("cleanupUpdatedAt", "asc")
      .limit(input.limit)
      .get();
    return snapshot.docs.map((document) => document.id);
  }

  async claimAccountMergeCleanup(input: {
    readonly sourceUid: string;
    readonly leaseId: string;
    readonly now: Date;
    readonly leaseUntil: Date;
  }) {
    const ref = this.db.collection("accountMerges").doc(input.sourceUid);
    return this.db.runTransaction(async (transaction) => {
      const marker = await transaction.get(ref);
      if (!marker.exists) return null;
      const data = marker.data() ?? {};
      assertBackend(
        data.sourceUid === input.sourceUid &&
          typeof data.targetUid === "string" &&
          data.targetUid.length > 0 &&
          data.targetUid !== input.sourceUid &&
          data.billingBindingRetained === true &&
          timestampMilliseconds(data.mergedAt) !== null,
        "failed-precondition",
        "Account merge cleanup marker is invalid.",
        { kind: "account-merge-cleanup-corrupt" }
      );

      // 기존 동기식 cleanup marker에는 상태 필드가 없다. 새 trigger가 과거 marker를
      // 임의로 다시 처리하지 않도록 완료된 legacy marker로 취급한다.
      if (data.cleanupStatus === undefined) {
        return null;
      }
      assertBackend(
        data.schemaVersion === 2 &&
          ACCOUNT_MERGE_CLEANUP_STATUSES.has(data.cleanupStatus),
        "failed-precondition",
        "Account merge cleanup state is invalid.",
        { kind: "account-merge-cleanup-corrupt" }
      );
      if (data.cleanupStatus === "complete") return null;
      if (
        data.cleanupStatus === "claimed" &&
        (timestampMilliseconds(data.cleanupLeaseUntil) ?? 0) >
          input.now.getTime()
      ) {
        throw new BackendError(
          "aborted",
          "Account merge cleanup is already leased.",
          { kind: "account-merge-cleanup-lease-active" }
        );
      }
      const attemptCount = numberValue(data.cleanupAttemptCount, 0);
      assertBackend(
        Number.isSafeInteger(attemptCount) && attemptCount >= 0,
        "failed-precondition",
        "Account merge cleanup attempt state is invalid.",
        { kind: "account-merge-cleanup-corrupt" }
      );
      transaction.update(ref, {
        cleanupStatus: "claimed",
        cleanupAttemptCount: attemptCount + 1,
        cleanupLeaseId: input.leaseId,
        cleanupLeaseUntil: Timestamp.fromDate(input.leaseUntil),
        cleanupLastAttemptAt: Timestamp.fromDate(input.now),
        cleanupUpdatedAt: Timestamp.fromDate(input.now),
        cleanupLastErrorCode: FieldValue.delete(),
      });
      return {
        sourceUid: input.sourceUid,
        targetUid: data.targetUid,
      };
    });
  }

  async recordAccountMergeCleanupRetry(input: {
    readonly sourceUid: string;
    readonly leaseId: string;
    readonly failureCode: "target-claims" | "source-auth";
    readonly now: Date;
  }): Promise<void> {
    const ref = this.db.collection("accountMerges").doc(input.sourceUid);
    await this.db.runTransaction(async (transaction) => {
      const marker = await transaction.get(ref);
      if (
        !marker.exists ||
        marker.data()?.cleanupStatus !== "claimed" ||
        marker.data()?.cleanupLeaseId !== input.leaseId
      ) {
        return;
      }
      transaction.update(ref, {
        cleanupStatus: "failed",
        cleanupLastErrorCode: input.failureCode,
        cleanupUpdatedAt: Timestamp.fromDate(input.now),
        cleanupLeaseId: FieldValue.delete(),
        cleanupLeaseUntil: FieldValue.delete(),
      });
    });
  }

  async completeAccountMergeCleanup(input: {
    readonly sourceUid: string;
    readonly leaseId: string;
    readonly now: Date;
  }): Promise<void> {
    const ref = this.db.collection("accountMerges").doc(input.sourceUid);
    await this.db.runTransaction(async (transaction) => {
      const marker = await transaction.get(ref);
      if (
        !marker.exists ||
        marker.data()?.cleanupStatus !== "claimed" ||
        marker.data()?.cleanupLeaseId !== input.leaseId
      ) {
        return;
      }
      transaction.update(ref, {
        cleanupStatus: "complete",
        cleanupCompletedAt: Timestamp.fromDate(input.now),
        cleanupUpdatedAt: Timestamp.fromDate(input.now),
        cleanupLastErrorCode: FieldValue.delete(),
        cleanupLeaseId: FieldValue.delete(),
        cleanupLeaseUntil: FieldValue.delete(),
      });
    });
  }

  async syncMergedAccountEntitlementClaims(
    targetUid: string,
    now: Date
  ): Promise<void> {
    try {
      await this.syncEntitlementClaims(targetUid, now);
    } catch (error) {
      // target 탈퇴가 merge cleanup보다 먼저 완료된 경우 투영할 Auth user가 없다.
      if (firebaseAuthErrorCode(error) === "auth/user-not-found") return;
      throw error;
    }
  }

  async cleanupMergedSourceAuth(sourceUid: string): Promise<void> {
    try {
      await this.auth.revokeRefreshTokens(sourceUid);
    } catch (error) {
      if (firebaseAuthErrorCode(error) === "auth/user-not-found") return;
      throw error;
    }
    try {
      await this.auth.deleteUser(sourceUid);
    } catch (error) {
      if (firebaseAuthErrorCode(error) === "auth/user-not-found") return;
      throw error;
    }
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
        { kind: "account-merged" }
      );
      if (marker.exists) {
        transaction.set(
          markerRef,
          {
            status: marker.data()?.status ?? "pending",
            updatedAt: Timestamp.fromDate(now),
          },
          { merge: true }
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

  async purgeAccountData(
    uid: string,
    now: Date
  ): Promise<AccountDeletionSummary> {
    const markerRef = this.accountDeletionRef(uid);
    const marker = await markerRef.get();
    assertBackend(
      marker.exists,
      "failed-precondition",
      "Account deletion must be marked before data cleanup.",
      { kind: "account-deletion-marker-required" }
    );

    const mergeMarkers = await this.db
      .collection("accountMerges")
      .where("targetUid", "==", uid)
      .get();
    const ownedUids = [
      ...new Set([uid, ...mergeMarkers.docs.map((doc) => doc.id)]),
    ];
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
          this.db
            .collection("receiptClaims")
            .where("uid", "==", ownedUid)
            .get(),
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
          const barrierRef = this.authorityBarrierRef(claim.id);
          const [current] = await Promise.all([
            transaction.get(claim.ref),
            transaction.get(barrierRef),
          ]);
          assertBackend(
            current.exists && current.data()?.uid === ownedUid,
            "aborted",
            "Receipt claim ownership changed during account deletion.",
            { kind: "receipt-binding-conflict" }
          );
          transaction.update(claim.ref, {
            uid: FieldValue.delete(),
            platform: FieldValue.delete(),
            productId: FieldValue.delete(),
            originalTransactionId: FieldValue.delete(),
            predecessor: FieldValue.delete(),
            supersededBy: FieldValue.delete(),
            mergedFromUid: FieldValue.delete(),
            ownershipState: "account-deleted",
            bindingRetained: true,
            ownerDeletedAt: Timestamp.fromDate(now),
            updatedAt: Timestamp.fromDate(now),
          });
          // claim과 연결된 pending authority도 tombstone 전환과 같은 commit에서
          // 제거해 삭제 계정으로 notification이 다시 권한을 투영하지 못하게 한다.
          transaction.delete(barrierRef);
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
          .collection("notificationInstallations")
          .where("uid", "==", ownedUid),
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
    // 같은 atomic batch로 전환해 blocker가 없는 순간을 만들지 않는다. 비동기 merge cleanup이
    // 아직 끝나지 않았을 수 있으므로 source Auth 폐기도 marker 전환 전에 멱등 보장한다.
    for (const mergeMarker of mergeMarkers.docs) {
      const sourceUid = mergeMarker.id;
      await this.cleanupMergedSourceAuth(sourceUid);
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
      { merge: true }
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
  }): Promise<AccountMergeResult> {
    const sourceUser = this.db.collection("users").doc(input.sourceUid);
    const targetUser = this.db.collection("users").doc(input.targetUid);
    const sourceEntitlementRef = sourceUser
      .collection("entitlements")
      .doc("pro");
    const targetEntitlementRef = targetUser
      .collection("entitlements")
      .doc("pro");
    const sourcePolicyRef = sourceUser.collection("sync").doc("devicePolicy");
    const targetPolicyRef = targetUser.collection("sync").doc("devicePolicy");
    const sourceLearningBackupRef = sourceUser
      .collection("sync")
      .doc("learningBackup");
    const targetLearningBackupRef = targetUser
      .collection("sync")
      .doc("learningBackup");
    const sourceMarkerRef = this.db
      .collection("accountMerges")
      .doc(input.sourceUid);
    const targetMarkerRef = this.db
      .collection("accountMerges")
      .doc(input.targetUid);
    const sourceClaimsQuery = this.db
      .collection("receiptClaims")
      .where("uid", "==", input.sourceUid);
    const sourceDeckRequestsQuery = this.db
      .collection("deckRequests")
      .where("uid", "==", input.sourceUid);
    const sourceNotificationInstallationsQuery = this.db
      .collection("notificationInstallations")
      .where("uid", "==", input.sourceUid);
    const targetNotificationInstallationsQuery = this.db
      .collection("notificationInstallations")
      .where("uid", "==", input.targetUid);

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
        sourceLearningBackup,
        targetLearningBackup,
        sourceMarker,
        targetMarker,
        sourceClaims,
        sourceDeckRequests,
        sourceNotificationInstallations,
        targetNotificationInstallations,
      ] = await Promise.all([
        transaction.get(sourceUser.collection("goals")),
        transaction.get(targetUser.collection("goals")),
        transaction.get(sourceUser.collection("deckProgress")),
        transaction.get(targetUser.collection("deckProgress")),
        transaction.get(sourceEntitlementRef),
        transaction.get(targetEntitlementRef),
        transaction.get(sourcePolicyRef),
        transaction.get(targetPolicyRef),
        transaction.get(sourceLearningBackupRef),
        transaction.get(targetLearningBackupRef),
        transaction.get(sourceMarkerRef),
        transaction.get(targetMarkerRef),
        transaction.get(sourceClaimsQuery),
        transaction.get(sourceDeckRequestsQuery),
        transaction.get(sourceNotificationInstallationsQuery),
        transaction.get(targetNotificationInstallationsQuery),
      ]);
      assertBackend(
        !targetMarker.exists,
        "failed-precondition",
        "The target Firebase account was already merged.",
        { kind: "account-merge-conflict" }
      );
      if (sourceMarker.exists) {
        return parseAccountMergeResult(
          input.sourceUid,
          input.targetUid,
          sourceMarker.data() ?? {}
        );
      }

      const sourceEntitlementData = sourceEntitlement.data();
      const targetEntitlementData = targetEntitlement.data();
      const sourceFingerprint = stringOrUndefined(
        sourceEntitlementData?.receiptFingerprint
      );
      const targetFingerprint = stringOrUndefined(
        targetEntitlementData?.receiptFingerprint
      );
      const sourceEntitlementSource = stringOrUndefined(
        sourceEntitlementData?.source
      );
      if (
        sourceEntitlement.exists &&
        sourceEntitlementSource !== undefined &&
        ["google-play", "app-store", "apps-in-toss"].includes(
          sourceEntitlementSource
        )
      ) {
        assertBackend(
          sourceFingerprint !== undefined,
          "failed-precondition",
          "Source store entitlement has no authoritative receipt fingerprint.",
          { kind: "receipt-binding-conflict" }
        );
      }
      if (sourceEntitlement.exists && targetEntitlement.exists) {
        assertBackend(
          sourceFingerprint !== undefined &&
            sourceFingerprint === targetFingerprint,
          "failed-precondition",
          "Source and target accounts have conflicting store entitlements.",
          { kind: "entitlement-ownership-conflict" }
        );
      }
      if (sourceEntitlement.exists && sourceFingerprint !== undefined) {
        assertBackend(
          sourceClaims.docs.some((claim) => claim.id === sourceFingerprint),
          "failed-precondition",
          "Source entitlement is missing its authoritative receipt binding.",
          { kind: "receipt-binding-conflict" }
        );
      }
      for (const claim of sourceClaims.docs) {
        assertBackend(
          claim.data().uid === input.sourceUid,
          "failed-precondition",
          "Receipt claim ownership changed during account merge.",
          { kind: "receipt-binding-conflict" }
        );
      }

      const mergedEntitlementData = selectEntitlementData(
        sourceEntitlementData,
        targetEntitlementData,
        input.now
      );
      const mergedEntitlement =
        mergedEntitlementData === null
          ? null
          : parseEntitlement(
              mergedEntitlementData.entitlement ?? mergedEntitlementData
            );
      const pro =
        mergedEntitlement !== null && isEntitled(mergedEntitlement, input.now);

      const sourceLearning = sourceLearningBackup.exists
        ? parseLearningBackupEnvelope(sourceLearningBackup.data())
        : emptyLearningBackupEnvelope();
      const targetLearning = targetLearningBackup.exists
        ? parseLearningBackupEnvelope(targetLearningBackup.data())
        : emptyLearningBackupEnvelope();
      let mergedLearningSnapshot = mergeLearningBackupSnapshots(
        targetLearning.snapshot,
        sourceLearning.snapshot,
        false
      );
      if (!pro) {
        const preferredActiveDeckId =
          targetLearning.snapshot.freeDecks.find((deck) => deck.active)
            ?.deckId ??
          sourceLearning.snapshot.freeDecks.find((deck) => deck.active)?.deckId;
        mergedLearningSnapshot = {
          ...mergedLearningSnapshot,
          freeDecks: mergedLearningSnapshot.freeDecks.map((deck) => ({
            ...deck,
            active: deck.deckId === preferredActiveDeckId,
          })),
        };
      }
      const mergeLearningMutationId = `merge_${sha256(
        `${input.sourceUid}:${input.targetUid}`
      ).slice(0, 48)}`;
      const mergedLearning: LearningBackupEnvelope = {
        revision:
          Math.max(sourceLearning.revision, targetLearning.revision) + 1,
        updatedAt: input.now.toISOString(),
        lastMutationId: mergeLearningMutationId,
        snapshot: mergedLearningSnapshot,
      };

      const goals = new Map<string, StudyGoal>();
      for (const doc of targetGoals.docs)
        goals.set(doc.id, parseGoal(doc.id, doc.data()));
      for (const doc of sourceGoals.docs) {
        const source = parseGoal(doc.id, doc.data());
        goals.set(
          doc.id,
          mergeGoal(
            goals.get(doc.id) ?? null,
            source,
            input.targetUid,
            input.now
          )
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
            input.now
          )
        );
      }

      const retainedNotificationInstallationIds =
        newestNotificationInstallationIds(
          [
            ...sourceNotificationInstallations.docs,
            ...targetNotificationInstallations.docs,
          ],
          MAX_NOTIFICATION_INSTALLATIONS_PER_ACCOUNT
        );
      const droppedTargetNotificationInstallations =
        targetNotificationInstallations.docs.filter(
          (installation) =>
            !retainedNotificationInstallationIds.has(installation.id)
        );
      const notificationInstallationWriteCount =
        sourceNotificationInstallations.size +
        droppedTargetNotificationInstallations.length;

      const writeCount =
        goals.size +
        progress.size +
        sourceGoals.size +
        sourceProgress.size +
        sourceClaims.size +
        sourceDeckRequests.size +
        notificationInstallationWriteCount +
        (sourceLearningBackup.exists || targetLearningBackup.exists ? 1 : 0) +
        (sourceLearningBackup.exists ? 1 : 0) +
        8;
      assertBackend(
        writeCount <= 450,
        "resource-exhausted",
        "Account has too much state for one atomic merge.",
        { kind: "account-merge-size", writeCount }
      );

      for (const [id, goal] of goals) {
        transaction.set(
          targetUser.collection("goals").doc(id),
          serializeGoal(goal)
        );
      }
      for (const doc of sourceGoals.docs) transaction.delete(doc.ref);
      for (const [id, state] of progress) {
        transaction.set(
          targetUser.collection("deckProgress").doc(id),
          serializeProgress(state)
        );
      }
      for (const doc of sourceProgress.docs) transaction.delete(doc.ref);

      if (sourceLearningBackup.exists || targetLearningBackup.exists) {
        transaction.set(targetLearningBackupRef, {
          revision: mergedLearning.revision,
          updatedAt: Timestamp.fromDate(input.now),
          lastMutationId: mergeLearningMutationId,
          snapshot: serializeLearningBackupSnapshot(mergedLearning.snapshot),
          recentMutationIds: [mergeLearningMutationId],
        });
      }
      if (sourceLearningBackup.exists)
        transaction.delete(sourceLearningBackupRef);

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
      for (const installation of sourceNotificationInstallations.docs) {
        if (retainedNotificationInstallationIds.has(installation.id)) {
          transaction.update(installation.ref, {
            uid: input.targetUid,
            updatedAt: Timestamp.fromDate(input.now),
          });
        } else {
          transaction.delete(installation.ref);
        }
      }
      for (const installation of droppedTargetNotificationInstallations) {
        transaction.delete(installation.ref);
      }

      const sourcePrimary = stringOrUndefined(
        sourcePolicy.data()?.primaryDeviceHash
      );
      const targetPrimary = stringOrUndefined(
        targetPolicy.data()?.primaryDeviceHash
      );
      if (!pro) {
        assertBackend(
          (sourcePrimary === undefined || sourcePrimary === input.deviceHash) &&
            (targetPrimary === undefined || targetPrimary === input.deviceHash),
          "failed-precondition",
          "Free account device ownership conflicts during merge.",
          { kind: "primary-device-conflict" }
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
        schemaVersion: 2,
        sourceUid: input.sourceUid,
        targetUid: input.targetUid,
        mergedAt: Timestamp.fromDate(input.now),
        billingBindingRetained: true,
        goalCount: goals.size,
        progressDeckCount: progress.size,
        entitlementMoved:
          sourceEntitlement.exists && !targetEntitlement.exists,
        cleanupStatus: "pending",
        cleanupAttemptCount: 0,
        cleanupUpdatedAt: Timestamp.fromDate(input.now),
      });

      return {
        merged: true as const,
        goalCount: goals.size,
        progressDeckCount: progress.size,
        entitlementMoved: sourceEntitlement.exists && !targetEntitlement.exists,
      };
    });
    return result;
  }

  async reserveDelivery(
    input: DeliveryReservationInput
  ): Promise<DeliveryWindow> {
    const { window } = input;
    const windowRef = this.db.collection("deliveryLogs").doc(window.id);
    const progressRef = this.progressRef(window.uid, window.deckId);
    const userCounterRef = this.db
      .collection("deliveryCounters")
      .doc(
        `${window.premium ? "premium" : "free"}-user_${window.uid}_${
          window.quotaDateKey
        }`
      );
    const deviceCounterRef = window.premium
      ? this.db
          .collection("deliveryCounters")
          .doc(`premium-device_${window.deviceHash}_${window.quotaDateKey}`)
      : null;

    return this.db.runTransaction(async (transaction) => {
      await this.assertTransactionAccountActive(transaction, window.uid);
      const [existingWindow, progressSnapshot, userCounter, deviceCounter] =
        await Promise.all([
          transaction.get(windowRef),
          transaction.get(progressRef),
          transaction.get(userCounterRef),
          deviceCounterRef === null
            ? Promise.resolve(null)
            : transaction.get(deviceCounterRef),
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
          { kind: "free-daily-limit", limit: input.hardUserDailyLimit }
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
          }
        );
      }

      let nextDeviceKeys: string[] | null = null;
      if (
        deviceCounterRef !== null &&
        input.premiumDeviceDailySoftCap !== null
      ) {
        nextDeviceKeys = mergeUnique(
          stringArray(deviceCounter?.data()?.uniqueCardKeys),
          cardKeys
        );
        assertBackend(
          nextDeviceKeys.length <= input.premiumDeviceDailySoftCap,
          "resource-exhausted",
          "Premium delivery was temporarily throttled for unusual device activity.",
          {
            kind: "abuse-soft-cap",
            scope: "device",
            softCap: input.premiumDeviceDailySoftCap,
          }
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
          : emptyProgress(
              window.uid,
              window.deckId,
              window.deckVersion,
              issuedAt
            );
      const progress: DeckProgress = {
        ...existingProgress,
        deckVersion: window.deckVersion,
        deliveredCardIds: mergeUnique(
          existingProgress.deliveredCardIds,
          window.cardIds
        ),
        revision: existingProgress.revision + 1,
        updatedAt: window.issuedAt,
      };
      transaction.set(progressRef, serializeProgress(progress));
      transaction.create(windowRef, serializeWindow(window));
      return window;
    });
  }

  async getDeliveryWindow(
    uid: string,
    windowId: string
  ): Promise<DeliveryWindow | null> {
    const snapshot = await this.db
      .collection("deliveryLogs")
      .doc(windowId)
      .get();
    if (!snapshot.exists) return null;
    const window = parseWindow(snapshot.id, snapshot.data() ?? {});
    return window.uid === uid ? window : null;
  }

  async commitProgress(
    input: ProgressCommitInput
  ): Promise<ProgressCommitResult> {
    const windowRef = this.db.collection("deliveryLogs").doc(input.windowId);

    return this.db.runTransaction(async (transaction) => {
      await this.assertTransactionAccountActive(transaction, input.uid);
      const windowSnapshot = await transaction.get(windowRef);
      assertBackend(
        windowSnapshot.exists,
        "not-found",
        "Delivery window not found."
      );
      const window = parseWindow(
        windowSnapshot.id,
        windowSnapshot.data() ?? {}
      );
      assertBackend(
        window.uid === input.uid,
        "permission-denied",
        "Delivery window owner mismatch."
      );
      assertBackend(
        Date.parse(window.expiresAt) > input.now.getTime(),
        "failed-precondition",
        "Delivery window has expired."
      );
      assertBackend(
        window.batchId === undefined || window.batchId === input.batchId,
        "failed-precondition",
        "Delivery window was already submitted with another batch."
      );
      const allowedCards = new Set(window.cardIds);
      assertBackend(
        input.answers.every((answer) => allowedCards.has(answer.cardId)),
        "permission-denied",
        "Progress contains a card outside the delivery window."
      );

      const progressRef = this.progressRef(input.uid, window.deckId);
      const progressSnapshot = await transaction.get(progressRef);
      const current = progressSnapshot.exists
        ? parseProgress(progressSnapshot.data() ?? {})
        : emptyProgress(
            input.uid,
            window.deckId,
            window.deckVersion,
            input.now
          );
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
    dailyLimit: number
  ): Promise<DeckRequestRecord> {
    const dateKey = utcDateKey(new Date(request.createdAt));
    const requestRef = this.db.collection("deckRequests").doc();
    const counterRef = this.db
      .collection("deckRequestCounters")
      .doc(`${request.uid}_${dateKey}`);

    return this.db.runTransaction(async (transaction) => {
      await this.assertTransactionAccountActive(transaction, request.uid);
      const counter = await transaction.get(counterRef);
      const count = numberValue(counter.data()?.count, 0);
      assertBackend(
        count < dailyLimit,
        "resource-exhausted",
        `Deck requests are limited to ${dailyLimit} per day.`,
        { kind: "deck-request-rate-limit", limit: dailyLimit }
      );
      const result: DeckRequestRecord = { id: requestRef.id, ...request };
      transaction.create(requestRef, serializeDeckRequest(result));
      transaction.set(counterRef, {
        uid: request.uid,
        dateKey,
        count: count + 1,
        updatedAt: Timestamp.fromDate(new Date(request.createdAt)),
        expiresAt: Timestamp.fromDate(
          addHours(new Date(request.createdAt), 72)
        ),
      });
      return result;
    });
  }

  async completeDeckRequest(
    input: CompleteDeckRequestWriteInput
  ): Promise<DeckRequestCompletionResult> {
    const requestRef = this.db.collection("deckRequests").doc(input.requestId);

    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(requestRef);
      assertBackend(
        snapshot.exists,
        "not-found",
        "Deck request was not found.",
        { kind: "deck-request-not-found" }
      );
      const current = parseDeckRequestRecord(
        snapshot.id,
        snapshot.data() ?? {}
      );
      const decision = decideDeckRequestCompletion(
        current,
        input.readyDeckId,
        input.now
      );
      if (decision.idempotent) return decision;

      const deck = await transaction.get(
        this.db.collection("decks").doc(input.readyDeckId)
      );
      assertBackend(
        deck.exists && deck.data()?.status === "published",
        "failed-precondition",
        "Ready deck must exist and be published.",
        { kind: "ready-deck-unavailable" }
      );
      transaction.update(requestRef, {
        status: "ready",
        readyDeckId: decision.request.readyDeckId,
        readyRevision: decision.request.readyRevision,
        readyAt: Timestamp.fromDate(input.now),
        updatedAt: Timestamp.fromDate(input.now),
      });
      return decision;
    });
  }

  async claimCatalogNotificationEvent(
    input: CatalogNotificationEventClaimInput
  ): Promise<boolean> {
    const ref = this.db
      .collection("catalogNotificationEvents")
      .doc(input.eventId);
    return this.db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (!current.exists) {
        transaction.create(ref, {
          schemaVersion: 1,
          kind: "catalog-published",
          status: "claimed",
          attemptCount: 1,
          leaseId: input.leaseId,
          leaseUntil: Timestamp.fromDate(input.leaseUntil),
          createdAt: Timestamp.fromDate(input.now),
          updatedAt: Timestamp.fromDate(input.now),
          expiresAt: Timestamp.fromDate(input.expiresAt),
        });
        return true;
      }

      const data = current.data() ?? {};
      if (data.status === "delivered" || data.status === "dead-letter") {
        return false;
      }
      const attemptCount =
        typeof data.attemptCount === "number" &&
        Number.isSafeInteger(data.attemptCount) &&
        data.attemptCount >= 0
          ? data.attemptCount
          : input.maxAttempts;
      if (attemptCount >= input.maxAttempts) {
        transaction.update(ref, {
          status: "dead-letter",
          completedAt: Timestamp.fromDate(input.now),
          updatedAt: Timestamp.fromDate(input.now),
          leaseId: FieldValue.delete(),
          leaseUntil: FieldValue.delete(),
        });
        return false;
      }
      if (
        data.status === "claimed" &&
        (timestampMilliseconds(data.leaseUntil) ?? 0) > input.now.getTime()
      ) {
        throw new BackendError(
          "aborted",
          "Catalog notification delivery is already leased.",
          { kind: "catalog-notification-lease-active" }
        );
      }
      if (data.status !== "claimed" && data.status !== "failed") {
        transaction.update(ref, {
          status: "dead-letter",
          completedAt: Timestamp.fromDate(input.now),
          updatedAt: Timestamp.fromDate(input.now),
          leaseId: FieldValue.delete(),
          leaseUntil: FieldValue.delete(),
        });
        return false;
      }
      transaction.update(ref, {
        status: "claimed",
        attemptCount: attemptCount + 1,
        leaseId: input.leaseId,
        leaseUntil: Timestamp.fromDate(input.leaseUntil),
        completedAt: FieldValue.delete(),
        updatedAt: Timestamp.fromDate(input.now),
        expiresAt: Timestamp.fromDate(input.expiresAt),
      });
      return true;
    });
  }

  async completeCatalogNotificationEvent(
    input: CatalogNotificationEventCompletionInput
  ): Promise<void> {
    const ref = this.db
      .collection("catalogNotificationEvents")
      .doc(input.eventId);
    await this.db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (
        !current.exists ||
        current.data()?.status !== "claimed" ||
        current.data()?.leaseId !== input.leaseId
      ) {
        return;
      }
      transaction.update(ref, {
        status: input.status,
        completedAt: Timestamp.fromDate(input.now),
        updatedAt: Timestamp.fromDate(input.now),
        leaseId: FieldValue.delete(),
        leaseUntil: FieldValue.delete(),
      });
    });
  }

  async upsertNotificationInstallation(
    input: NotificationInstallationWriteInput
  ): Promise<void> {
    const installation = input.installation;
    const ref = this.db
      .collection("notificationInstallations")
      .doc(installation.installationHash);
    const ownedQuery = this.db
      .collection("notificationInstallations")
      .where("uid", "==", installation.uid)
      .limit(input.maxInstallationsPerAccount + 1);

    await this.db.runTransaction(async (transaction) => {
      await this.assertTransactionAccountActive(transaction, installation.uid);
      const [current, owned] = await Promise.all([
        transaction.get(ref),
        transaction.get(ownedQuery),
      ]);
      const otherOwnedCount = owned.docs.filter(
        (document) => document.id !== installation.installationHash
      ).length;
      assertBackend(
        otherOwnedCount < input.maxInstallationsPerAccount,
        "resource-exhausted",
        "This account has too many notification installations.",
        {
          kind: "notification-installation-limit",
          limit: input.maxInstallationsPerAccount,
        }
      );

      const currentData = current.data();
      const sameOwner = currentData?.uid === installation.uid;
      const sameToken =
        sameOwner && currentData?.fcmTokenHash === installation.fcmTokenHash;
      transaction.set(ref, {
        schemaVersion: 1,
        appId: installation.appId,
        uid: installation.uid,
        fcmToken: installation.fcmToken,
        fcmTokenHash: installation.fcmTokenHash,
        platform: installation.platform,
        deckReadyEnabled: true,
        locale: installation.locale,
        appVersion: installation.appVersion,
        buildNumber: installation.buildNumber,
        createdAt:
          sameOwner && currentData?.createdAt !== undefined
            ? currentData.createdAt
            : Timestamp.fromDate(new Date(installation.createdAt)),
        tokenUpdatedAt:
          sameToken && currentData?.tokenUpdatedAt !== undefined
            ? currentData.tokenUpdatedAt
            : Timestamp.fromDate(new Date(installation.tokenUpdatedAt)),
        lastSeenAt: Timestamp.fromDate(new Date(installation.lastSeenAt)),
        updatedAt: Timestamp.fromDate(new Date(installation.updatedAt)),
        expiresAt: Timestamp.fromDate(new Date(installation.expiresAt)),
      });
    });
  }

  async unregisterNotificationInstallation(
    uid: string,
    installationHash: string
  ): Promise<void> {
    const ref = this.db
      .collection("notificationInstallations")
      .doc(installationHash);
    await this.db.runTransaction(async (transaction) => {
      await this.assertTransactionAccountActive(transaction, uid);
      const snapshot = await transaction.get(ref);
      if (snapshot.exists && snapshot.data()?.uid === uid) {
        transaction.delete(ref);
      }
    });
  }

  async listDeckReadyNotificationInstallations(
    uid: string,
    now: Date
  ): Promise<NotificationDeliveryTarget[]> {
    const snapshot = await this.db
      .collection("notificationInstallations")
      .where("appId", "==", "daoewo")
      .where("uid", "==", uid)
      .where("deckReadyEnabled", "==", true)
      .where("expiresAt", ">", Timestamp.fromDate(now))
      .limit(100)
      .get();
    return snapshot.docs.flatMap((document) => {
      const data = document.data();
      const fcmToken = stringOrUndefined(data.fcmToken);
      const platform = data.platform;
      if (
        data.schemaVersion !== 1 ||
        fcmToken === undefined ||
        (platform !== "android" && platform !== "ios")
      ) {
        return [];
      }
      return [
        {
          installationHash: document.id,
          fcmToken,
          platform,
          locale: stringValue(data.locale, "ko-KR"),
        },
      ];
    });
  }

  async listCatalogNotificationInstallations(
    now: Date
  ): Promise<NotificationDeliveryTarget[]> {
    const snapshot = await this.db
      .collection("notificationInstallations")
      .where("appId", "==", "daoewo")
      .where("deckReadyEnabled", "==", true)
      .where("expiresAt", ">", Timestamp.fromDate(now))
      .get();
    return snapshot.docs.flatMap((document) => {
      const data = document.data();
      const fcmToken = stringOrUndefined(data.fcmToken);
      const platform = data.platform;
      if (
        data.schemaVersion !== 1 ||
        fcmToken === undefined ||
        (platform !== "android" && platform !== "ios")
      ) {
        return [];
      }
      return [
        {
          installationHash: document.id,
          fcmToken,
          platform,
          locale: stringValue(data.locale, "ko-KR"),
        },
      ];
    });
  }

  async deleteNotificationInstallations(
    uid: string,
    invalidations: readonly NotificationInstallationInvalidation[]
  ): Promise<void> {
    const uniqueInvalidations = [
      ...new Map(
        invalidations.map((invalidation) => [
          invalidation.installationHash,
          invalidation,
        ])
      ).values(),
    ];
    if (uniqueInvalidations.length === 0) return;
    const refs = uniqueInvalidations.map((invalidation) =>
      this.db
        .collection("notificationInstallations")
        .doc(invalidation.installationHash)
    );
    await this.db.runTransaction(async (transaction) => {
      const snapshots = await Promise.all(
        refs.map((ref) => transaction.get(ref))
      );
      snapshots.forEach((snapshot, index) => {
        const invalidation = uniqueInvalidations[index];
        if (
          invalidation !== undefined &&
          snapshot.exists &&
          snapshot.data()?.uid === uid &&
          snapshot.data()?.fcmTokenHash === invalidation.fcmTokenHash
        ) {
          transaction.delete(snapshot.ref);
        }
      });
    });
  }

  async deleteCatalogNotificationInstallations(
    invalidations: readonly NotificationInstallationInvalidation[]
  ): Promise<void> {
    const uniqueInvalidations = [
      ...new Map(
        invalidations.map((invalidation) => [
          invalidation.installationHash,
          invalidation,
        ])
      ).values(),
    ];
    for (let start = 0; start < uniqueInvalidations.length; start += 500) {
      const chunk = uniqueInvalidations.slice(start, start + 500);
      await this.db.runTransaction(async (transaction) => {
        const refs = chunk.map((invalidation) =>
          this.db
            .collection("notificationInstallations")
            .doc(invalidation.installationHash)
        );
        const snapshots = await Promise.all(
          refs.map((ref) => transaction.get(ref))
        );
        snapshots.forEach((snapshot, index) => {
          const invalidation = chunk[index];
          if (
            invalidation !== undefined &&
            snapshot.exists &&
            snapshot.data()?.fcmTokenHash === invalidation.fcmTokenHash
          ) {
            transaction.delete(snapshot.ref);
          }
        });
      });
    }
  }

  async createDeckReadyNotificationOutbox(
    outbox: DeckReadyNotificationOutbox
  ): Promise<boolean> {
    const ref = this.db.collection("notificationOutbox").doc(outbox.id);
    return this.db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (current.exists) return false;
      transaction.create(ref, serializeNotificationOutbox(outbox));
      return true;
    });
  }

  async recordNotificationOutboxAttempt(
    input: NotificationOutboxClaimInput
  ): Promise<DeckReadyNotificationOutbox | null> {
    const ref = this.db.collection("notificationOutbox").doc(input.eventId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const current = parseNotificationOutbox(snapshot.id, snapshot.data());
      if (current.status !== "pending") return current;
      if (
        current.leaseUntil !== undefined &&
        Date.parse(current.leaseUntil) > input.now.getTime()
      ) {
        throw new BackendError(
          "aborted",
          "Notification outbox delivery is already leased.",
          { kind: "notification-outbox-lease-active" }
        );
      }
      const next: DeckReadyNotificationOutbox = {
        ...current,
        attemptCount: current.attemptCount + 1,
        lastAttemptAt: input.now.toISOString(),
        leaseId: input.leaseId,
        leaseUntil: input.leaseUntil.toISOString(),
        updatedAt: input.now.toISOString(),
      };
      transaction.update(ref, {
        attemptCount: next.attemptCount,
        lastAttemptAt: Timestamp.fromDate(input.now),
        leaseId: input.leaseId,
        leaseUntil: Timestamp.fromDate(input.leaseUntil),
        updatedAt: Timestamp.fromDate(input.now),
        lastErrorCode: FieldValue.delete(),
      });
      return next;
    });
  }

  async recordNotificationOutboxRetry(
    input: NotificationOutboxRetryInput
  ): Promise<void> {
    const ref = this.db.collection("notificationOutbox").doc(input.eventId);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (
        !snapshot.exists ||
        snapshot.data()?.status !== "pending" ||
        snapshot.data()?.leaseId !== input.leaseId
      ) {
        return;
      }
      transaction.update(ref, {
        lastErrorCode: "messaging-transient",
        leaseId: FieldValue.delete(),
        leaseUntil: FieldValue.delete(),
        updatedAt: Timestamp.fromDate(input.now),
      });
    });
  }

  async completeNotificationOutbox(
    input: NotificationOutboxCompletionInput
  ): Promise<void> {
    const ref = this.db.collection("notificationOutbox").doc(input.eventId);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (
        !snapshot.exists ||
        snapshot.data()?.status !== "pending" ||
        snapshot.data()?.leaseId !== input.leaseId
      ) {
        return;
      }
      transaction.update(ref, {
        status: input.status,
        completionReason: input.reason,
        deliveredCount: input.deliveredCount,
        invalidatedCount: input.invalidatedCount,
        permanentFailureCount: input.permanentFailureCount,
        completedAt: Timestamp.fromDate(input.now),
        updatedAt: Timestamp.fromDate(input.now),
        expiresAt: Timestamp.fromDate(input.expiresAt),
        lastErrorCode: FieldValue.delete(),
        leaseId: FieldValue.delete(),
        leaseUntil: FieldValue.delete(),
      });
    });
  }

  async resolveDeckReadyNotificationTarget(
    requestId: string,
    requestRevision: number
  ) {
    const snapshot = await this.db
      .collection("deckRequests")
      .doc(requestId)
      .get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() ?? {};
    const uid = stringOrUndefined(data.uid);
    const readyDeckId = stringOrUndefined(data.readyDeckId);
    return data.status === "ready" &&
      data.readyRevision === requestRevision &&
      uid !== undefined &&
      readyDeckId !== undefined
      ? { uid, readyDeckId }
      : null;
  }

  async applyVerifiedReceipt(
    uid: string,
    receipt: VerifiedStoreReceipt,
    receiptFingerprint: string,
    authorityObservation: AuthorityObservationWindow,
    now: Date
  ): Promise<{ entitlement: Entitlement; authorityPending: boolean }> {
    const predecessor = receipt.predecessor;
    if (predecessor !== undefined) {
      assertLinkedReceiptIdentity(
        receipt.platform,
        receipt.originalTransactionId,
        receiptFingerprint,
        predecessor
      );
    }
    const claimRef = this.db
      .collection("receiptClaims")
      .doc(receiptFingerprint);
    const barrierRef = this.authorityBarrierRef(receiptFingerprint);
    const predecessorClaimRef =
      predecessor === undefined
        ? null
        : this.db
            .collection("receiptClaims")
            .doc(predecessor.receiptFingerprint);
    const predecessorBarrierRef =
      predecessor === undefined
        ? null
        : this.authorityBarrierRef(predecessor.receiptFingerprint);
    const entitlementRef = this.db
      .collection("users")
      .doc(uid)
      .collection("entitlements")
      .doc("pro");

    const applied = await this.db.runTransaction(async (transaction) => {
      const [
        claim,
        currentEntitlement,
        barrier,
        predecessorClaim,
        predecessorBarrier,
      ] = await Promise.all([
        transaction.get(claimRef),
        transaction.get(entitlementRef),
        transaction.get(barrierRef),
        predecessorClaimRef === null
          ? Promise.resolve(null)
          : transaction.get(predecessorClaimRef),
        predecessorBarrierRef === null
          ? Promise.resolve(null)
          : transaction.get(predecessorBarrierRef),
        this.assertTransactionAccountActive(transaction, uid),
      ]);
      if (claim.exists) {
        const storedPredecessor = parseReceiptPredecessor(
          claim.data()?.predecessor
        );
        assertBackend(
          claim.data()?.uid === uid &&
            claim.data()?.ownershipState !== "account-deleted" &&
            claim.data()?.ownershipState !== "superseded" &&
            claim.data()?.platform === receipt.platform &&
            claim.data()?.originalTransactionId ===
              receipt.originalTransactionId &&
            sameReceiptPredecessor(storedPredecessor, predecessor),
          "permission-denied",
          "This store purchase is already bound to another account.",
          { kind: "receipt-binding-conflict" }
        );
      }
      if (barrier.exists) {
        assertPendingAuthorityBarrier(barrier.data(), receipt.platform);
      }

      if (
        predecessor !== undefined &&
        predecessorClaim !== null &&
        predecessorBarrier !== null
      ) {
        const predecessorResolution = parseStoreReceiptClaim(
          predecessor.receiptFingerprint,
          predecessorClaim.exists,
          predecessorClaim.data()
        );
        let predecessorOwnerUid = uid;
        if (predecessorResolution.kind === "account-deleted") {
          assertBackend(
            false,
            "permission-denied",
            "The replaced Google Play purchase belongs to a deleted account.",
            { kind: "google-play-linked-purchase-owner-conflict" }
          );
        } else if (predecessorResolution.kind === "claimed") {
          assertBackend(
            predecessorResolution.platform === "google-play" &&
              predecessorResolution.originalTransactionId ===
                predecessor.originalTransactionId,
            "failed-precondition",
            "Google Play predecessor claim does not match the replacement chain.",
            { kind: "google-play-linked-purchase-conflict" }
          );
          predecessorOwnerUid = predecessorResolution.uid;
        } else if (predecessorResolution.kind === "superseded") {
          const priorSuccessor = parseReceiptPredecessor(
            predecessorClaim.data()?.supersededBy
          );
          assertBackend(
            priorSuccessor !== undefined &&
              priorSuccessor.originalTransactionId ===
                receipt.originalTransactionId &&
              priorSuccessor.receiptFingerprint === receiptFingerprint &&
              typeof predecessorClaim.data()?.uid === "string",
            "failed-precondition",
            "Google Play predecessor was already superseded by another purchase.",
            { kind: "google-play-linked-purchase-conflict" }
          );
          predecessorOwnerUid = predecessorClaim.data()?.uid as string;
        }

        if (predecessorOwnerUid !== uid) {
          const [merge, predecessorDeletion] = await Promise.all([
            transaction.get(
              this.db.collection("accountMerges").doc(predecessorOwnerUid)
            ),
            transaction.get(this.accountDeletionRef(predecessorOwnerUid)),
          ]);
          assertBackend(
            !predecessorDeletion.exists &&
              merge.data()?.sourceUid === predecessorOwnerUid &&
              merge.data()?.targetUid === uid &&
              merge.data()?.billingBindingRetained === true,
            "permission-denied",
            "The replaced Google Play purchase is bound to another account.",
            { kind: "google-play-linked-purchase-owner-conflict" }
          );
        }
        if (predecessorBarrier.exists) {
          assertPendingAuthorityBarrier(
            predecessorBarrier.data(),
            "google-play"
          );
        }
      }

      const currentProjection = currentEntitlementProjection(
        currentEntitlement.data()
      );
      if (predecessor !== undefined && currentProjection !== null) {
        assertBackend(
          currentProjection.receiptFingerprint === receiptFingerprint ||
            currentProjection.receiptFingerprint ===
              predecessor.receiptFingerprint,
          "failed-precondition",
          "Current entitlement does not belong to the Google Play replacement chain.",
          { kind: "google-play-linked-purchase-conflict" }
        );
      }
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
        "Store verification returned an invalid authority observation."
      );

      if (!barrier.exists) {
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
          { kind: "stale-receipt-verification" }
        );
      }

      if (
        predecessor !== undefined &&
        predecessorClaim !== null &&
        predecessorClaimRef !== null &&
        predecessorBarrierRef !== null
      ) {
        transaction.set(predecessorClaimRef, {
          uid,
          platform: "google-play",
          originalTransactionId: predecessor.originalTransactionId,
          ownershipState: "superseded",
          bindingRetained: true,
          supersededBy: {
            originalTransactionId: receipt.originalTransactionId,
            receiptFingerprint,
          },
          supersededAt:
            predecessorClaim.data()?.supersededAt ?? Timestamp.fromDate(now),
          updatedAt: Timestamp.fromDate(now),
        });
        transaction.delete(predecessorBarrierRef);
      }
      transaction.set(claimRef, {
        uid,
        platform: receipt.platform,
        productId: receipt.productId,
        originalTransactionId: receipt.originalTransactionId,
        ...(predecessor === undefined ? {} : { predecessor }),
        claimedAt: claim.data()?.claimedAt ?? Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      });

      if (barrier.exists) {
        const belongsToAnotherReceipt =
          currentProjection?.receiptFingerprint !== undefined &&
          currentProjection.receiptFingerprint !== receiptFingerprint &&
          currentProjection.receiptFingerprint !==
            predecessor?.receiptFingerprint;
        const heldEntitlement: Entitlement = belongsToAnotherReceipt
          ? currentProjection.entitlement
          : {
              plan: "free",
              source: receipt.platform,
              validUntil: null,
            };
        if (!belongsToAnotherReceipt) {
          // Barrier는 authoritative notification query가 끝나기 전까지 영구
          // 유지한다. 이 projection에는 direct active observation을 기록하지
          // 않아 후속 inactive/active store 상태가 모두 적용될 수 있게 한다.
          transaction.set(entitlementRef, {
            entitlement: heldEntitlement,
            source: receipt.platform,
            productId: receipt.productId,
            receiptFingerprint,
            environment: receipt.environment,
            authorityPending: true,
            authorityPendingSince:
              barrier.data()?.firstObservedAt ?? Timestamp.fromDate(now),
            verifiedAt: Timestamp.fromDate(now),
            updatedAt: Timestamp.fromDate(now),
          });
        }
        return { entitlement: heldEntitlement, authorityPending: true };
      }
      transaction.set(entitlementRef, {
        entitlement: receipt.entitlement,
        source: receipt.platform,
        productId: receipt.productId,
        originalTransactionId: receipt.originalTransactionId,
        receiptFingerprint,
        ...(predecessor === undefined ? {} : { predecessor }),
        environment: receipt.environment,
        authorityObservationStartedAt: Timestamp.fromDate(
          new Date(authorityObservation.startedAt)
        ),
        authorityObservedAt: Timestamp.fromDate(
          new Date(authorityObservation.observedAt)
        ),
        authorityObservationId: `direct:${receiptFingerprint}`,
        directVerificationStartedAt: Timestamp.fromDate(
          new Date(authorityObservation.startedAt)
        ),
        authorityCommittedAt: Timestamp.fromDate(now),
        verifiedAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      });
      return { entitlement: receipt.entitlement, authorityPending: false };
    });

    await this.syncEntitlementClaims(uid, now);
    return applied;
  }

  async resolveReceiptClaim(
    fingerprint: string
  ): Promise<ReceiptClaimResolution> {
    const claim = await this.db
      .collection("receiptClaims")
      .doc(fingerprint)
      .get();
    const resolution = parseStoreReceiptClaim(
      fingerprint,
      claim.exists,
      claim.data()
    );
    if (resolution.kind !== "claimed") return resolution;
    const deletion = await this.accountDeletionRef(resolution.uid).get();
    return deletion.exists
      ? { kind: "account-deleted", fingerprint }
      : resolution;
  }

  async resolveReceiptClaimForNotification(
    input: StoreNotificationClaimLookup
  ): Promise<ReceiptClaimResolution> {
    assertBackend(
      /^[a-f0-9]{64}$/.test(input.fingerprint) &&
        Number.isFinite(input.now.getTime()),
      "internal",
      "Store notification fingerprint or observation time is invalid."
    );
    const claimRef = this.db.collection("receiptClaims").doc(input.fingerprint);
    const barrierRef = this.authorityBarrierRef(input.fingerprint);

    return this.db.runTransaction(async (transaction) => {
      const claimSnapshot = await transaction.get(claimRef);
      const claim = parseStoreReceiptClaim(
        input.fingerprint,
        claimSnapshot.exists,
        claimSnapshot.data()
      );
      if (claim.kind === "missing") {
        const barrier = await transaction.get(barrierRef);
        if (barrier.exists) {
          assertPendingAuthorityBarrier(barrier.data(), input.platform);
        }
        const observedAt = Timestamp.fromDate(input.now);
        transaction.set(barrierRef, {
          state: "pending",
          platform: input.platform,
          firstObservedAt: barrier.data()?.firstObservedAt ?? observedAt,
          lastObservedAt: observedAt,
          observationCount: Math.min(
            numberValue(barrier.data()?.observationCount, 0) + 1,
            1_000_000_000
          ),
          updatedAt: observedAt,
        });
        return claim;
      }
      if (claim.kind !== "claimed") return claim;
      const deletion = await transaction.get(
        this.accountDeletionRef(claim.uid)
      );
      return deletion.exists
        ? { kind: "account-deleted", fingerprint: input.fingerprint }
        : claim;
    });
  }

  async applyAuthoritativeSubscriptionState(input: {
    notification: import("../store-notifications/types.js").VerifiedStoreSubscriptionNotification;
    expectedClaim: Extract<ReceiptClaimResolution, { kind: "claimed" }>;
    state: import("../store-notifications/types.js").AuthoritativeSubscriptionState;
    now: Date;
  }): Promise<StoreNotificationApplyResult> {
    const fingerprint = input.notification.receiptFingerprint;
    const claimRef = this.db.collection("receiptClaims").doc(fingerprint);
    const barrierRef = this.authorityBarrierRef(fingerprint);
    const eventRef = this.db
      .collection("subscriptionEvents")
      .doc(
        sha256(
          `${input.notification.platform}:${input.notification.cursor.eventId}`
        )
      );

    const result = await this.db.runTransaction(async (transaction) => {
      const [claimSnapshot, priorEvent, barrier] = await Promise.all([
        transaction.get(claimRef),
        transaction.get(eventRef),
        transaction.get(barrierRef),
      ]);
      const claim = parseStoreReceiptClaim(
        fingerprint,
        claimSnapshot.exists,
        claimSnapshot.data()
      );
      if (claim.kind !== "claimed") {
        return { outcome: claim.kind, uid: null } as const;
      }
      assertBackend(
        claim.uid === input.expectedClaim.uid &&
          claim.platform === input.expectedClaim.platform &&
          claim.productId === input.expectedClaim.productId &&
          claim.originalTransactionId ===
            input.expectedClaim.originalTransactionId &&
          sameReceiptPredecessor(
            claim.predecessor,
            input.expectedClaim.predecessor
          ) &&
          claim.platform === input.notification.platform &&
          (claim.productId === input.state.productId ||
            (claim.platform === "app-store" &&
              input.notification.platform === "app-store")) &&
          claim.originalTransactionId === input.state.originalTransactionId &&
          sameReceiptPredecessor(claim.predecessor, input.state.predecessor),
        "aborted",
        "Receipt claim ownership changed while processing a store notification.",
        { kind: "receipt-binding-conflict" }
      );
      if (barrier.exists) {
        assertPendingAuthorityBarrier(
          barrier.data(),
          input.notification.platform
        );
      }

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
          currentSnapshot.exists &&
            currentSnapshot.data()?.authorityPending !== true,
          "internal",
          "Store notification exists without a settled entitlement projection."
        );
        if (barrier.exists) transaction.delete(barrierRef);
        return {
          outcome: "idempotent",
          uid: claim.uid,
          entitlement: parseEntitlement(
            currentSnapshot.data()?.entitlement ?? currentSnapshot.data()
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
        occurredAt: Timestamp.fromDate(
          new Date(input.notification.cursor.occurredAt)
        ),
        receivedAt: Timestamp.fromDate(input.now),
        uid: claim.uid,
        productId: input.state.productId,
        receiptFingerprint: fingerprint,
        ...(input.state.predecessor === undefined
          ? {}
          : { predecessor: input.state.predecessor }),
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
        ...(input.notification.platform === "google-play" &&
        input.notification.voidedOrderFingerprint !== undefined
          ? {
              voidedOrderFingerprint: input.notification.voidedOrderFingerprint,
            }
          : {}),
      };
      transaction.create(eventRef, eventData);
      // Store current-state query를 완료하고 event 결정을 durable 기록하는 commit과
      // 같은 transaction에서만 barrier를 해제한다.
      if (barrier.exists) transaction.delete(barrierRef);

      if (decision !== "apply") {
        assertBackend(
          current !== null,
          "internal",
          "A store notification was skipped without a current entitlement."
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
          new Date(input.notification.cursor.occurredAt)
        ),
        storeEventId: input.notification.cursor.eventId,
        authorityObservationStartedAt: Timestamp.fromDate(
          new Date(input.state.authorityObservation.startedAt)
        ),
        authorityObservedAt: Timestamp.fromDate(
          new Date(input.state.authorityObservation.observedAt)
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
    now: Date
  ): Promise<{
    uid: string;
    entitlement: Entitlement;
    applied: boolean;
    idempotent: boolean;
  }> {
    const claimRef = this.db
      .collection("receiptClaims")
      .doc(receiptFingerprint);
    const eventRef = this.db
      .collection("subscriptionEvents")
      .doc(event.eventId);

    const result = await this.db.runTransaction(async (transaction) => {
      const claim = await transaction.get(claimRef);
      assertBackend(
        claim.exists && typeof claim.data()?.uid === "string",
        "failed-precondition",
        "AppsInToss subscription is not bound to a verified account."
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
        this.assertTransactionAccountActive(transaction, uid),
      ]);
      if (priorEvent.exists) {
        assertBackend(
          currentEntitlementSnapshot.exists,
          "internal",
          "Subscription event exists without an entitlement record."
        );
        return {
          uid,
          entitlement: parseEntitlement(
            currentEntitlementSnapshot.data()?.entitlement ??
              currentEntitlementSnapshot.data()
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
          entitlement: parseEntitlement(currentData.entitlement ?? currentData),
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
    now: Date
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
        "AppsInToss authorizationCode was already consumed."
      );
      const count = numberValue(counter.data()?.count, 0);
      assertBackend(
        count < hourlyLimit,
        "resource-exhausted",
        "AppsInToss login exchange was temporarily rate limited.",
        { kind: "toss-auth-rate-limit", limit: hourlyLimit }
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
    now: Date
  ): Promise<void> {
    const hourKey = now.toISOString().slice(0, 13).replace(/[-T:]/g, "");
    const userRef = this.db
      .collection("tossAppCheckRefreshCounters")
      .doc(`user_${sha256(uid)}_${hourKey}`);
    const requesterRef = this.db
      .collection("tossAppCheckRefreshCounters")
      .doc(`requester_${requesterHash}_${hourKey}`);
    await this.db.runTransaction(async (transaction) => {
      await this.assertTransactionAccountActive(transaction, uid);
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
        { kind: "toss-app-check-refresh-rate-limit", limit: hourlyLimit }
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
            ])
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

  private authorityBarrierRef(fingerprint: string) {
    return this.db.collection("receiptAuthorityBarriers").doc(fingerprint);
  }

  private async assertTransactionAccountActive(
    transaction: Transaction,
    uid: string
  ): Promise<void> {
    const [deletion, merge] = await Promise.all([
      transaction.get(this.accountDeletionRef(uid)),
      transaction.get(this.db.collection("accountMerges").doc(uid)),
    ]);
    assertBackend(
      !deletion.exists,
      "failed-precondition",
      "This account is being deleted.",
      { kind: "account-deleting" }
    );
    assertBackend(
      !merge.exists,
      "failed-precondition",
      "This account was merged into another Firebase account.",
      { kind: "account-merged" }
    );
  }

  private async assertTransactionAccountNotDeleting(
    transaction: Transaction,
    uid: string
  ): Promise<void> {
    const marker = await transaction.get(this.accountDeletionRef(uid));
    assertBackend(
      !marker.exists,
      "failed-precondition",
      "This account is being deleted.",
      { kind: "account-deleting" }
    );
  }

  private async deleteQueryDocuments(
    query: Query<DocumentData>
  ): Promise<number> {
    const snapshot = await query.get();
    return this.deleteDocumentReferences(snapshot.docs.map((doc) => doc.ref));
  }

  private async deleteDocumentReferences(
    refs: readonly DocumentReference<DocumentData>[]
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
    return this.db
      .collection("users")
      .doc(uid)
      .collection("deckProgress")
      .doc(deckId);
  }

  private learningBackupRef(uid: string) {
    return this.db
      .collection("users")
      .doc(uid)
      .collection("sync")
      .doc("learningBackup");
  }
}

function parseLearningBackupEnvelope(
  data: DocumentData | undefined
): LearningBackupEnvelope {
  const value = data ?? {};
  const revision = numberValue(value.revision, -1);
  const snapshot = value.snapshot as LearningBackupSnapshot | undefined;
  assertBackend(
    Number.isSafeInteger(revision) &&
      revision >= 0 &&
      snapshot !== undefined &&
      snapshot.version === 1 &&
      Array.isArray(snapshot.freeDecks) &&
      Array.isArray(snapshot.sessions),
    "failed-precondition",
    "Learning backup projection is invalid.",
    { kind: "learning-backup-corrupt" }
  );
  const lastMutationId = stringOrUndefined(value.lastMutationId);
  return {
    revision,
    updatedAt: dateValue(value.updatedAt),
    ...(lastMutationId === undefined ? {} : { lastMutationId }),
    snapshot: structuredClone(snapshot),
  };
}

function serializeLearningBackupSnapshot(
  snapshot: LearningBackupSnapshot
): LearningBackupSnapshot {
  const serialized = structuredClone(snapshot);
  const forbidden = new Set([
    "front",
    "back",
    "hint",
    "example",
    "cardSnapshots",
    "uid",
    "deviceId",
    "deviceHash",
    "recentBatches",
    "purchaseToken",
    "receiptData",
    "signedPayload",
  ]);
  const stack: unknown[] = [serialized];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>
    )) {
      assertBackend(
        !forbidden.has(key),
        "internal",
        "Learning backup contains a forbidden field."
      );
      stack.push(child);
    }
  }
  return serialized;
}

function parseDeck(id: string, data: DocumentData): DeckMetadata {
  const tier = data.tier;
  const status = data.status;
  assertBackend(
    tier === "free" || tier === "pro",
    "failed-precondition",
    "Deck tier is invalid."
  );
  assertBackend(
    status === "draft" || status === "published" || status === "archived",
    "failed-precondition",
    "Deck status is invalid."
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
  if (typeof data.coverImageUrl === "string")
    deck.coverImageUrl = data.coverImageUrl;
  return deck;
}

function parseEntitlement(value: unknown): Entitlement {
  assertBackend(
    value !== null && typeof value === "object",
    "failed-precondition",
    "Entitlement is invalid."
  );
  const data = value as Record<string, unknown>;
  assertBackend(
    data.plan === "free" || data.plan === "pro",
    "failed-precondition",
    "Entitlement plan is invalid."
  );
  assertBackend(
    typeof data.source === "string",
    "failed-precondition",
    "Entitlement source is invalid."
  );
  assertBackend(
    data.validUntil === null || typeof data.validUntil === "string",
    "failed-precondition",
    "Entitlement validity is invalid."
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
  data: DocumentData | undefined
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
  if (value.ownershipState === "superseded") {
    const successor = parseReceiptPredecessor(value.supersededBy);
    assertBackend(
      platform === "google-play" &&
        /^[a-f0-9]{64}$/.test(fingerprint) &&
        typeof value.uid === "string" &&
        value.uid.length > 0 &&
        /^[a-f0-9]{64}$/.test(stringValue(value.originalTransactionId)) &&
        fingerprint ===
          sha256(`google-play:${stringValue(value.originalTransactionId)}`) &&
        successor !== undefined,
      "failed-precondition",
      "Superseded Google Play receipt claim is invalid.",
      { kind: "receipt-binding-conflict" }
    );
    return {
      kind: "superseded",
      fingerprint,
      successorFingerprint: successor.receiptFingerprint,
    };
  }
  const predecessor = parseReceiptPredecessor(value.predecessor);
  assertBackend(
    (platform === "google-play" || platform === "app-store") &&
      typeof value.uid === "string" &&
      value.uid.length > 0 &&
      typeof value.productId === "string" &&
      value.productId.length > 0 &&
      typeof value.originalTransactionId === "string" &&
      value.originalTransactionId.length > 0 &&
      value.ownershipState !== "account-deleted" &&
      value.ownershipState !== "superseded" &&
      (predecessor === undefined ||
        (platform === "google-play" &&
          /^[a-f0-9]{64}$/.test(fingerprint) &&
          /^[a-f0-9]{64}$/.test(value.originalTransactionId) &&
          fingerprint ===
            sha256(`google-play:${value.originalTransactionId}`))),
    "failed-precondition",
    "Store receipt claim is invalid.",
    { kind: "receipt-binding-conflict" }
  );
  return {
    kind: "claimed",
    fingerprint,
    uid: value.uid,
    platform,
    productId: value.productId,
    originalTransactionId: value.originalTransactionId,
    ...(predecessor === undefined ? {} : { predecessor }),
  };
}

function parseReceiptPredecessor(
  value: unknown
): ReceiptPredecessor | undefined {
  if (value === undefined) return undefined;
  assertBackend(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "failed-precondition",
    "Receipt predecessor is invalid.",
    { kind: "receipt-binding-conflict" }
  );
  const data = value as Record<string, unknown>;
  assertBackend(
    typeof data.originalTransactionId === "string" &&
      /^[a-f0-9]{64}$/.test(data.originalTransactionId) &&
      typeof data.receiptFingerprint === "string" &&
      /^[a-f0-9]{64}$/.test(data.receiptFingerprint) &&
      data.receiptFingerprint ===
        sha256(`google-play:${data.originalTransactionId}`),
    "failed-precondition",
    "Receipt predecessor is invalid.",
    { kind: "receipt-binding-conflict" }
  );
  return {
    originalTransactionId: data.originalTransactionId,
    receiptFingerprint: data.receiptFingerprint,
  };
}

function sameReceiptPredecessor(
  left: ReceiptPredecessor | undefined,
  right: ReceiptPredecessor | undefined
): boolean {
  return (
    (left === undefined && right === undefined) ||
    (left !== undefined &&
      right !== undefined &&
      left.originalTransactionId === right.originalTransactionId &&
      left.receiptFingerprint === right.receiptFingerprint)
  );
}

function assertLinkedReceiptIdentity(
  platform: VerifiedStoreReceipt["platform"],
  originalTransactionId: string,
  receiptFingerprint: string,
  predecessor: ReceiptPredecessor
): void {
  assertBackend(
    platform === "google-play" &&
      [
        originalTransactionId,
        receiptFingerprint,
        predecessor.originalTransactionId,
        predecessor.receiptFingerprint,
      ].every((value) => /^[a-f0-9]{64}$/.test(value)) &&
      receiptFingerprint === sha256(`google-play:${originalTransactionId}`) &&
      predecessor.receiptFingerprint ===
        sha256(`google-play:${predecessor.originalTransactionId}`) &&
      originalTransactionId !== predecessor.originalTransactionId &&
      receiptFingerprint !== predecessor.receiptFingerprint,
    "failed-precondition",
    "Google Play linked purchase identity is invalid.",
    { kind: "google-play-linked-purchase-conflict" }
  );
}

function assertPendingAuthorityBarrier(
  data: DocumentData | undefined,
  platform: "google-play" | "app-store" | "apps-in-toss"
): void {
  const value = data ?? {};
  assertBackend(
    (platform === "google-play" || platform === "app-store") &&
      value.state === "pending" &&
      value.platform === platform &&
      [
        "uid",
        "productId",
        "purchaseToken",
        "receiptData",
        "signedPayload",
        "transactionId",
        "originalTransactionId",
        "eventId",
        "notificationUUID",
      ].every((field) => value[field] === undefined),
    "failed-precondition",
    "Receipt authority barrier is invalid.",
    { kind: "receipt-authority-barrier-conflict" }
  );
}

function currentEntitlementProjection(
  data: DocumentData | undefined
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
    ...(storeEventId === undefined ||
    storeEventOccurredAt === new Date(0).toISOString()
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
  if (data.lastResetAt !== undefined)
    goal.lastResetAt = dateValue(data.lastResetAt);
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
    ...(goal.dailyTarget === undefined
      ? {}
      : { dailyTarget: goal.dailyTarget }),
    ...(goal.lastResetAt === undefined
      ? {}
      : { lastResetAt: Timestamp.fromDate(new Date(goal.lastResetAt)) }),
  };
}

function emptyProgress(
  uid: string,
  deckId: string,
  deckVersion: number,
  now: Date
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
  if (data.completedAt !== undefined)
    window.completedAt = dateValue(data.completedAt);
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
    ...(request.readyDeckId === undefined
      ? {}
      : { readyDeckId: request.readyDeckId }),
    ...(request.readyRevision === undefined
      ? {}
      : { readyRevision: request.readyRevision }),
    ...(request.readyAt === undefined
      ? {}
      : { readyAt: Timestamp.fromDate(new Date(request.readyAt)) }),
  };
}

function parseDeckRequestRecord(
  id: string,
  data: DocumentData
): DeckRequestRecord {
  assertBackend(
    typeof data.uid === "string" &&
      data.uid.length > 0 &&
      typeof data.topic === "string" &&
      data.topic.length > 0 &&
      typeof data.category === "string" &&
      data.category.length > 0 &&
      typeof data.language === "string" &&
      data.language.length > 0 &&
      (data.status === "queued" || data.status === "ready") &&
      (data.priority === "normal" || data.priority === "pro"),
    "failed-precondition",
    "Deck request record is invalid.",
    { kind: "deck-request-state-invalid" }
  );
  assertBackend(
    data.note === undefined || typeof data.note === "string",
    "failed-precondition",
    "Deck request note is invalid.",
    { kind: "deck-request-state-invalid" }
  );
  assertBackend(
    data.readyDeckId === undefined || typeof data.readyDeckId === "string",
    "failed-precondition",
    "Deck request readyDeckId is invalid.",
    { kind: "deck-request-state-invalid" }
  );
  assertBackend(
    data.readyRevision === undefined ||
      (typeof data.readyRevision === "number" &&
        Number.isSafeInteger(data.readyRevision)),
    "failed-precondition",
    "Deck request readyRevision is invalid.",
    { kind: "deck-request-state-invalid" }
  );
  const request: DeckRequestRecord = {
    id,
    uid: data.uid,
    topic: data.topic,
    category: data.category,
    language: data.language,
    status: data.status,
    priority: data.priority,
    createdAt: requiredStoredDate(data.createdAt, "createdAt"),
    updatedAt: requiredStoredDate(data.updatedAt, "updatedAt"),
  };
  if (typeof data.note === "string") request.note = data.note;
  if (typeof data.readyDeckId === "string") {
    request.readyDeckId = data.readyDeckId;
  }
  if (typeof data.readyRevision === "number") {
    request.readyRevision = data.readyRevision;
  }
  if (data.readyAt !== undefined) {
    request.readyAt = requiredStoredDate(data.readyAt, "readyAt");
  }
  return request;
}

function requiredStoredDate(value: unknown, field: string): string {
  const milliseconds = timestampMilliseconds(value);
  assertBackend(
    milliseconds !== null && Number.isFinite(milliseconds),
    "failed-precondition",
    `Deck request ${field} is invalid.`,
    { kind: "deck-request-state-invalid" }
  );
  return new Date(milliseconds).toISOString();
}

function serializeNotificationOutbox(
  outbox: DeckReadyNotificationOutbox
): DocumentData {
  return {
    schemaVersion: 1,
    kind: "deck-ready",
    requestId: outbox.requestId,
    requestRevision: outbox.requestRevision,
    status: outbox.status,
    attemptCount: outbox.attemptCount,
    createdAt: Timestamp.fromDate(new Date(outbox.createdAt)),
    updatedAt: Timestamp.fromDate(new Date(outbox.updatedAt)),
  };
}

function parseNotificationOutbox(
  id: string,
  data: DocumentData | undefined
): DeckReadyNotificationOutbox {
  const value = data ?? {};
  const status = value.status;
  const requestId = stringOrUndefined(value.requestId);
  const requestRevision = numberValue(value.requestRevision, -1);
  const attemptCount = numberValue(value.attemptCount, -1);
  assertBackend(
    value.schemaVersion === 1 &&
      value.kind === "deck-ready" &&
      requestId !== undefined &&
      Number.isSafeInteger(requestRevision) &&
      requestRevision > 0 &&
      Number.isSafeInteger(attemptCount) &&
      attemptCount >= 0 &&
      (status === "pending" ||
        status === "delivered" ||
        status === "skipped" ||
        status === "dead-letter"),
    "failed-precondition",
    "Notification outbox state is invalid.",
    { kind: "notification-outbox-corrupt" }
  );
  const lastAttemptAt =
    value.lastAttemptAt === undefined
      ? undefined
      : dateValue(value.lastAttemptAt);
  const completedAt =
    value.completedAt === undefined ? undefined : dateValue(value.completedAt);
  const expiresAt =
    value.expiresAt === undefined ? undefined : dateValue(value.expiresAt);
  const completionReason = stringOrUndefined(value.completionReason) as
    | DeckReadyNotificationOutbox["completionReason"]
    | undefined;
  const leaseId = stringOrUndefined(value.leaseId);
  const leaseUntil =
    value.leaseUntil === undefined ? undefined : dateValue(value.leaseUntil);
  assertBackend(
    (leaseId === undefined && leaseUntil === undefined) ||
      (leaseId !== undefined && leaseUntil !== undefined),
    "failed-precondition",
    "Notification outbox lease state is invalid.",
    { kind: "notification-outbox-corrupt" }
  );
  return {
    id,
    schemaVersion: 1,
    kind: "deck-ready",
    requestId,
    requestRevision,
    status,
    attemptCount,
    createdAt: dateValue(value.createdAt),
    updatedAt: dateValue(value.updatedAt),
    ...(lastAttemptAt === undefined ? {} : { lastAttemptAt }),
    ...(leaseId === undefined ? {} : { leaseId }),
    ...(leaseUntil === undefined ? {} : { leaseUntil }),
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(completionReason === undefined ? {} : { completionReason }),
    ...(typeof value.deliveredCount !== "number"
      ? {}
      : { deliveredCount: value.deliveredCount }),
    ...(typeof value.invalidatedCount !== "number"
      ? {}
      : { invalidatedCount: value.invalidatedCount }),
    ...(typeof value.permanentFailureCount !== "number"
      ? {}
      : { permanentFailureCount: value.permanentFailureCount }),
    ...(value.lastErrorCode === "messaging-transient"
      ? { lastErrorCode: "messaging-transient" as const }
      : {}),
  };
}

function trimBatchReceipts(
  receipts: Record<string, ProgressBatchReceipt>
): Record<string, ProgressBatchReceipt> {
  return Object.fromEntries(
    Object.entries(receipts)
      .sort(([, left], [, right]) =>
        right.submittedAt.localeCompare(left.submittedAt)
      )
      .slice(0, 20)
  );
}

function mergeGoal(
  target: StudyGoal | null,
  source: StudyGoal,
  targetUid: string,
  now: Date
): StudyGoal {
  if (target !== null) {
    assertBackend(
      target.deckVersion === source.deckVersion,
      "failed-precondition",
      `Goal ${source.id} has conflicting deck versions during account merge.`,
      { kind: "goal-version-conflict", goalId: source.id }
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
  now: Date
): DeckProgress {
  if (target !== null) {
    assertBackend(
      target.deckVersion === source.deckVersion,
      "failed-precondition",
      `Progress ${source.deckId} has conflicting deck versions during account merge.`,
      { kind: "progress-version-conflict", deckId: source.deckId }
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
      source.deliveredCardIds
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
  now: Date
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
  if (sourceExpiry !== targetExpiry)
    return sourceExpiry > targetExpiry ? source : target;
  return dateValue(source.updatedAt) > dateValue(target.updatedAt)
    ? source
    : target;
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

function newestNotificationInstallationIds(
  documents: readonly {
    readonly id: string;
    data(): DocumentData;
  }[],
  limit: number
): ReadonlySet<string> {
  return new Set(
    [...documents]
      .sort((left, right) => {
        const leftRecency = notificationInstallationRecency(left.data());
        const rightRecency = notificationInstallationRecency(right.data());
        if (leftRecency !== rightRecency) {
          return leftRecency > rightRecency ? -1 : 1;
        }
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      })
      .slice(0, limit)
      .map((document) => document.id)
  );
}

function parseAccountMergeResult(
  sourceUid: string,
  targetUid: string,
  data: DocumentData
): AccountMergeResult {
  assertBackend(
    data.sourceUid === sourceUid &&
      data.targetUid === targetUid &&
      data.billingBindingRetained === true &&
      timestampMilliseconds(data.mergedAt) !== null,
    "failed-precondition",
    "The anonymous account was already merged into another account.",
    { kind: "account-merge-conflict" }
  );

  // schemaVersion 1 marker는 durable cleanup 도입 전 동기식 병합 결과다. 당시
  // callable 소비자는 count를 사용하지 않았으므로 exact source→target 재시도만 성공으로 복원한다.
  if (data.schemaVersion === undefined || data.schemaVersion === 1) {
    return {
      merged: true,
      goalCount: 0,
      progressDeckCount: 0,
      entitlementMoved: false,
    };
  }
  assertBackend(
    data.schemaVersion === 2 &&
      Number.isSafeInteger(data.goalCount) &&
      data.goalCount >= 0 &&
      Number.isSafeInteger(data.progressDeckCount) &&
      data.progressDeckCount >= 0 &&
      typeof data.entitlementMoved === "boolean",
    "failed-precondition",
    "Account merge result marker is invalid.",
    { kind: "account-merge-result-corrupt" }
  );
  return {
    merged: true,
    goalCount: data.goalCount,
    progressDeckCount: data.progressDeckCount,
    entitlementMoved: data.entitlementMoved,
  };
}

function notificationInstallationRecency(data: DocumentData): number {
  return (
    timestampMilliseconds(data.lastSeenAt) ??
    timestampMilliseconds(data.tokenUpdatedAt) ??
    timestampMilliseconds(data.updatedAt) ??
    timestampMilliseconds(data.createdAt) ??
    Number.NEGATIVE_INFINITY
  );
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

function firebaseAuthErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
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
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entries]) => [
      key,
      numberArray(entries),
    ])
  );
}

function mergeUnique(
  left: readonly string[],
  right: readonly string[]
): string[] {
  return [...new Set([...left, ...right])];
}
