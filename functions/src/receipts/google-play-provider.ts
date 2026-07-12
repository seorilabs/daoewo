import { BackendError, assertBackend } from "../errors.js";
import {
  googlePlayOriginalTransactionId,
  googlePlayReceiptIdentity,
} from "./fingerprint.js";
import {
  googlePlayAccountBinding,
  resolveReceiptBindingUids,
  StoreApiFailure,
  type ReceiptAccountBindingResolver,
  type ReceiptVerificationProvider,
  type ReceiptVerificationRequest,
  type VerifiedStoreReceipt,
} from "./providers.js";

const ENTITLED_SUBSCRIPTION_STATES = new Set([
  "SUBSCRIPTION_STATE_ACTIVE",
  "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
  "SUBSCRIPTION_STATE_CANCELED",
]);
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export interface GooglePlaySubscriptionLineItem {
  productId?: string | null;
  expiryTime?: string | null;
  latestSuccessfulOrderId?: string | null;
}

export interface GooglePlaySubscriptionPurchase {
  subscriptionState?: string | null;
  acknowledgementState?: string | null;
  startTime?: string | null;
  linkedPurchaseToken?: string | null;
  lineItems?: readonly GooglePlaySubscriptionLineItem[];
  externalAccountIdentifiers?: {
    obfuscatedExternalAccountId?: string | null;
  };
  testPurchase?: unknown;
}

export interface GooglePlayOrder {
  orderId?: string | null;
  purchaseToken?: string | null;
  state?: string | null;
  createTime?: string | null;
  lineItems?: readonly {
    productId?: string | null;
    subscriptionDetails?: unknown;
  }[];
}

export interface GooglePlayPublisherClient {
  getSubscription(
    packageName: string,
    purchaseToken: string,
  ): Promise<GooglePlaySubscriptionPurchase>;
  getOrder(packageName: string, orderId: string): Promise<GooglePlayOrder>;
  acknowledgeSubscription(
    packageName: string,
    productId: string,
    purchaseToken: string,
  ): Promise<void>;
}

export interface GooglePlayReceiptProviderConfig {
  packageName: string;
  productIds: ReadonlySet<string>;
}

export class GooglePlayReceiptVerificationProvider
  implements ReceiptVerificationProvider
{
  readonly platform = "google-play" as const;

  constructor(
    private readonly client: GooglePlayPublisherClient,
    private readonly config: GooglePlayReceiptProviderConfig,
    private readonly bindingResolver: ReceiptAccountBindingResolver,
    private readonly now: () => Date,
  ) {}

  async verify(request: ReceiptVerificationRequest): Promise<VerifiedStoreReceipt> {
    try {
      assertBackend(
        request.platform === this.platform &&
          request.purchaseToken !== undefined &&
          request.purchaseToken.length > 0,
        "invalid-argument",
        "A Google Play purchase token is required.",
      );
      assertBackend(
        request.packageName === undefined ||
          request.packageName === this.config.packageName,
        "permission-denied",
        "Google Play purchase could not be verified.",
      );
      assertBackend(
        this.config.productIds.has(request.productId),
        "permission-denied",
        "Google Play purchase could not be verified.",
      );
      const bindingUids = await resolveReceiptBindingUids(
        this.bindingResolver,
        request.uid,
      );
      const acceptedAccountBindings = new Set(
        bindingUids.map((uid) =>
          googlePlayAccountBinding(this.config.packageName, uid),
        ),
      );

      const purchaseToken = request.purchaseToken;
      const authorityObservationStartedAt = this.now();
      const purchase = await this.client.getSubscription(
        this.config.packageName,
        purchaseToken,
      );
      // API 응답의 linked raw token은 이 지점에서 즉시 이중 hash하고 이후
      // provider/repository contract에는 비식별 체인 식별자만 전달한다.
      const predecessor = linkedPurchasePredecessor(
        this.config.packageName,
        purchase.linkedPurchaseToken,
      );
      const now = this.now();
      const nowMs = now.getTime();
      assertBackend(
        Number.isFinite(nowMs),
        "internal",
        "Google Play receipt verification is unavailable.",
      );
      assertBackend(
        purchase.subscriptionState !== null &&
          purchase.subscriptionState !== undefined &&
          ENTITLED_SUBSCRIPTION_STATES.has(purchase.subscriptionState),
        "failed-precondition",
        "Google Play subscription is not entitled.",
      );

      const matchingItems = (purchase.lineItems ?? []).filter(
        (item) => item.productId === request.productId,
      );
      assertBackend(
        matchingItems.length === 1,
        "permission-denied",
        "Google Play purchase could not be verified.",
      );
      const lineItem = matchingItems[0]!;
      const expiryMs = parseRequiredTime(lineItem.expiryTime);
      const startMs = parseRequiredTime(purchase.startTime);
      assertBackend(
        expiryMs > nowMs && startMs <= nowMs + MAX_CLOCK_SKEW_MS,
        "failed-precondition",
        "Google Play subscription is expired or not yet valid.",
      );

      assertBackend(
        purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId !==
          null &&
          purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId !==
            undefined &&
          acceptedAccountBindings.has(
            purchase.externalAccountIdentifiers.obfuscatedExternalAccountId,
          ),
        "permission-denied",
        "Google Play purchase account binding does not match.",
      );

      const orderId = requiredNonEmpty(lineItem.latestSuccessfulOrderId);
      const order = await this.client.getOrder(this.config.packageName, orderId);
      const orderTimeMs = parseRequiredTime(order.createTime);
      const matchingOrderItems = (order.lineItems ?? []).filter(
        (item) =>
          item.productId === request.productId &&
          item.subscriptionDetails !== undefined &&
          item.subscriptionDetails !== null,
      );
      assertBackend(
        order.orderId === orderId &&
          order.purchaseToken === purchaseToken &&
          order.state === "PROCESSED" &&
          matchingOrderItems.length === 1 &&
          orderTimeMs <= nowMs + MAX_CLOCK_SKEW_MS,
        "permission-denied",
        "Google Play order was refunded, revoked, or does not match.",
      );

      if (purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
        await this.client.acknowledgeSubscription(
          this.config.packageName,
          request.productId,
          purchaseToken,
        );
      } else {
        assertBackend(
          purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
          "permission-denied",
          "Google Play purchase acknowledgement state is invalid.",
        );
      }

      const expiresAt = new Date(expiryMs).toISOString();
      return {
        platform: this.platform,
        productId: request.productId,
        // purchaseToken은 저장/응답하지 않고 불투명한 안정 식별자로만 바꾼다.
        originalTransactionId: googlePlayOriginalTransactionId(
          this.config.packageName,
          purchaseToken,
        ),
        active: true,
        purchasedAt: new Date(orderTimeMs).toISOString(),
        expiresAt,
        environment:
          purchase.testPurchase === undefined || purchase.testPurchase === null
            ? "production"
            : "sandbox",
        authorityObservation: {
          startedAt: authorityObservationStartedAt.toISOString(),
          observedAt: now.toISOString(),
        },
        ...(predecessor === undefined ? {} : { predecessor }),
        entitlement: {
          plan: "pro",
          source: this.platform,
          validUntil: expiresAt,
        },
      };
    } catch (error) {
      throw publicGooglePlayError(error);
    }
  }
}

function linkedPurchasePredecessor(
  packageName: string,
  linkedPurchaseToken: string | null | undefined,
) {
  if (linkedPurchaseToken === null || linkedPurchaseToken === undefined) {
    return undefined;
  }
  assertBackend(
    linkedPurchaseToken.length > 0 && linkedPurchaseToken.length <= 4_096,
    "permission-denied",
    "Google Play linked purchase identity is invalid.",
  );
  return googlePlayReceiptIdentity(packageName, linkedPurchaseToken);
}

function parseRequiredTime(value: string | null | undefined): number {
  const timestamp = value === null || value === undefined ? Number.NaN : Date.parse(value);
  assertBackend(
    Number.isFinite(timestamp),
    "permission-denied",
    "Google Play purchase contains invalid timestamps.",
  );
  return timestamp;
}

function requiredNonEmpty(value: string | null | undefined): string {
  assertBackend(
    typeof value === "string" && value.length > 0,
    "permission-denied",
    "Google Play purchase does not contain an authoritative order.",
  );
  return value;
}

function publicGooglePlayError(error: unknown): BackendError {
  if (error instanceof BackendError) return error;
  if (error instanceof StoreApiFailure) {
    switch (error.kind) {
      case "invalid-receipt":
      case "not-found":
        return new BackendError(
          "permission-denied",
          "Google Play purchase could not be verified.",
        );
      case "configuration":
        return new BackendError(
          "failed-precondition",
          "Google Play receipt verification is not configured.",
        );
      case "unavailable":
        break;
    }
  }
  return new BackendError(
    "internal",
    "Google Play receipt verification is temporarily unavailable.",
  );
}
