import { BackendError, assertBackend } from "../errors.js";
import {
  appStoreAccountBinding,
  resolveReceiptBindingUids,
  StoreApiFailure,
  type ReceiptAccountBindingResolver,
  type ReceiptVerificationProvider,
  type ReceiptVerificationRequest,
  type VerifiedStoreReceipt,
} from "./providers.js";

const APP_STORE_STATUS_ACTIVE = 1;
const APP_STORE_STATUS_BILLING_GRACE_PERIOD = 4;
const AUTO_RENEWABLE_SUBSCRIPTION = "Auto-Renewable Subscription";
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export type AppStoreEnvironment = "production" | "sandbox";

export interface AppStoreDecodedTransaction {
  transactionId?: string;
  originalTransactionId?: string;
  bundleId?: string;
  productId?: string;
  purchaseDate?: number;
  expiresDate?: number;
  type?: string;
  appAccountToken?: string;
  environment?: string;
  revocationDate?: number;
  revocationReason?: number;
  revocationType?: string;
  revocationPercentage?: number;
  isUpgraded?: boolean;
}

export interface AppStoreDecodedRenewalInfo {
  originalTransactionId?: string;
  productId?: string;
  appAccountToken?: string;
  environment?: string;
  gracePeriodExpiresDate?: number;
}

export interface AppStoreDecodedNotificationData {
  environment?: string;
  appAppleId?: number;
  bundleId?: string;
  signedTransactionInfo?: string;
  signedRenewalInfo?: string;
  status?: number;
}

export interface AppStoreDecodedNotification {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  version?: string;
  signedDate?: number;
  data?: AppStoreDecodedNotificationData;
}

export interface AppStoreLastTransaction {
  status?: number;
  originalTransactionId?: string;
  signedTransactionInfo?: string;
  signedRenewalInfo?: string;
}

export interface AppStoreSubscriptionStatusResponse {
  environment?: string;
  bundleId?: string;
  appAppleId?: number;
  lastTransactions: readonly AppStoreLastTransaction[];
}

export interface AppStoreEnvironmentClient {
  readonly environment: AppStoreEnvironment;
  getTransactionInfo(transactionId: string): Promise<string>;
  getAllSubscriptionStatuses(
    transactionId: string,
  ): Promise<AppStoreSubscriptionStatusResponse>;
  verifyTransaction(signedTransactionInfo: string): Promise<AppStoreDecodedTransaction>;
  verifyRenewalInfo(
    signedRenewalInfo: string,
  ): Promise<AppStoreDecodedRenewalInfo>;
}

export interface AppStoreNotificationEnvironmentClient
  extends AppStoreEnvironmentClient {
  verifyNotification(
    signedPayload: string,
  ): Promise<AppStoreDecodedNotification>;
}

export interface AppStoreReceiptUtility {
  extractTransactionId(receiptData: string): string | null;
}

export interface AppStoreReceiptProviderConfig {
  bundleId: string;
  appAppleId: number;
  productIds: ReadonlySet<string>;
}

export class AppStoreReceiptVerificationProvider
  implements ReceiptVerificationProvider
{
  readonly platform = "app-store" as const;

  constructor(
    private readonly production: AppStoreEnvironmentClient,
    private readonly sandbox: AppStoreEnvironmentClient,
    private readonly receiptUtility: AppStoreReceiptUtility,
    private readonly config: AppStoreReceiptProviderConfig,
    private readonly bindingResolver: ReceiptAccountBindingResolver,
    private readonly now: () => Date,
  ) {}

  async verify(request: ReceiptVerificationRequest): Promise<VerifiedStoreReceipt> {
    try {
      assertBackend(
        request.platform === this.platform,
        "invalid-argument",
        "An App Store transaction is required.",
      );
      assertBackend(
        this.config.productIds.has(request.productId),
        "permission-denied",
        "App Store purchase could not be verified.",
      );
      const bindingUids = await resolveReceiptBindingUids(
        this.bindingResolver,
        request.uid,
      );
      const acceptedAccountBindings = new Set(
        bindingUids.map((uid) =>
          appStoreAccountBinding(this.config.bundleId, uid).toLowerCase(),
        ),
      );
      const transactionId = this.resolveTransactionId(request);
      const { client, signedTransactionInfo } = await this.lookupTransaction(
        transactionId,
      );
      const initialTransaction = await client.verifyTransaction(signedTransactionInfo);
      const expectedEnvironment = appleEnvironment(client.environment);
      validateTransaction(
        initialTransaction,
        {
          bundleId: this.config.bundleId,
          productId: request.productId,
          accountBindings: acceptedAccountBindings,
          environment: expectedEnvironment,
        },
        false,
      );
      assertBackend(
        initialTransaction.transactionId === transactionId ||
          initialTransaction.originalTransactionId === transactionId,
        "permission-denied",
        "App Store transaction identifier does not match.",
      );
      const originalTransactionId = requiredString(
        initialTransaction.originalTransactionId,
      );

      const authorityObservationStartedAt = this.now();
      const statusResponse = await client.getAllSubscriptionStatuses(transactionId);
      const authorityObservedAt = this.now();
      assertBackend(
        statusResponse.bundleId === this.config.bundleId &&
          statusResponse.environment === expectedEnvironment &&
          (client.environment === "sandbox" ||
            statusResponse.appAppleId === this.config.appAppleId),
        "permission-denied",
        "App Store subscription status does not match this app.",
      );
      const matchingStatuses = statusResponse.lastTransactions.filter(
        (item) => item.originalTransactionId === originalTransactionId,
      );
      assertBackend(
        matchingStatuses.length === 1,
        "permission-denied",
        "App Store subscription status is ambiguous or missing.",
      );
      const latest = matchingStatuses[0]!;
      const latestSignedTransaction = requiredString(latest.signedTransactionInfo);
      const latestTransaction = await client.verifyTransaction(
        latestSignedTransaction,
      );
      validateTransaction(
        latestTransaction,
        {
          bundleId: this.config.bundleId,
          productId: request.productId,
          accountBindings: acceptedAccountBindings,
          environment: expectedEnvironment,
          originalTransactionId,
        },
        true,
      );

      const nowMs = authorityObservedAt.getTime();
      assertBackend(
        Number.isFinite(nowMs),
        "internal",
        "App Store receipt verification is unavailable.",
      );
      const purchaseDate = requiredTimestamp(latestTransaction.purchaseDate);
      assertBackend(
        purchaseDate <= nowMs + MAX_CLOCK_SKEW_MS,
        "permission-denied",
        "App Store transaction purchase date is invalid.",
      );

      let entitlementExpiry: number;
      if (latest.status === APP_STORE_STATUS_ACTIVE) {
        entitlementExpiry = requiredTimestamp(latestTransaction.expiresDate);
      } else if (latest.status === APP_STORE_STATUS_BILLING_GRACE_PERIOD) {
        const signedRenewalInfo = requiredString(latest.signedRenewalInfo);
        const renewalInfo = await client.verifyRenewalInfo(signedRenewalInfo);
        assertBackend(
          renewalInfo.originalTransactionId === originalTransactionId &&
            renewalInfo.productId === request.productId &&
            renewalInfo.appAccountToken !== undefined &&
            acceptedAccountBindings.has(
              renewalInfo.appAccountToken.toLowerCase(),
            ) &&
            renewalInfo.environment === expectedEnvironment,
          "permission-denied",
          "App Store renewal information does not match.",
        );
        entitlementExpiry = requiredTimestamp(renewalInfo.gracePeriodExpiresDate);
      } else {
        throw new BackendError(
          "failed-precondition",
          "App Store subscription is expired, revoked, or not entitled.",
        );
      }
      assertBackend(
        entitlementExpiry > nowMs,
        "failed-precondition",
        "App Store subscription is expired.",
      );

      const expiresAt = new Date(entitlementExpiry).toISOString();
      return {
        platform: this.platform,
        productId: request.productId,
        originalTransactionId,
        active: true,
        purchasedAt: new Date(purchaseDate).toISOString(),
        expiresAt,
        environment: client.environment,
        authorityObservation: {
          startedAt: authorityObservationStartedAt.toISOString(),
          observedAt: authorityObservedAt.toISOString(),
        },
        entitlement: {
          plan: "pro",
          source: this.platform,
          validUntil: expiresAt,
        },
      };
    } catch (error) {
      throw publicAppStoreError(error);
    }
  }

  private resolveTransactionId(request: ReceiptVerificationRequest): string {
    const extracted =
      request.receiptData === undefined
        ? undefined
        : this.receiptUtility.extractTransactionId(request.receiptData);
    if (request.receiptData !== undefined) {
      assertBackend(
        extracted !== null && extracted !== undefined && extracted.length > 0,
        "permission-denied",
        "App Store receipt does not contain a transaction identifier.",
      );
    }
    assertBackend(
      request.transactionId === undefined ||
        extracted === undefined ||
        request.transactionId === extracted,
      "permission-denied",
      "App Store receipt and transaction identifier do not match.",
    );
    const transactionId = request.transactionId ?? extracted;
    assertBackend(
      typeof transactionId === "string" && transactionId.length > 0,
      "invalid-argument",
      "An App Store transaction identifier is required.",
    );
    return transactionId;
  }

  private async lookupTransaction(transactionId: string): Promise<{
    client: AppStoreEnvironmentClient;
    signedTransactionInfo: string;
  }> {
    try {
      return {
        client: this.production,
        signedTransactionInfo: await this.production.getTransactionInfo(transactionId),
      };
    } catch (error) {
      if (!(error instanceof StoreApiFailure) || error.kind !== "not-found") {
        throw error;
      }
    }
    return {
      client: this.sandbox,
      signedTransactionInfo: await this.sandbox.getTransactionInfo(transactionId),
    };
  }
}

function validateTransaction(
  transaction: AppStoreDecodedTransaction,
  expected: {
    bundleId: string;
    productId: string;
    accountBindings: ReadonlySet<string>;
    environment: string;
    originalTransactionId?: string;
  },
  latest: boolean,
): void {
  validateAppStoreTransactionIdentity(transaction, expected, latest);
  assertTransactionNotRevoked(transaction);
}

export function validateAppStoreTransactionIdentity(
  transaction: AppStoreDecodedTransaction,
  expected: {
    bundleId: string;
    productId: string;
    accountBindings: ReadonlySet<string>;
    environment: string;
    originalTransactionId?: string;
  },
  latest: boolean,
): void {
  assertBackend(
    transaction.bundleId === expected.bundleId &&
      transaction.productId === expected.productId &&
      transaction.environment === expected.environment &&
      transaction.type === AUTO_RENEWABLE_SUBSCRIPTION &&
      transaction.appAccountToken !== undefined &&
      expected.accountBindings.has(transaction.appAccountToken.toLowerCase()) &&
      (expected.originalTransactionId === undefined ||
        transaction.originalTransactionId === expected.originalTransactionId) &&
      (!latest || transaction.isUpgraded !== true),
    "permission-denied",
    "App Store transaction does not match the app, product, or account.",
  );
  requiredString(transaction.transactionId);
  requiredString(transaction.originalTransactionId);
}

function assertTransactionNotRevoked(
  transaction: AppStoreDecodedTransaction,
): void {
  assertBackend(
    transaction.revocationDate === undefined &&
      transaction.revocationReason === undefined &&
      transaction.revocationType === undefined &&
      (transaction.revocationPercentage === undefined ||
        transaction.revocationPercentage === 0),
    "failed-precondition",
    "App Store transaction was refunded or revoked.",
  );
}

function requiredString(value: string | undefined): string {
  assertBackend(
    typeof value === "string" && value.length > 0,
    "permission-denied",
    "App Store response is missing authoritative transaction data.",
  );
  return value;
}

function requiredTimestamp(value: number | undefined): number {
  assertBackend(
    typeof value === "number" && Number.isSafeInteger(value) && value > 0,
    "permission-denied",
    "App Store response contains an invalid timestamp.",
  );
  return value;
}

function appleEnvironment(environment: AppStoreEnvironment): string {
  return environment === "production" ? "Production" : "Sandbox";
}

function publicAppStoreError(error: unknown): BackendError {
  if (error instanceof BackendError) return error;
  if (error instanceof StoreApiFailure) {
    switch (error.kind) {
      case "invalid-receipt":
      case "not-found":
        return new BackendError(
          "permission-denied",
          "App Store purchase could not be verified.",
        );
      case "configuration":
        return new BackendError(
          "failed-precondition",
          "App Store receipt verification is not configured.",
        );
      case "unavailable":
        break;
    }
  }
  return new BackendError(
    "internal",
    "App Store receipt verification is temporarily unavailable.",
  );
}
