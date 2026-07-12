import type { Entitlement } from "@daoewo/product-core";
import { createHash } from "node:crypto";
import { BackendError, assertBackend } from "../errors.js";
import { sha256 } from "../utils/hash.js";

export type ReceiptPlatform = "google-play" | "app-store" | "apps-in-toss";

export interface AuthorityObservationWindow {
  startedAt: string;
  observedAt: string;
}

export interface ReceiptVerificationRequest {
  uid: string;
  platform: ReceiptPlatform;
  productId: string;
  purchaseToken?: string;
  receiptData?: string;
  transactionId?: string;
  packageName?: string;
  orderId?: string;
  sku?: string;
  subscriptionId?: string;
}

export interface VerifiedStoreReceipt {
  platform: ReceiptPlatform;
  productId: string;
  originalTransactionId: string;
  active: boolean;
  purchasedAt: string;
  expiresAt: string;
  environment: "sandbox" | "production";
  authorityObservation?: AuthorityObservationWindow;
  entitlement: Entitlement;
}

export interface ReceiptVerificationProvider {
  readonly platform: ReceiptPlatform;
  verify(request: ReceiptVerificationRequest): Promise<VerifiedStoreReceipt>;
}

export interface ReceiptAccountBindingResolver {
  /** 현재 uid와 서버에서 검증된 과거 merge source uid만 반환한다. */
  resolveBindingUids(uid: string): Promise<readonly string[]>;
}

export async function resolveReceiptBindingUids(
  resolver: ReceiptAccountBindingResolver,
  uid: string,
): Promise<readonly string[]> {
  const values = await resolver.resolveBindingUids(uid);
  assertBackend(
    values.length >= 1 &&
      values.length <= 51 &&
      values.includes(uid) &&
      values.every((value) => value.length >= 1 && value.length <= 128) &&
      new Set(values).size === values.length,
    "failed-precondition",
    "Receipt account binding policy is invalid.",
  );
  return values;
}

export type StoreApiFailureKind =
  | "invalid-receipt"
  | "not-found"
  | "configuration"
  | "unavailable";

/**
 * Store SDK/API의 원본 오류나 credential을 서비스/응답에 노출하지 않기 위한 경계다.
 * 런타임 adapter는 vendor 오류를 이 제한된 분류로만 변환한다.
 */
export class StoreApiFailure extends Error {
  constructor(readonly kind: StoreApiFailureKind) {
    super(kind);
    this.name = "StoreApiFailure";
  }
}

export class UnconfiguredReceiptVerificationProvider
  implements ReceiptVerificationProvider
{
  constructor(readonly platform: ReceiptPlatform) {}

  async verify(_request: ReceiptVerificationRequest): Promise<VerifiedStoreReceipt> {
    throw new BackendError(
      "failed-precondition",
      `${this.platform} receipt verification provider is not configured.`,
    );
  }
}

export class ReceiptProviderRegistry {
  private readonly providers: ReadonlyMap<ReceiptPlatform, ReceiptVerificationProvider>;

  constructor(providers: readonly ReceiptVerificationProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.platform, provider]));
  }

  get(platform: ReceiptPlatform): ReceiptVerificationProvider {
    return (
      this.providers.get(platform) ?? new UnconfiguredReceiptVerificationProvider(platform)
    );
  }
}

/** BillingFlowParams.setObfuscatedAccountId에 전달할 64자 비식별 계정 키다. */
export function googlePlayAccountBinding(packageName: string, uid: string): string {
  return sha256(`daoewo:google-play:${packageName}:${uid}`);
}

/** StoreKit appAccountToken에 전달할 결정적 UUID v5다. */
export function appStoreAccountBinding(bundleId: string, uid: string): string {
  const namespace = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
  const digest = createHash("sha1")
    .update(namespace)
    .update(`daoewo:app-store:${bundleId}:${uid}`, "utf8")
    .digest();
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export const failClosedReceiptProviders = new ReceiptProviderRegistry([
  new UnconfiguredReceiptVerificationProvider("google-play"),
  new UnconfiguredReceiptVerificationProvider("app-store"),
  new UnconfiguredReceiptVerificationProvider("apps-in-toss"),
]);
