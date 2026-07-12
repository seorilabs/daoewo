import { sha256 } from "../utils/hash.js";

export function receiptFingerprint(
  platform: "google-play" | "app-store" | "apps-in-toss",
  originalTransactionId: string,
): string {
  return sha256(`${platform}:${originalTransactionId}`);
}

export function googlePlayOriginalTransactionId(
  packageName: string,
  purchaseToken: string,
): string {
  return sha256(`google-play:${packageName}:${purchaseToken}`);
}

export function googlePlayReceiptFingerprint(
  packageName: string,
  purchaseToken: string,
): string {
  return receiptFingerprint(
    "google-play",
    googlePlayOriginalTransactionId(packageName, purchaseToken),
  );
}

export function appStoreReceiptFingerprint(originalTransactionId: string): string {
  return receiptFingerprint("app-store", originalTransactionId);
}
