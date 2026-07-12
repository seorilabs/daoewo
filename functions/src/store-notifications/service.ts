import type { Clock } from "../domain/types.js";
import { BackendError, assertBackend } from "../errors.js";
import type {
  AppStoreSubscriptionNotification,
  GooglePlaySubscriptionNotification,
  StoreNotificationApplyResult,
  StoreNotificationRepository,
  StoreSubscriptionStateProvider,
  VerifiedStoreSubscriptionNotification,
} from "./types.js";

export class StoreNotificationService {
  constructor(
    private readonly repository: StoreNotificationRepository,
    private readonly googlePlay: StoreSubscriptionStateProvider<GooglePlaySubscriptionNotification>,
    private readonly appStore: StoreSubscriptionStateProvider<AppStoreSubscriptionNotification>,
    private readonly clock: Clock,
  ) {}

  async process(
    notification: VerifiedStoreSubscriptionNotification,
  ): Promise<StoreNotificationApplyResult> {
    try {
      return await this.processOnce(notification);
    } catch (error) {
      if (!isReceiptBindingRace(error)) throw error;
    }
    try {
      return await this.processOnce(notification);
    } catch (error) {
      if (!isReceiptBindingRace(error)) throw error;
      throw new BackendError(
        "aborted",
        "Receipt binding changed while processing a store notification.",
        { kind: "receipt-binding-race" },
      );
    }
  }

  private async processOnce(
    notification: VerifiedStoreSubscriptionNotification,
  ): Promise<StoreNotificationApplyResult> {
    const claim = await this.repository.resolveReceiptClaimForNotification({
      fingerprint: notification.receiptFingerprint,
      platform: notification.platform,
      now: this.clock.now(),
    });
    if (claim.kind === "missing") {
      // Repository가 먼저 durable authority barrier를 원자 생성했다. direct
      // verification은 claim만 만들고 Pro grant를 보류하며, 이 transport는
      // claim이 보일 때까지 retry한 뒤 store 현재 상태로 barrier를 해제한다.
      throw pendingReceiptClaim();
    }
    if (claim.kind === "superseded") {
      // 교체된 old token은 store API를 다시 조회하지 않고 영구 ACK한다.
      return { outcome: "superseded", uid: null };
    }
    if (claim.kind === "account-deleted") {
      return { outcome: "account-deleted", uid: null };
    }
    assertBackend(
      claim.platform === notification.platform &&
        claim.originalTransactionId === notification.originalTransactionId,
      "failed-precondition",
      "Store notification does not match its receipt claim.",
    );

    const state =
      notification.platform === "google-play"
        ? await this.googlePlay.getState(notification, claim)
        : await this.appStore.getState(notification, claim);
    assertBackend(
      state.platform === notification.platform &&
        (state.productId === claim.productId ||
          notification.platform === "app-store") &&
        state.originalTransactionId === claim.originalTransactionId,
      "failed-precondition",
      "Authoritative subscription state does not match its receipt claim.",
    );
    const result = await this.repository.applyAuthoritativeSubscriptionState({
      notification,
      expectedClaim: claim,
      state,
      now: this.clock.now(),
    });
    if (result.outcome === "missing") throw pendingReceiptClaim();
    return result;
  }
}

function pendingReceiptClaim(): BackendError {
  return new BackendError(
    "aborted",
    "Store notification arrived before its verified receipt claim.",
    { kind: "receipt-claim-pending" },
  );
}

function isReceiptBindingRace(error: unknown): boolean {
  if (!(error instanceof BackendError)) return false;
  const kind = error.details?.kind;
  return kind === "account-merged" || kind === "receipt-binding-conflict";
}
