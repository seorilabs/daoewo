import { BackendError, assertBackend } from "../errors.js";
import type {
  GooglePlayOrder,
  GooglePlayPublisherClient,
  GooglePlaySubscriptionLineItem,
  GooglePlaySubscriptionPurchase,
} from "../receipts/google-play-provider.js";
import {
  googlePlayAccountBinding,
  resolveReceiptBindingUids,
  StoreApiFailure,
  type ReceiptAccountBindingResolver,
} from "../receipts/providers.js";
import {
  googlePlayOriginalTransactionId,
  googlePlayReceiptFingerprint,
} from "../receipts/fingerprint.js";
import type {
  AuthoritativeSubscriptionState,
  GooglePlaySubscriptionNotification,
  ReceiptClaimResolution,
  StoreSubscriptionStateProvider,
  VerifiedStoreNotificationEnvelope,
} from "./types.js";

const ACTIVE_STATES = new Set([
  "SUBSCRIPTION_STATE_ACTIVE",
  "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
  // 취소 후 만료 전까지는 유료 접근권이 유지된다.
  "SUBSCRIPTION_STATE_CANCELED",
]);
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export interface GooglePlayNotificationConfig {
  packageName: string;
  productIds: ReadonlySet<string>;
}

export function readGooglePlayPubSubJson(message: {
  readonly json: unknown;
}): unknown {
  try {
    return message.json;
  } catch {
    throw new BackendError(
      "invalid-argument",
      "Google Play Pub/Sub message is not valid JSON.",
    );
  }
}

export function parseGooglePlayDeveloperNotification(
  body: unknown,
  messageId: string,
  expectedPackageName: string,
): VerifiedStoreNotificationEnvelope {
  assertBackend(
    typeof messageId === "string" && messageId.length > 0 && messageId.length <= 256,
    "invalid-argument",
    "Google Play notification has an invalid message ID.",
  );
  const data = objectValue(body);
  assertBackend(
    data.version === "1.0" && data.packageName === expectedPackageName,
    "permission-denied",
    "Google Play notification does not match this app.",
  );
  const eventTimeMs = integerStringValue(data.eventTimeMillis);
  assertBackend(
    eventTimeMs > 0,
    "invalid-argument",
    "Google Play notification has an invalid event time.",
  );

  const variants = [
    data.subscriptionNotification,
    data.oneTimeProductNotification,
    data.voidedPurchaseNotification,
    data.pendingRefundReviewNotification,
    data.testNotification,
  ].filter((value) => value !== undefined);
  assertBackend(
    variants.length === 1,
    "invalid-argument",
    "Google Play notification must contain exactly one event payload.",
  );

  if (data.testNotification !== undefined) {
    objectValue(data.testNotification);
    return { kind: "test", platform: "google-play", eventId: messageId };
  }
  if (data.voidedPurchaseNotification !== undefined) {
    const voided = objectValue(data.voidedPurchaseNotification);
    const productType = integerValue(voided.productType);
    const refundType = integerValue(voided.refundType);
    assertBackend(
      (productType === 1 || productType === 2) &&
        (refundType === 1 || refundType === 2),
      "invalid-argument",
      "Google Play voided purchase notification is invalid.",
    );
    const voidedOrderId = nonEmptyString(voided.orderId, 256);
    if (productType === 2) {
      return { kind: "ignored", platform: "google-play", eventId: messageId };
    }
    return googlePlaySubscriptionEnvelope({
      packageName: expectedPackageName,
      purchaseToken: nonEmptyString(voided.purchaseToken, 4_096),
      notificationType: "voided-purchase",
      voidedRefundType: refundType,
      voidedOrderId,
      messageId,
      eventTimeMs,
    });
  }
  if (data.subscriptionNotification === undefined) {
    return { kind: "ignored", platform: "google-play", eventId: messageId };
  }

  const subscription = objectValue(data.subscriptionNotification);
  const notificationType = integerValue(subscription.notificationType);
  const purchaseToken = nonEmptyString(subscription.purchaseToken, 4_096);
  assertBackend(
    subscription.version === "1.0" && notificationType > 0,
    "invalid-argument",
    "Google Play subscription notification is invalid.",
  );
  return googlePlaySubscriptionEnvelope({
    packageName: expectedPackageName,
    purchaseToken,
    notificationType,
    messageId,
    eventTimeMs,
  });
}

function googlePlaySubscriptionEnvelope(input: {
  packageName: string;
  purchaseToken: string;
  notificationType: number | "voided-purchase";
  voidedRefundType?: 1 | 2;
  voidedOrderId?: string;
  messageId: string;
  eventTimeMs: number;
}): VerifiedStoreNotificationEnvelope {
  const originalTransactionId = googlePlayOriginalTransactionId(
    input.packageName,
    input.purchaseToken,
  );
  return {
    kind: "subscription",
    notification: {
      platform: "google-play",
      eventType: "subscription.status_changed",
      notificationType: input.notificationType,
      ...(input.voidedRefundType === undefined
        ? {}
        : { voidedRefundType: input.voidedRefundType }),
      ...(input.voidedOrderId === undefined
        ? {}
        : { voidedOrderId: input.voidedOrderId }),
      packageName: input.packageName,
      purchaseToken: input.purchaseToken,
      originalTransactionId,
      receiptFingerprint: googlePlayReceiptFingerprint(
        input.packageName,
        input.purchaseToken,
      ),
      cursor: {
        eventId: input.messageId,
        occurredAt: new Date(input.eventTimeMs).toISOString(),
      },
    },
  };
}

export class GooglePlayAuthoritativeStateProvider
  implements StoreSubscriptionStateProvider<GooglePlaySubscriptionNotification>
{
  readonly platform = "google-play" as const;

  constructor(
    private readonly client: GooglePlayPublisherClient,
    private readonly config: GooglePlayNotificationConfig,
    private readonly bindingResolver: ReceiptAccountBindingResolver,
    private readonly now: () => Date,
  ) {}

  async getState(
    notification: GooglePlaySubscriptionNotification,
    claim: Extract<ReceiptClaimResolution, { kind: "claimed" }>,
  ): Promise<AuthoritativeSubscriptionState> {
    assertBackend(
      notification.packageName === this.config.packageName &&
        claim.platform === this.platform &&
        claim.originalTransactionId === notification.originalTransactionId &&
        claim.productId.length > 0 &&
        this.config.productIds.has(claim.productId),
      "permission-denied",
      "Google Play notification does not match its receipt claim.",
    );
    const bindingUids = await resolveReceiptBindingUids(
      this.bindingResolver,
      claim.uid,
    );
    const acceptedBindings = new Set(
      bindingUids.map((uid) =>
        googlePlayAccountBinding(this.config.packageName, uid),
      ),
    );
    const authorityObservationStartedAt = this.now();
    let purchase: GooglePlaySubscriptionPurchase;
    try {
      purchase = await this.client.getSubscription(
        this.config.packageName,
        notification.purchaseToken,
      );
    } catch (error) {
      if (error instanceof StoreApiFailure && error.kind === "not-found") {
        throw new StoreApiFailure("unavailable");
      }
      throw error;
    }
    const authorityObservedAt = this.now();
    const authorityObservation = {
      startedAt: authorityObservationStartedAt.toISOString(),
      observedAt: authorityObservedAt.toISOString(),
    };
    validateAccountBinding(purchase, acceptedBindings);

    const matchingItems = (purchase.lineItems ?? []).filter(
      (item) => item.productId === claim.productId,
    );
    assertBackend(
      matchingItems.length === 1,
      "permission-denied",
      "Google Play subscription product does not match its receipt claim.",
    );
    const lineItem = matchingItems[0]!;
    const state = requiredString(purchase.subscriptionState);
    const expiryMs = optionalTime(lineItem.expiryTime);
    const nowMs = authorityObservedAt.getTime();
    assertBackend(
      Number.isFinite(nowMs),
      "internal",
      "Google Play subscription state is unavailable.",
    );
    const environment =
      purchase.testPurchase === undefined || purchase.testPurchase === null
        ? "production"
        : "sandbox";

    if (!ACTIVE_STATES.has(state) || expiryMs === null || expiryMs <= nowMs) {
      return inactiveGoogleState(
        claim,
        state,
        environment,
        expiryMs,
        authorityObservation,
      );
    }

    if (
      notification.notificationType === "voided-purchase" &&
      requiredString(lineItem.latestSuccessfulOrderId) ===
        notification.voidedOrderId
    ) {
      // The void targets the order still presented as current. Retry until
      // subscriptionsv2 reflects revoke/expiry or a later successful renewal.
      throw new StoreApiFailure("unavailable");
    }

    assertBackend(
      purchase.linkedPurchaseToken === null ||
        purchase.linkedPurchaseToken === undefined,
      "failed-precondition",
      "Google Play linked purchase migration is not supported yet.",
      { kind: "google-play-linked-purchase-unsupported" },
    );

    const startMs = requiredTime(purchase.startTime);
    assertBackend(
      startMs <= nowMs + MAX_CLOCK_SKEW_MS,
      "permission-denied",
      "Google Play subscription start time is invalid.",
    );
    const orderId = requiredString(lineItem.latestSuccessfulOrderId);
    const order = await this.client.getOrder(this.config.packageName, orderId);
    validateOrderIdentity(
      order,
      orderId,
      notification.purchaseToken,
      claim.productId,
      nowMs,
    );
    if (purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
      await this.client.acknowledgeSubscription(
        this.config.packageName,
        claim.productId,
        notification.purchaseToken,
      );
    } else {
      assertBackend(
        purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
        "permission-denied",
        "Google Play acknowledgement state is invalid.",
      );
    }

    const validUntil = new Date(expiryMs).toISOString();
    return {
      active: true,
      platform: this.platform,
      productId: claim.productId,
      originalTransactionId: claim.originalTransactionId,
      environment,
      storeState: state,
      authorityObservation,
      purchasedAt: new Date(startMs).toISOString(),
      validUntil,
      entitlement: {
        plan: "pro",
        source: this.platform,
        validUntil,
      },
    };
  }
}

function inactiveGoogleState(
  claim: Extract<ReceiptClaimResolution, { kind: "claimed" }>,
  storeState: string,
  environment: "sandbox" | "production",
  expiryMs: number | null,
  authorityObservation: {
    startedAt: string;
    observedAt: string;
  },
): AuthoritativeSubscriptionState {
  const reason = googleInactiveReason(storeState, expiryMs);
  return {
    active: false,
    platform: "google-play",
    productId: claim.productId,
    originalTransactionId: claim.originalTransactionId,
    environment,
    storeState,
    authorityObservation,
    reason,
    lastKnownExpiry: expiryMs === null ? null : new Date(expiryMs).toISOString(),
    entitlement: { plan: "free", source: "google-play", validUntil: null },
  };
}

function googleInactiveReason(
  state: string,
  expiryMs: number | null,
): "expired" | "on-hold" | "paused" | "pending" {
  if (state === "SUBSCRIPTION_STATE_ON_HOLD") return "on-hold";
  if (state === "SUBSCRIPTION_STATE_PAUSED") return "paused";
  if (
    state === "SUBSCRIPTION_STATE_PENDING" ||
    state === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED"
  ) {
    return "pending";
  }
  if (state === "SUBSCRIPTION_STATE_EXPIRED" || expiryMs !== null) {
    return "expired";
  }
  assertBackend(
    false,
    "permission-denied",
    "Google Play subscription state is unsupported.",
  );
}

function validateAccountBinding(
  purchase: GooglePlaySubscriptionPurchase,
  acceptedBindings: ReadonlySet<string>,
): void {
  const binding = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  assertBackend(
    typeof binding === "string" && acceptedBindings.has(binding),
    "permission-denied",
    "Google Play subscription account binding does not match.",
  );
}

function validateOrderIdentity(
  order: GooglePlayOrder,
  expectedOrderId: string,
  purchaseToken: string,
  productId: string,
  nowMs: number,
): void {
  const orderTimeMs = requiredTime(order.createTime);
  const matchingItems = (order.lineItems ?? []).filter(
    (item) =>
      item.productId === productId &&
      item.subscriptionDetails !== undefined &&
      item.subscriptionDetails !== null,
  );
  assertBackend(
    order.orderId === expectedOrderId &&
      order.purchaseToken === purchaseToken &&
      typeof order.state === "string" &&
      matchingItems.length === 1 &&
      orderTimeMs <= nowMs + MAX_CLOCK_SKEW_MS,
    "permission-denied",
    "Google Play order does not match its subscription.",
  );
}

function optionalTime(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const result = Date.parse(value);
  assertBackend(
    Number.isFinite(result),
    "permission-denied",
    "Google Play subscription timestamp is invalid.",
  );
  return result;
}

function requiredTime(value: string | null | undefined): number {
  const result = optionalTime(value);
  assertBackend(
    result !== null,
    "permission-denied",
    "Google Play subscription timestamp is missing.",
  );
  return result;
}

function objectValue(value: unknown): Record<string, unknown> {
  assertBackend(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "invalid-argument",
    "Google Play notification body is invalid.",
  );
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, maximumLength: number): string {
  assertBackend(
    typeof value === "string" && value.length > 0 && value.length <= maximumLength,
    "invalid-argument",
    "Google Play notification string is invalid.",
  );
  return value;
}

function requiredString(value: string | null | undefined): string {
  assertBackend(
    typeof value === "string" && value.length > 0,
    "permission-denied",
    "Google Play subscription response is incomplete.",
  );
  return value;
}

function integerValue(value: unknown): number {
  assertBackend(
    typeof value === "number" && Number.isSafeInteger(value),
    "invalid-argument",
    "Google Play notification integer is invalid.",
  );
  return value;
}

function integerStringValue(value: unknown): number {
  assertBackend(
    typeof value === "string" && /^\d+$/.test(value),
    "invalid-argument",
    "Google Play notification timestamp is invalid.",
  );
  const result = Number(value);
  assertBackend(
    Number.isSafeInteger(result),
    "invalid-argument",
    "Google Play notification timestamp is out of range.",
  );
  return result;
}
