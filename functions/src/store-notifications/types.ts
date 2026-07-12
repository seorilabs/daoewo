import type { Entitlement } from "@daoewo/product-core";

export type StoreNotificationPlatform = "google-play" | "app-store";

export interface StoreEventCursor {
  occurredAt: string;
  eventId: string;
}

export type ReceiptClaimResolution =
  | {
      kind: "claimed";
      fingerprint: string;
      uid: string;
      platform: StoreNotificationPlatform;
      productId: string;
      originalTransactionId: string;
    }
  | { kind: "account-deleted"; fingerprint: string }
  | { kind: "missing"; fingerprint: string };

export type InactiveSubscriptionReason =
  | "expired"
  | "revoked"
  | "refunded"
  | "on-hold"
  | "paused"
  | "billing-retry"
  | "pending";

interface AuthoritativeSubscriptionStateBase {
  platform: StoreNotificationPlatform;
  productId: string;
  originalTransactionId: string;
  environment: "sandbox" | "production";
  storeState: string;
  authorityObservation: {
    startedAt: string;
    observedAt: string;
  };
}

export type AuthoritativeSubscriptionState =
  | (AuthoritativeSubscriptionStateBase & {
      active: true;
      purchasedAt: string;
      validUntil: string;
      entitlement: Entitlement & { plan: "pro"; validUntil: string };
    })
  | (AuthoritativeSubscriptionStateBase & {
      active: false;
      reason: InactiveSubscriptionReason;
      lastKnownExpiry: string | null;
      entitlement: Entitlement & { plan: "free"; validUntil: null };
    });

export interface GooglePlaySubscriptionNotification {
  platform: "google-play";
  eventType: "subscription.status_changed";
  notificationType: number | "voided-purchase";
  voidedRefundType?: 1 | 2;
  voidedOrderId?: string;
  packageName: string;
  purchaseToken: string;
  receiptFingerprint: string;
  originalTransactionId: string;
  cursor: StoreEventCursor;
}

export interface AppStoreSubscriptionNotification {
  platform: "app-store";
  eventType: "subscription.status_changed";
  notificationType: string;
  subtype?: string;
  environment: "sandbox" | "production";
  transactionId: string;
  productId: string;
  receiptFingerprint: string;
  originalTransactionId: string;
  cursor: StoreEventCursor;
}

export type VerifiedStoreSubscriptionNotification =
  | GooglePlaySubscriptionNotification
  | AppStoreSubscriptionNotification;

export type VerifiedStoreNotificationEnvelope =
  | { kind: "subscription"; notification: VerifiedStoreSubscriptionNotification }
  | { kind: "test" | "ignored"; platform: StoreNotificationPlatform; eventId: string };

export interface StoreSubscriptionStateProvider<
  TNotification extends VerifiedStoreSubscriptionNotification =
    VerifiedStoreSubscriptionNotification,
> {
  readonly platform: TNotification["platform"];
  getState(
    notification: TNotification,
    claim: Extract<ReceiptClaimResolution, { kind: "claimed" }>,
  ): Promise<AuthoritativeSubscriptionState>;
}

export type StoreNotificationApplyOutcome =
  | "applied"
  | "stale"
  | "idempotent"
  | "superseded";

export type StoreNotificationApplyResult =
  | {
      outcome: StoreNotificationApplyOutcome;
      uid: string;
      entitlement: Entitlement;
    }
  | { outcome: "account-deleted" | "missing"; uid: null };

export interface StoreNotificationRepository {
  resolveReceiptClaim(fingerprint: string): Promise<ReceiptClaimResolution>;
  applyAuthoritativeSubscriptionState(input: {
    notification: VerifiedStoreSubscriptionNotification;
    expectedClaim: Extract<ReceiptClaimResolution, { kind: "claimed" }>;
    state: AuthoritativeSubscriptionState;
    now: Date;
  }): Promise<StoreNotificationApplyResult>;
}
