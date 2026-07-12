import {
  APIError,
  APIException,
  AppStoreServerAPIClient,
  Environment,
  ReceiptUtility,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
  type JWSTransactionDecodedPayload,
  type JWSRenewalInfoDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { google, type androidpublisher_v3 } from "googleapis";
import { BACKEND_CONFIG } from "../config.js";
import {
  AppStoreReceiptVerificationProvider,
  type AppStoreDecodedNotification,
  type AppStoreDecodedRenewalInfo,
  type AppStoreDecodedTransaction,
  type AppStoreEnvironment,
  type AppStoreEnvironmentClient,
  type AppStoreNotificationEnvironmentClient,
  type AppStoreReceiptUtility,
  type AppStoreSubscriptionStatusResponse,
} from "./app-store-provider.js";
import {
  GooglePlayReceiptVerificationProvider,
  type GooglePlayOrder,
  type GooglePlayPublisherClient,
  type GooglePlaySubscriptionPurchase,
} from "./google-play-provider.js";
import {
  ReceiptProviderRegistry,
  StoreApiFailure,
  UnconfiguredReceiptVerificationProvider,
  type ReceiptVerificationProvider,
  type ReceiptAccountBindingResolver,
} from "./providers.js";

const ANDROID_PUBLISHER_SCOPE =
  "https://www.googleapis.com/auth/androidpublisher";

export class GoogleApisPublisherClient implements GooglePlayPublisherClient {
  private readonly publisher: androidpublisher_v3.Androidpublisher;

  constructor() {
    const auth = new google.auth.GoogleAuth({ scopes: [ANDROID_PUBLISHER_SCOPE] });
    this.publisher = google.androidpublisher({ version: "v3", auth });
  }

  async getSubscription(
    packageName: string,
    purchaseToken: string,
  ): Promise<GooglePlaySubscriptionPurchase> {
    try {
      const response = await this.publisher.purchases.subscriptionsv2.get({
        packageName,
        token: purchaseToken,
      });
      return response.data;
    } catch (error) {
      throw normalizeGoogleApiError(error);
    }
  }

  async getOrder(packageName: string, orderId: string): Promise<GooglePlayOrder> {
    try {
      const response = await this.publisher.orders.get({ packageName, orderId });
      return response.data;
    } catch (error) {
      throw normalizeGoogleApiError(error);
    }
  }

  async acknowledgeSubscription(
    packageName: string,
    productId: string,
    purchaseToken: string,
  ): Promise<void> {
    try {
      await this.publisher.purchases.subscriptions.acknowledge({
        packageName,
        subscriptionId: productId,
        token: purchaseToken,
        requestBody: {},
      });
    } catch (error) {
      throw normalizeGoogleApiError(error);
    }
  }
}

export class AppleServerEnvironmentClient
  implements AppStoreNotificationEnvironmentClient
{
  readonly environment: AppStoreEnvironment;

  constructor(
    environment: Environment,
    private readonly client: AppStoreServerAPIClient,
    private readonly verifier: SignedDataVerifier,
  ) {
    this.environment =
      environment === Environment.PRODUCTION ? "production" : "sandbox";
  }

  async getTransactionInfo(transactionId: string): Promise<string> {
    try {
      const response = await this.client.getTransactionInfo(transactionId);
      if (!response.signedTransactionInfo) {
        throw new StoreApiFailure("invalid-receipt");
      }
      return response.signedTransactionInfo;
    } catch (error) {
      throw normalizeAppleApiError(error);
    }
  }

  async getAllSubscriptionStatuses(
    transactionId: string,
  ): Promise<AppStoreSubscriptionStatusResponse> {
    try {
      const response = await this.client.getAllSubscriptionStatuses(transactionId);
      return {
        ...(response.environment === undefined
          ? {}
          : { environment: response.environment }),
        ...(response.bundleId === undefined ? {} : { bundleId: response.bundleId }),
        ...(response.appAppleId === undefined
          ? {}
          : { appAppleId: response.appAppleId }),
        lastTransactions: (response.data ?? []).flatMap(
          (group) => group.lastTransactions ?? [],
        ),
      };
    } catch (error) {
      throw normalizeAppleApiError(error);
    }
  }

  async verifyTransaction(
    signedTransactionInfo: string,
  ): Promise<AppStoreDecodedTransaction> {
    try {
      return mapAppleTransaction(
        await this.verifier.verifyAndDecodeTransaction(signedTransactionInfo),
      );
    } catch (error) {
      throw normalizeAppleVerificationError(error);
    }
  }

  async verifyRenewalInfo(
    signedRenewalInfo: string,
  ): Promise<AppStoreDecodedRenewalInfo> {
    try {
      return mapAppleRenewal(
        await this.verifier.verifyAndDecodeRenewalInfo(signedRenewalInfo),
      );
    } catch (error) {
      throw normalizeAppleVerificationError(error);
    }
  }

  async verifyNotification(
    signedPayload: string,
  ): Promise<AppStoreDecodedNotification> {
    try {
      return mapAppleNotification(
        await this.verifier.verifyAndDecodeNotification(signedPayload),
      );
    } catch (error) {
      throw normalizeAppleVerificationError(error);
    }
  }
}

class AppleReceiptUtilityAdapter implements AppStoreReceiptUtility {
  private readonly utility = new ReceiptUtility();

  extractTransactionId(receiptData: string): string | null {
    try {
      return this.utility.extractTransactionIdFromAppReceipt(receiptData) ?? null;
    } catch {
      throw new StoreApiFailure("invalid-receipt");
    }
  }
}

export function createReceiptProvidersFromEnvironment(
  bindingResolver: ReceiptAccountBindingResolver,
): ReceiptProviderRegistry {
  return new ReceiptProviderRegistry([
    createGooglePlayProvider(bindingResolver),
    createAppStoreProvider(bindingResolver),
    new UnconfiguredReceiptVerificationProvider("apps-in-toss"),
  ]);
}

function createGooglePlayProvider(
  bindingResolver: ReceiptAccountBindingResolver,
): ReceiptVerificationProvider {
  if (BACKEND_CONFIG.googlePlayProductIds.length === 0) {
    return new UnconfiguredReceiptVerificationProvider("google-play");
  }
  return new GooglePlayReceiptVerificationProvider(
    new GoogleApisPublisherClient(),
    {
      packageName: BACKEND_CONFIG.googlePlayPackageName,
      productIds: new Set(BACKEND_CONFIG.googlePlayProductIds),
    },
    bindingResolver,
    () => new Date(),
  );
}

function createAppStoreProvider(
  bindingResolver: ReceiptAccountBindingResolver,
): ReceiptVerificationProvider {
  try {
    const runtime = createAppleRuntimeClientsFromEnvironment();
    if (runtime === null) {
      return new UnconfiguredReceiptVerificationProvider("app-store");
    }
    return new AppStoreReceiptVerificationProvider(
      runtime.production,
      runtime.sandbox,
      new AppleReceiptUtilityAdapter(),
      runtime.config,
      bindingResolver,
      () => new Date(),
    );
  } catch {
    return new UnconfiguredReceiptVerificationProvider("app-store");
  }
}

export function createAppleRuntimeClientsFromEnvironment(): {
  production: AppStoreNotificationEnvironmentClient;
  sandbox: AppStoreNotificationEnvironmentClient;
  config: {
    bundleId: string;
    appAppleId: number;
    productIds: ReadonlySet<string>;
  };
} | null {
  const issuerId = requiredConfig(BACKEND_CONFIG.appStoreIapIssuerId);
  const keyId = requiredConfig(BACKEND_CONFIG.appStoreIapKeyId);
  const appAppleId = BACKEND_CONFIG.appStoreAppAppleId;
  if (appAppleId === undefined || BACKEND_CONFIG.appStoreProductIds.length === 0) {
    return null;
  }
  const signingKey = decodePrivateKey(
    requiredConfig(process.env.APP_STORE_IAP_PRIVATE_KEY_BASE64),
  );
  const rootCertificates = decodeRootCertificates(
    requiredConfig(process.env.APP_STORE_ROOT_CA_CERTIFICATES_BASE64_JSON),
  );
  return {
    production: createAppleEnvironmentClient({
      environment: Environment.PRODUCTION,
      issuerId,
      keyId,
      signingKey,
      rootCertificates,
      appAppleId,
    }),
    sandbox: createAppleEnvironmentClient({
      environment: Environment.SANDBOX,
      issuerId,
      keyId,
      signingKey,
      rootCertificates,
      appAppleId,
    }),
    config: {
      bundleId: BACKEND_CONFIG.appStoreBundleId,
      appAppleId,
      productIds: new Set(BACKEND_CONFIG.appStoreProductIds),
    },
  };
}

export function createAppleEnvironmentClient(input: {
  environment: Environment;
  issuerId: string;
  keyId: string;
  signingKey: string;
  rootCertificates: Buffer[];
  appAppleId: number;
}): AppStoreNotificationEnvironmentClient {
  return new AppleServerEnvironmentClient(
    input.environment,
    new AppStoreServerAPIClient(
      input.signingKey,
      input.keyId,
      input.issuerId,
      BACKEND_CONFIG.appStoreBundleId,
      input.environment,
    ),
    new SignedDataVerifier(
      input.rootCertificates,
      true,
      input.environment,
      BACKEND_CONFIG.appStoreBundleId,
      input.environment === Environment.PRODUCTION ? input.appAppleId : undefined,
    ),
  );
}

function mapAppleNotification(
  value: ResponseBodyV2DecodedPayload,
): AppStoreDecodedNotification {
  return compact({
    notificationType:
      typeof value.notificationType === "string"
        ? value.notificationType
        : undefined,
    subtype: typeof value.subtype === "string" ? value.subtype : undefined,
    notificationUUID: value.notificationUUID,
    version: value.version,
    signedDate: value.signedDate,
    data:
      value.data === undefined
        ? undefined
        : compact({
            environment:
              typeof value.data.environment === "string"
                ? value.data.environment
                : undefined,
            appAppleId: value.data.appAppleId,
            bundleId: value.data.bundleId,
            signedTransactionInfo: value.data.signedTransactionInfo,
            signedRenewalInfo: value.data.signedRenewalInfo,
            status:
              typeof value.data.status === "number"
                ? value.data.status
                : undefined,
          }),
  }) as AppStoreDecodedNotification;
}

function mapAppleTransaction(
  value: JWSTransactionDecodedPayload,
): AppStoreDecodedTransaction {
  return compact({
    transactionId: value.transactionId,
    originalTransactionId: value.originalTransactionId,
    bundleId: value.bundleId,
    productId: value.productId,
    purchaseDate: value.purchaseDate,
    expiresDate: value.expiresDate,
    type: typeof value.type === "string" ? value.type : undefined,
    appAccountToken: value.appAccountToken,
    environment:
      typeof value.environment === "string" ? value.environment : undefined,
    revocationDate: value.revocationDate,
    revocationReason:
      typeof value.revocationReason === "number" ? value.revocationReason : undefined,
    revocationType:
      typeof value.revocationType === "string" ? value.revocationType : undefined,
    revocationPercentage: value.revocationPercentage,
    isUpgraded: value.isUpgraded,
  }) as AppStoreDecodedTransaction;
}

function mapAppleRenewal(
  value: JWSRenewalInfoDecodedPayload,
): AppStoreDecodedRenewalInfo {
  return compact({
    originalTransactionId: value.originalTransactionId,
    productId: value.productId,
    appAccountToken: value.appAccountToken,
    environment:
      typeof value.environment === "string" ? value.environment : undefined,
    gracePeriodExpiresDate: value.gracePeriodExpiresDate,
  }) as AppStoreDecodedRenewalInfo;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as T;
}

function normalizeGoogleApiError(error: unknown): StoreApiFailure {
  if (error instanceof StoreApiFailure) return error;
  const status = httpStatus(error);
  if (status === 400 || status === 404 || status === 410) {
    return new StoreApiFailure(status === 404 ? "not-found" : "invalid-receipt");
  }
  if (status === 401 || status === 403) {
    return new StoreApiFailure("configuration");
  }
  return new StoreApiFailure("unavailable");
}

export function normalizeAppleApiError(error: unknown): StoreApiFailure {
  if (error instanceof StoreApiFailure) return error;
  if (error instanceof APIException) {
    if (
      error.apiError === APIError.ACCOUNT_NOT_FOUND_RETRYABLE ||
      error.apiError === APIError.APP_NOT_FOUND_RETRYABLE ||
      error.apiError === APIError.ORIGINAL_TRANSACTION_ID_NOT_FOUND_RETRYABLE ||
      error.apiError === APIError.GENERAL_INTERNAL_RETRYABLE ||
      error.apiError === APIError.RATE_LIMIT_EXCEEDED
    ) {
      return new StoreApiFailure("unavailable");
    }
    if (
      error.apiError === APIError.TRANSACTION_ID_NOT_FOUND ||
      error.apiError === APIError.ORIGINAL_TRANSACTION_ID_NOT_FOUND
    ) {
      return new StoreApiFailure("not-found");
    }
    if (error.httpStatusCode === 400 || error.httpStatusCode === 404) {
      return new StoreApiFailure("invalid-receipt");
    }
    if (error.httpStatusCode === 401 || error.httpStatusCode === 403) {
      return new StoreApiFailure("configuration");
    }
  }
  return new StoreApiFailure("unavailable");
}

function normalizeAppleVerificationError(error: unknown): StoreApiFailure {
  if (
    error instanceof VerificationException &&
    error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
  ) {
    return new StoreApiFailure("unavailable");
  }
  return new StoreApiFailure("invalid-receipt");
}

function httpStatus(error: unknown): number | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.code === "number") return record.code;
  const response = record.response;
  if (response !== null && typeof response === "object") {
    const status = (response as Record<string, unknown>).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

function requiredConfig(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new StoreApiFailure("configuration");
  }
  return value.trim();
}

function decodePrivateKey(value: string): string {
  const decoded = Buffer.from(value, "base64").toString("utf8");
  if (!decoded.includes("-----BEGIN PRIVATE KEY-----")) {
    throw new StoreApiFailure("configuration");
  }
  return decoded;
}

function decodeRootCertificates(value: string): Buffer[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new StoreApiFailure("configuration");
  }
  return parsed.map((encoded) => {
    if (typeof encoded !== "string" || encoded.length === 0) {
      throw new StoreApiFailure("configuration");
    }
    const certificate = Buffer.from(encoded, "base64");
    if (certificate.length === 0) {
      throw new StoreApiFailure("configuration");
    }
    return certificate;
  });
}
