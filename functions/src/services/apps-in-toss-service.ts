import type {
  AppsInTossPartnerProvider,
  TossSubscriptionWebhookRequest,
} from "../apps-in-toss/provider.js";
import type { Clock } from "../domain/types.js";
import { assertBackend } from "../errors.js";
import type {
  AccountAccessRepository,
  AppsInTossIdentityRepository,
  FirebaseAppCheckTokenIssuer,
  FirebaseCustomTokenIssuer,
  ReceiptEntitlementRepository,
} from "../repositories/contracts.js";
import { sha256 } from "../utils/hash.js";
import { BACKEND_CONFIG } from "../config.js";

export interface ExchangeTossLoginInput {
  authorizationCode: string;
  referrer: string;
}

export class AppsInTossService {
  constructor(
    private readonly provider: AppsInTossPartnerProvider,
    private readonly identities: AppsInTossIdentityRepository,
    private readonly accounts: Pick<AccountAccessRepository, "assertAccountActive">,
    private readonly tokenIssuer: FirebaseCustomTokenIssuer,
    private readonly appCheckIssuer: FirebaseAppCheckTokenIssuer,
    private readonly firebaseAppId: string | undefined,
    private readonly entitlements: ReceiptEntitlementRepository,
    private readonly clock: Clock,
  ) {}

  async exchangeLogin(input: ExchangeTossLoginInput, requesterKey: string): Promise<{
    firebaseCustomToken: string;
    firebaseAppCheckToken: string;
    appCheckTokenTtlMillis: number;
  }> {
    assertBackend(
      this.firebaseAppId !== undefined && this.firebaseAppId.length > 0,
      "failed-precondition",
      "AppsInToss Firebase App Check appId is not configured.",
    );
    // authorizationCode는 Toss partner API 교환 전에 일회성으로 claim한다.
    // 교환 실패 시 사용자는 appLogin()으로 새 code를 받아야 한다.
    await this.identities.claimOneTimeAuthorizationCode(
      sha256(input.authorizationCode),
      sha256(requesterKey),
      BACKEND_CONFIG.tossAuthExchangeHourlyLimit,
      this.clock.now(),
    );
    const identity = await this.provider.exchangeAuthorizationCode(input);
    assertBackend(
      identity.subject.length >= 1 && identity.subject.length <= 512,
      "failed-precondition",
      "AppsInToss login subject is invalid.",
    );
    const uid = `toss_${sha256(identity.subject).slice(0, 64)}`;
    // 탈퇴 marker가 남은 deterministic Toss UID는 재가입 불가 정책이다. custom token을
    // 먼저 발급하면 Firebase Auth user만 zombie 상태로 재생성되므로 발급 전에 차단한다.
    await this.accounts.assertAccountActive(uid);
    const [firebaseCustomToken, appCheckToken] = await Promise.all([
      this.tokenIssuer.createCustomToken(uid, {
        signInProvider: "apps-in-toss",
      }),
      this.appCheckIssuer.createToken(this.firebaseAppId),
    ]);
    return {
      firebaseCustomToken,
      firebaseAppCheckToken: appCheckToken.token,
      appCheckTokenTtlMillis: appCheckToken.ttlMillis,
    };
  }

  async refreshAppCheck(
    uid: string,
    signInProvider: unknown,
    requesterKey: string,
  ): Promise<{
    firebaseAppCheckToken: string;
    appCheckTokenTtlMillis: number;
  }> {
    assertBackend(
      signInProvider === "apps-in-toss" && /^toss_[a-f0-9]{64}$/.test(uid),
      "permission-denied",
      "Only AppsInToss authenticated users can refresh this App Check token.",
    );
    assertBackend(
      this.firebaseAppId !== undefined && this.firebaseAppId.length > 0,
      "failed-precondition",
      "AppsInToss Firebase App Check appId is not configured.",
    );
    await this.identities.consumeAppCheckRefreshQuota(
      uid,
      sha256(requesterKey),
      BACKEND_CONFIG.tossAppCheckRefreshHourlyLimit,
      this.clock.now(),
    );
    const appCheckToken = await this.appCheckIssuer.createToken(this.firebaseAppId);
    return {
      firebaseAppCheckToken: appCheckToken.token,
      appCheckTokenTtlMillis: appCheckToken.ttlMillis,
    };
  }

  async processSubscriptionWebhook(request: TossSubscriptionWebhookRequest): Promise<{
    accepted: true;
    eventId: string;
    applied: boolean;
    idempotent: boolean;
  }> {
    const event = await this.provider.verifySubscriptionWebhook(request);
    assertBackend(
      event.eventType === "subscription.status_changed" &&
        event.receipt.platform === "apps-in-toss" &&
        event.receipt.originalTransactionId === event.subscriptionId &&
        event.receipt.productId === event.sku,
      "permission-denied",
      "AppsInToss subscription event verification mismatch.",
    );
    const result = await this.entitlements.applyVerifiedSubscriptionEvent(
      event,
      sha256(`apps-in-toss:${event.subscriptionId}`),
      this.clock.now(),
    );
    // Provider가 inactive/expired event를 검증하면 repository가 entitlement/claims를
    // 함께 회수한다. 클라이언트 grant 상태는 이 흐름에 들어오지 않는다.
    return {
      accepted: true,
      eventId: event.eventId,
      applied: result.applied,
      idempotent: result.idempotent,
    };
  }
}
