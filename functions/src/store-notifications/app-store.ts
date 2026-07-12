import { assertBackend } from "../errors.js";
import {
  validateAppStoreTransactionIdentity,
  type AppStoreDecodedNotification,
  type AppStoreDecodedTransaction,
  type AppStoreEnvironment,
  type AppStoreEnvironmentClient,
  type AppStoreNotificationEnvironmentClient,
} from "../receipts/app-store-provider.js";
import {
  appStoreAccountBinding,
  resolveReceiptBindingUids,
  StoreApiFailure,
  type ReceiptAccountBindingResolver,
} from "../receipts/providers.js";
import { appStoreReceiptFingerprint } from "../receipts/fingerprint.js";
import type {
  AppStoreSubscriptionNotification,
  AuthoritativeSubscriptionState,
  ReceiptClaimResolution,
  StoreSubscriptionStateProvider,
  VerifiedStoreNotificationEnvelope,
} from "./types.js";

const AUTO_RENEWABLE_SUBSCRIPTION = "Auto-Renewable Subscription";
const STATUS_ACTIVE = 1;
const STATUS_EXPIRED = 2;
const STATUS_BILLING_RETRY = 3;
const STATUS_BILLING_GRACE_PERIOD = 4;
const STATUS_REVOKED = 5;
const MAX_SIGNED_PAYLOAD_LENGTH = 256 * 1_024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export interface AppStoreNotificationConfig {
  bundleId: string;
  appAppleId: number;
  productIds: ReadonlySet<string>;
}

export function parseAppStoreNotificationRequest(body: unknown): string {
  assertBackend(
    body !== null && typeof body === "object" && !Array.isArray(body),
    "invalid-argument",
    "App Store notification body is invalid.",
  );
  const signedPayload = (body as Record<string, unknown>).signedPayload;
  assertBackend(
    typeof signedPayload === "string" &&
      signedPayload.length > 0 &&
      signedPayload.length <= MAX_SIGNED_PAYLOAD_LENGTH,
    "invalid-argument",
    "App Store signedPayload is invalid.",
  );
  return signedPayload;
}

export class AppStoreNotificationVerifier {
  constructor(
    private readonly production: AppStoreNotificationEnvironmentClient,
    private readonly sandbox: AppStoreNotificationEnvironmentClient,
    private readonly config: AppStoreNotificationConfig,
  ) {}

  async verify(signedPayload: string): Promise<VerifiedStoreNotificationEnvelope> {
    const { client, notification } = await this.verifyEnvironment(signedPayload);
    const notificationType = requiredString(notification.notificationType);
    const eventId = requiredString(notification.notificationUUID);
    const signedDate = requiredTimestamp(notification.signedDate);
    assertBackend(
      notification.version === "2.0",
      "permission-denied",
      "App Store notification version is unsupported.",
    );
    if (notificationType === "TEST") {
      return { kind: "test", platform: "app-store", eventId };
    }
    const data = notification.data;
    if (data?.signedTransactionInfo === undefined) {
      return { kind: "ignored", platform: "app-store", eventId };
    }
    const transaction = await client.verifyTransaction(data.signedTransactionInfo);
    const expectedEnvironment = appleEnvironment(client.environment);
    assertBackend(
      data.bundleId === this.config.bundleId &&
        data.environment === expectedEnvironment &&
        (client.environment === "sandbox" ||
          data.appAppleId === this.config.appAppleId) &&
        transaction.bundleId === this.config.bundleId &&
        transaction.environment === expectedEnvironment &&
        transaction.type === AUTO_RENEWABLE_SUBSCRIPTION,
      "permission-denied",
      "App Store notification does not match this app.",
    );
    const productId = requiredString(transaction.productId);
    if (!this.config.productIds.has(productId)) {
      return { kind: "ignored", platform: "app-store", eventId };
    }
    const transactionId = requiredString(transaction.transactionId);
    const originalTransactionId = requiredString(
      transaction.originalTransactionId,
    );
    // account binding은 claim UID를 찾은 뒤 authoritative status의 latest JWS로 재검증한다.
    requiredString(transaction.appAccountToken);
    return {
      kind: "subscription",
      notification: {
        platform: "app-store",
        eventType: "subscription.status_changed",
        notificationType,
        ...(notification.subtype === undefined
          ? {}
          : { subtype: notification.subtype }),
        environment: client.environment,
        transactionId,
        productId,
        originalTransactionId,
        receiptFingerprint: appStoreReceiptFingerprint(originalTransactionId),
        cursor: {
          eventId,
          occurredAt: new Date(signedDate).toISOString(),
        },
      },
    };
  }

  private async verifyEnvironment(signedPayload: string): Promise<{
    client: AppStoreNotificationEnvironmentClient;
    notification: AppStoreDecodedNotification;
  }> {
    try {
      return {
        client: this.production,
        notification: await this.production.verifyNotification(signedPayload),
      };
    } catch (error) {
      // Production verifier의 OCSP/network 오류에는 sandbox fallback을 하지 않는다.
      if (!(error instanceof StoreApiFailure) || error.kind !== "invalid-receipt") {
        throw error;
      }
    }
    return {
      client: this.sandbox,
      notification: await this.sandbox.verifyNotification(signedPayload),
    };
  }
}

export class AppStoreAuthoritativeStateProvider
  implements StoreSubscriptionStateProvider<AppStoreSubscriptionNotification>
{
  readonly platform = "app-store" as const;

  constructor(
    private readonly production: AppStoreEnvironmentClient,
    private readonly sandbox: AppStoreEnvironmentClient,
    private readonly config: AppStoreNotificationConfig,
    private readonly bindingResolver: ReceiptAccountBindingResolver,
    private readonly now: () => Date,
  ) {}

  async getState(
    notification: AppStoreSubscriptionNotification,
    claim: Extract<ReceiptClaimResolution, { kind: "claimed" }>,
  ): Promise<AuthoritativeSubscriptionState> {
    assertBackend(
      claim.platform === this.platform &&
        claim.originalTransactionId === notification.originalTransactionId &&
        this.config.productIds.has(claim.productId) &&
        this.config.productIds.has(notification.productId),
      "permission-denied",
      "App Store notification does not match its receipt claim.",
    );
    const client =
      notification.environment === "production" ? this.production : this.sandbox;
    const expectedEnvironment = appleEnvironment(client.environment);
    const bindingUids = await resolveReceiptBindingUids(
      this.bindingResolver,
      claim.uid,
    );
    const acceptedBindings = new Set(
      bindingUids.map((uid) =>
        appStoreAccountBinding(this.config.bundleId, uid).toLowerCase(),
      ),
    );

    const authorityObservationStartedAt = this.now();
    let response;
    try {
      response = await client.getAllSubscriptionStatuses(
        notification.originalTransactionId,
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
    assertBackend(
      response.bundleId === this.config.bundleId &&
        response.environment === expectedEnvironment &&
        (client.environment === "sandbox" ||
          response.appAppleId === this.config.appAppleId),
      "permission-denied",
      "App Store subscription status does not match this app.",
    );
    const matching = response.lastTransactions.filter(
      (item) => item.originalTransactionId === notification.originalTransactionId,
    );
    assertBackend(
      matching.length === 1,
      "permission-denied",
      "App Store subscription status is ambiguous or missing.",
    );
    const latest = matching[0]!;
    const status = requiredInteger(latest.status);
    const transaction = await client.verifyTransaction(
      requiredString(latest.signedTransactionInfo),
    );
    const authoritativeProductId = requiredString(transaction.productId);
    assertBackend(
      this.config.productIds.has(authoritativeProductId),
      "permission-denied",
      "App Store subscription product is not allowlisted.",
    );
    validateAppStoreTransactionIdentity(
      transaction,
      {
        bundleId: this.config.bundleId,
        productId: authoritativeProductId,
        accountBindings: acceptedBindings,
        environment: expectedEnvironment,
        originalTransactionId: notification.originalTransactionId,
      },
      status === STATUS_ACTIVE || status === STATUS_BILLING_GRACE_PERIOD,
    );
    const nowMs = authorityObservedAt.getTime();
    assertBackend(
      Number.isFinite(nowMs),
      "internal",
      "App Store subscription state is unavailable.",
    );
    const purchaseDate = requiredTimestamp(transaction.purchaseDate);
    assertBackend(
      purchaseDate <= nowMs + MAX_CLOCK_SKEW_MS,
      "permission-denied",
      "App Store transaction purchase date is invalid.",
    );

    if (status === STATUS_ACTIVE) {
      const expiry = requiredTimestamp(transaction.expiresDate);
      if (isRevoked(transaction)) {
        return inactiveAppleState(
          claim,
          authoritativeProductId,
          authorityObservation,
          status,
          client.environment,
          expiry,
          "revoked",
        );
      }
      if (expiry <= nowMs) {
        return inactiveAppleState(
          claim,
          authoritativeProductId,
          authorityObservation,
          status,
          client.environment,
          expiry,
          "expired",
        );
      }
      return activeAppleState(
        claim,
        authoritativeProductId,
        authorityObservation,
        status,
        client.environment,
        purchaseDate,
        expiry,
      );
    }
    if (status === STATUS_BILLING_GRACE_PERIOD) {
      const renewal = await client.verifyRenewalInfo(
        requiredString(latest.signedRenewalInfo),
      );
      assertBackend(
        renewal.originalTransactionId === notification.originalTransactionId &&
          renewal.productId === authoritativeProductId &&
          renewal.environment === expectedEnvironment &&
          renewal.appAccountToken !== undefined &&
          acceptedBindings.has(renewal.appAccountToken.toLowerCase()),
        "permission-denied",
        "App Store renewal information does not match its receipt claim.",
      );
      const graceExpiry = requiredTimestamp(renewal.gracePeriodExpiresDate);
      if (graceExpiry <= nowMs) {
        return inactiveAppleState(
          claim,
          authoritativeProductId,
          authorityObservation,
          status,
          client.environment,
          graceExpiry,
          "expired",
        );
      }
      return activeAppleState(
        claim,
        authoritativeProductId,
        authorityObservation,
        status,
        client.environment,
        purchaseDate,
        graceExpiry,
      );
    }

    const expiry = optionalTimestamp(transaction.expiresDate);
    switch (status) {
      case STATUS_EXPIRED:
        return inactiveAppleState(
          claim,
          authoritativeProductId,
          authorityObservation,
          status,
          client.environment,
          expiry,
          "expired",
        );
      case STATUS_BILLING_RETRY:
        return inactiveAppleState(
          claim,
          authoritativeProductId,
          authorityObservation,
          status,
          client.environment,
          expiry,
          "billing-retry",
        );
      case STATUS_REVOKED:
        return inactiveAppleState(
          claim,
          authoritativeProductId,
          authorityObservation,
          status,
          client.environment,
          expiry,
          "revoked",
        );
      default:
        assertBackend(
          false,
          "permission-denied",
          "App Store subscription status is unsupported.",
        );
    }
  }
}

function activeAppleState(
  claim: Extract<ReceiptClaimResolution, { kind: "claimed" }>,
  productId: string,
  authorityObservation: { startedAt: string; observedAt: string },
  status: number,
  environment: AppStoreEnvironment,
  purchaseDate: number,
  expiry: number,
): AuthoritativeSubscriptionState {
  const validUntil = new Date(expiry).toISOString();
  return {
    active: true,
    platform: "app-store",
    productId,
    originalTransactionId: claim.originalTransactionId,
    environment,
    storeState: String(status),
    authorityObservation,
    purchasedAt: new Date(purchaseDate).toISOString(),
    validUntil,
    entitlement: { plan: "pro", source: "app-store", validUntil },
  };
}

function inactiveAppleState(
  claim: Extract<ReceiptClaimResolution, { kind: "claimed" }>,
  productId: string,
  authorityObservation: { startedAt: string; observedAt: string },
  status: number,
  environment: AppStoreEnvironment,
  expiry: number | null,
  reason: "expired" | "revoked" | "billing-retry",
): AuthoritativeSubscriptionState {
  return {
    active: false,
    platform: "app-store",
    productId,
    originalTransactionId: claim.originalTransactionId,
    environment,
    storeState: String(status),
    authorityObservation,
    reason,
    lastKnownExpiry: expiry === null ? null : new Date(expiry).toISOString(),
    entitlement: { plan: "free", source: "app-store", validUntil: null },
  };
}

function isRevoked(transaction: AppStoreDecodedTransaction): boolean {
  return (
    transaction.revocationDate !== undefined ||
    transaction.revocationReason !== undefined ||
    transaction.revocationType !== undefined ||
    (transaction.revocationPercentage !== undefined &&
      transaction.revocationPercentage > 0)
  );
}

function appleEnvironment(environment: AppStoreEnvironment): string {
  return environment === "production" ? "Production" : "Sandbox";
}

function requiredString(value: string | undefined): string {
  assertBackend(
    typeof value === "string" && value.length > 0,
    "permission-denied",
    "App Store notification is missing required signed data.",
  );
  return value;
}

function requiredInteger(value: number | undefined): number {
  assertBackend(
    typeof value === "number" && Number.isSafeInteger(value),
    "permission-denied",
    "App Store notification status is invalid.",
  );
  return value;
}

function requiredTimestamp(value: number | undefined): number {
  assertBackend(
    typeof value === "number" && Number.isSafeInteger(value) && value > 0,
    "permission-denied",
    "App Store notification timestamp is invalid.",
  );
  return value;
}

function optionalTimestamp(value: number | undefined): number | null {
  if (value === undefined) return null;
  return requiredTimestamp(value);
}
