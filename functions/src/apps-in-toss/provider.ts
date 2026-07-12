import type { VerifiedStoreReceipt } from "../receipts/providers.js";
import { BackendError } from "../errors.js";

export interface TossLoginExchangeRequest {
  authorizationCode: string;
  referrer: string;
}

// Access/Refresh token과 mTLS credential은 provider 구현 안에서만 사용한다.
// 서비스 계층에는 Firebase uid 파생용 불투명 subject만 반환한다.
export interface TossLoginIdentity {
  subject: string;
}

export interface TossSubscriptionWebhookRequest {
  headers: Readonly<Record<string, string>>;
  rawBody: Buffer;
  body: unknown;
}

export interface VerifiedTossSubscriptionEvent {
  eventId: string;
  eventType: "subscription.status_changed";
  occurredAt: string;
  subscriptionId: string;
  orderId: string;
  sku: string;
  receipt: VerifiedStoreReceipt & { platform: "apps-in-toss" };
}

export interface AppsInTossPartnerProvider {
  exchangeAuthorizationCode(request: TossLoginExchangeRequest): Promise<TossLoginIdentity>;
  verifySubscriptionWebhook(
    request: TossSubscriptionWebhookRequest,
  ): Promise<VerifiedTossSubscriptionEvent>;
}

export class UnconfiguredAppsInTossPartnerProvider
  implements AppsInTossPartnerProvider
{
  async exchangeAuthorizationCode(
    _request: TossLoginExchangeRequest,
  ): Promise<TossLoginIdentity> {
    throw unconfiguredError();
  }

  async verifySubscriptionWebhook(
    _request: TossSubscriptionWebhookRequest,
  ): Promise<VerifiedTossSubscriptionEvent> {
    throw unconfiguredError();
  }
}

export const failClosedAppsInTossPartnerProvider =
  new UnconfiguredAppsInTossPartnerProvider();

function unconfiguredError(): BackendError {
  return new BackendError(
    "failed-precondition",
    "AppsInToss mTLS partner provider is not configured.",
  );
}
