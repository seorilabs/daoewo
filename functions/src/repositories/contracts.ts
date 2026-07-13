import type { Entitlement } from "@daoewo/product-core";
import type {
  DeckMetadata,
  DeckProgress,
  DeckRequestRecord,
  DeliveryWindow,
  LearningBackupEnvelope,
  LearningBackupSnapshot,
  ProgressAnswer,
  StudyCard,
  StudyGoal,
  SyncState,
} from "../domain/types.js";
import type {
  AuthorityObservationWindow,
  VerifiedStoreReceipt,
} from "../receipts/providers.js";
import type { VerifiedTossSubscriptionEvent } from "../apps-in-toss/provider.js";
import type {
  DeckReadyCompletionReason,
  DeckReadyNotificationOutbox,
  DeckReadyNotificationTarget,
  NotificationDeliveryTarget,
  NotificationInstallationInvalidation,
  NotificationInstallationRecord,
  NotificationOutboxStatus,
} from "../notifications/types.js";

export interface CatalogFilter {
  category?: string;
  language?: string;
}

export interface CatalogRepository {
  listPublishedDecks(filter: CatalogFilter): Promise<DeckMetadata[]>;
  getDeck(deckId: string): Promise<DeckMetadata | null>;
}

export interface EntitlementRepository {
  getEntitlement(uid: string): Promise<Entitlement | null>;
}

export interface GoalWriteInput {
  uid: string;
  goal: StudyGoal;
  maxActiveGoals: number | null;
  resetCooldownMs: number;
  now: Date;
}

export interface GoalRepository {
  getGoal(uid: string, goalId: string): Promise<StudyGoal | null>;
  isFreeActiveGoalAllowed(uid: string, goalId: string): Promise<boolean>;
  createOrResetGoal(input: GoalWriteInput): Promise<StudyGoal>;
  deactivateGoal(uid: string, goalId: string, now: Date): Promise<void>;
}

export interface DeliveryReservationInput {
  window: DeliveryWindow;
  cards: StudyCard[];
  hardUserDailyLimit: number | null;
  premiumUserDailySoftCap: number | null;
  premiumDeviceDailySoftCap: number | null;
}

export interface ProgressCommitInput {
  uid: string;
  batchId: string;
  windowId: string;
  answers: ProgressAnswer[];
  now: Date;
  calculate: (current: DeckProgress, answers: ProgressAnswer[]) => DeckProgress;
}

export interface ProgressCommitResult {
  idempotent: boolean;
  progress: DeckProgress;
  receipt: {
    batchId: string;
    submittedAt: string;
    updatedCount: number;
    windowId: string;
  };
}

export interface LearningBackupReconcileInput {
  uid: string;
  baseRevision: number;
  mutationId: string;
  snapshot: LearningBackupSnapshot;
  maxActiveFreeDecks: number | null;
  now: Date;
}

export interface StudyRepository extends CatalogRepository, GoalRepository {
  getProgress(uid: string, deckId: string): Promise<DeckProgress | null>;
  reserveDelivery(input: DeliveryReservationInput): Promise<DeliveryWindow>;
  getDeliveryWindow(
    uid: string,
    windowId: string
  ): Promise<DeliveryWindow | null>;
  commitProgress(input: ProgressCommitInput): Promise<ProgressCommitResult>;
  ensureDeviceAccess(
    uid: string,
    deviceHash: string,
    pro: boolean,
    now: Date
  ): Promise<void>;
  reconcileLearningBackup(
    input: LearningBackupReconcileInput
  ): Promise<LearningBackupEnvelope>;
  getSyncState(uid: string): Promise<SyncState>;
}

export interface AccountAccessRepository {
  assertAccountActive(uid: string): Promise<void>;
  mergeAnonymousAccount(input: {
    sourceUid: string;
    targetUid: string;
    deviceHash: string;
    now: Date;
  }): Promise<{
    merged: true;
    goalCount: number;
    progressDeckCount: number;
    entitlementMoved: boolean;
  }>;
}

export interface AccountMergeResult {
  readonly merged: true;
  readonly goalCount: number;
  readonly progressDeckCount: number;
  readonly entitlementMoved: boolean;
}

export interface AccountMergeRepository {
  assertAccountActive(uid: string): Promise<void>;
  getAccountMergeResult(
    sourceUid: string,
    targetUid: string
  ): Promise<AccountMergeResult | null>;
  mergeAnonymousAccount(input: {
    sourceUid: string;
    targetUid: string;
    deviceHash: string;
    now: Date;
  }): Promise<AccountMergeResult>;
}

export type AccountMergeCleanupFailureCode =
  | "target-claims"
  | "source-auth";

export interface AccountMergeCleanupClaim {
  readonly sourceUid: string;
  readonly targetUid: string;
}

export interface AccountMergeCleanupRepository {
  listAccountMergeCleanupCandidates(input: {
    readonly cutoff: Date;
    readonly limit: number;
  }): Promise<readonly string[]>;
  claimAccountMergeCleanup(input: {
    readonly sourceUid: string;
    readonly leaseId: string;
    readonly now: Date;
    readonly leaseUntil: Date;
  }): Promise<AccountMergeCleanupClaim | null>;
  recordAccountMergeCleanupRetry(input: {
    readonly sourceUid: string;
    readonly leaseId: string;
    readonly failureCode: AccountMergeCleanupFailureCode;
    readonly now: Date;
  }): Promise<void>;
  completeAccountMergeCleanup(input: {
    readonly sourceUid: string;
    readonly leaseId: string;
    readonly now: Date;
  }): Promise<void>;
  syncMergedAccountEntitlementClaims(targetUid: string, now: Date): Promise<void>;
  cleanupMergedSourceAuth(sourceUid: string): Promise<void>;
}

export interface AccountDeletionSummary {
  readonly deletedUidCount: number;
  readonly deletedDocumentCount: number;
  readonly retainedReceiptClaimCount: number;
}

export interface AccountDeletionRepository {
  beginAccountDeletion(uid: string, now: Date): Promise<void>;
  purgeAccountData(uid: string, now: Date): Promise<AccountDeletionSummary>;
}

export interface FirebaseAccountAdmin {
  deleteUser(uid: string): Promise<void>;
}

export interface FirebaseIdTokenVerifier {
  verifyIdToken(
    token: string,
    checkRevoked?: boolean
  ): Promise<{
    uid: string;
    firebase?: { sign_in_provider?: string };
  }>;
  getUser(uid: string): Promise<{
    readonly providerData: readonly {
      readonly providerId: string;
    }[];
  }>;
}

export interface DeckContentRepository {
  getCardsByIndexes(
    deck: Pick<DeckMetadata, "id" | "version" | "cardCount" | "chunkSize">,
    indexes: readonly number[]
  ): Promise<StudyCard[]>;
}

export interface DeckRequestRepository {
  createDeckRequest(
    request: Omit<DeckRequestRecord, "id">,
    dailyLimit: number
  ): Promise<DeckRequestRecord>;
}

export interface CompleteDeckRequestWriteInput {
  readonly requestId: string;
  readonly readyDeckId: string;
  readonly now: Date;
}

export interface DeckRequestCompletionResult {
  readonly request: DeckRequestRecord;
  readonly idempotent: boolean;
}

export interface DeckRequestOperatorRepository {
  completeDeckRequest(
    input: CompleteDeckRequestWriteInput
  ): Promise<DeckRequestCompletionResult>;
}

export interface CatalogNotificationEventClaimInput {
  readonly eventId: string;
  readonly leaseId: string;
  readonly now: Date;
  readonly leaseUntil: Date;
  readonly expiresAt: Date;
  readonly maxAttempts: number;
}

export interface CatalogNotificationEventCompletionInput {
  readonly eventId: string;
  readonly leaseId: string;
  readonly status: "delivered" | "failed";
  readonly now: Date;
}

export interface CatalogNotificationEventRepository {
  claimCatalogNotificationEvent(
    input: CatalogNotificationEventClaimInput
  ): Promise<boolean>;
  completeCatalogNotificationEvent(
    input: CatalogNotificationEventCompletionInput
  ): Promise<void>;
}

export interface NotificationInstallationWriteInput {
  readonly installation: NotificationInstallationRecord;
  readonly maxInstallationsPerAccount: number;
}

export interface NotificationOutboxCompletionInput {
  readonly eventId: string;
  readonly leaseId: string;
  readonly status: Exclude<NotificationOutboxStatus, "pending">;
  readonly reason: DeckReadyCompletionReason;
  readonly deliveredCount: number;
  readonly invalidatedCount: number;
  readonly permanentFailureCount: number;
  readonly now: Date;
  readonly expiresAt: Date;
}

export interface NotificationOutboxClaimInput {
  readonly eventId: string;
  readonly leaseId: string;
  readonly now: Date;
  readonly leaseUntil: Date;
}

export interface NotificationOutboxRetryInput {
  readonly eventId: string;
  readonly leaseId: string;
  readonly now: Date;
}

export interface NotificationRepository {
  upsertNotificationInstallation(
    input: NotificationInstallationWriteInput
  ): Promise<void>;
  unregisterNotificationInstallation(
    uid: string,
    installationHash: string
  ): Promise<void>;
  listDeckReadyNotificationInstallations(
    uid: string,
    now: Date
  ): Promise<NotificationDeliveryTarget[]>;
  listCatalogNotificationInstallations(
    now: Date
  ): Promise<NotificationDeliveryTarget[]>;
  deleteNotificationInstallations(
    uid: string,
    invalidations: readonly NotificationInstallationInvalidation[]
  ): Promise<void>;
  deleteCatalogNotificationInstallations(
    invalidations: readonly NotificationInstallationInvalidation[]
  ): Promise<void>;
  createDeckReadyNotificationOutbox(
    outbox: DeckReadyNotificationOutbox
  ): Promise<boolean>;
  recordNotificationOutboxAttempt(
    input: NotificationOutboxClaimInput
  ): Promise<DeckReadyNotificationOutbox | null>;
  recordNotificationOutboxRetry(
    input: NotificationOutboxRetryInput
  ): Promise<void>;
  completeNotificationOutbox(
    input: NotificationOutboxCompletionInput
  ): Promise<void>;
  resolveDeckReadyNotificationTarget(
    requestId: string,
    requestRevision: number
  ): Promise<DeckReadyNotificationTarget | null>;
}

export interface ReceiptEntitlementRepository extends EntitlementRepository {
  applyVerifiedReceipt(
    uid: string,
    receipt: VerifiedStoreReceipt,
    receiptFingerprint: string,
    authorityObservation: AuthorityObservationWindow,
    now: Date
  ): Promise<{
    entitlement: Entitlement;
    /** claim 전 store notification이 있어 authoritative retry를 기다리는 상태다. */
    authorityPending: boolean;
  }>;
  applyVerifiedSubscriptionEvent(
    event: VerifiedTossSubscriptionEvent,
    receiptFingerprint: string,
    now: Date
  ): Promise<{
    uid: string;
    entitlement: Entitlement;
    applied: boolean;
    idempotent: boolean;
  }>;
}

export interface AppsInTossIdentityRepository {
  claimOneTimeAuthorizationCode(
    fingerprint: string,
    requesterHash: string,
    hourlyLimit: number,
    now: Date
  ): Promise<void>;
  consumeAppCheckRefreshQuota(
    uid: string,
    requesterHash: string,
    hourlyLimit: number,
    now: Date
  ): Promise<void>;
}

export interface FirebaseCustomTokenIssuer {
  createCustomToken(
    uid: string,
    developerClaims?: Record<string, unknown>
  ): Promise<string>;
}

export interface FirebaseAppCheckTokenIssuer {
  createToken(appId: string): Promise<{ token: string; ttlMillis: number }>;
}
