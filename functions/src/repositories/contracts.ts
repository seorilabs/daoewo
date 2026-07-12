import type { Entitlement } from "@daoewo/product-core";
import type {
  DeckMetadata,
  DeckProgress,
  DeckRequestRecord,
  DeliveryWindow,
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
  calculate: (
    current: DeckProgress,
    answers: ProgressAnswer[],
  ) => DeckProgress;
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

export interface StudyRepository extends CatalogRepository, GoalRepository {
  getProgress(uid: string, deckId: string): Promise<DeckProgress | null>;
  reserveDelivery(input: DeliveryReservationInput): Promise<DeliveryWindow>;
  getDeliveryWindow(uid: string, windowId: string): Promise<DeliveryWindow | null>;
  commitProgress(input: ProgressCommitInput): Promise<ProgressCommitResult>;
  ensureDeviceAccess(
    uid: string,
    deviceHash: string,
    pro: boolean,
    now: Date,
  ): Promise<void>;
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
    checkRevoked?: boolean,
  ): Promise<{
    uid: string;
    firebase?: { sign_in_provider?: string };
  }>;
}

export interface DeckContentRepository {
  getCardsByIndexes(
    deck: Pick<DeckMetadata, "id" | "version" | "cardCount" | "chunkSize">,
    indexes: readonly number[],
  ): Promise<StudyCard[]>;
}

export interface DeckRequestRepository {
  createDeckRequest(
    request: Omit<DeckRequestRecord, "id">,
    dailyLimit: number,
  ): Promise<DeckRequestRecord>;
}

export interface ReceiptEntitlementRepository extends EntitlementRepository {
  applyVerifiedReceipt(
    uid: string,
    receipt: VerifiedStoreReceipt,
    receiptFingerprint: string,
    authorityObservation: AuthorityObservationWindow,
    now: Date,
  ): Promise<Entitlement>;
  applyVerifiedSubscriptionEvent(
    event: VerifiedTossSubscriptionEvent,
    receiptFingerprint: string,
    now: Date,
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
    now: Date,
  ): Promise<void>;
  consumeAppCheckRefreshQuota(
    uid: string,
    requesterHash: string,
    hourlyLimit: number,
    now: Date,
  ): Promise<void>;
}

export interface FirebaseCustomTokenIssuer {
  createCustomToken(
    uid: string,
    developerClaims?: Record<string, unknown>,
  ): Promise<string>;
}

export interface FirebaseAppCheckTokenIssuer {
  createToken(appId: string): Promise<{ token: string; ttlMillis: number }>;
}
