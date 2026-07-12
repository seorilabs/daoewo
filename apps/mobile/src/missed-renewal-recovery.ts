import type { DaoewoEntitlementState } from '@daoewo/product-ui';

export interface RenewalRecoveryUser {
  readonly uid: string;
  readonly isAnonymous: boolean;
  /** token refresh에는 유지되고 실제 Auth 전환에서만 바뀌는 세션 세대다. */
  readonly authSession: object;
}

export interface RenewalRecoveryAuthState {
  readonly uid: string;
  readonly isAnonymous: boolean;
}

export interface RenewalRecoveryAuthSessionTracker {
  observe(user: RenewalRecoveryAuthState | null): void;
  snapshot(user: RenewalRecoveryAuthState | null): RenewalRecoveryUser | null;
}

export function isSameRenewalRecoveryAuthSession(
  expected: RenewalRecoveryUser,
  current: RenewalRecoveryUser | null,
): boolean {
  return (
    current?.uid === expected.uid &&
    current.isAnonymous === false &&
    current.authSession === expected.authSession
  );
}

/**
 * Firebase는 ID token refresh 때 같은 UID의 User 객체를 교체한다. 객체 identity를
 * 직접 세션 키로 사용하지 않고 auth-state의 null/UID/anonymous 전환에서만 세대를
 * 회전해 정상 token refresh와 실제 A -> B -> A 재로그인을 구분한다.
 */
export function createRenewalRecoveryAuthSessionTracker(
  initialUser: RenewalRecoveryAuthState | null,
): RenewalRecoveryAuthSessionTracker {
  let observedUid = initialUser?.uid ?? null;
  let observedAnonymous = initialUser?.isAnonymous ?? null;
  let authSession: object = {};

  function observe(user: RenewalRecoveryAuthState | null): void {
    const uid = user?.uid ?? null;
    const isAnonymous = user?.isAnonymous ?? null;
    if (uid === observedUid && isAnonymous === observedAnonymous) {
      return;
    }
    observedUid = uid;
    observedAnonymous = isAnonymous;
    authSession = {};
  }

  return {
    observe,
    snapshot(user) {
      observe(user);
      return user === null
        ? null
        : {
            uid: user.uid,
            isAnonymous: user.isAnonymous,
            authSession,
          };
    },
  };
}

export interface RenewalRecoveryPurchase {
  readonly productId: string;
}

const RECOVERY_RETRY_COOLDOWN_MS = 5 * 60_000;

/**
 * 서버가 Free를 반환했지만 스토어에는 유효 구독이 남은 missed renewal을 복구한다.
 * 원본 receipt/token은 저장하거나 로그로 보내지 않고 주입된 서버 검증 경계에만 넘긴다.
 */
export function createMissedRenewalEntitlementReader<
  Purchase extends RenewalRecoveryPurchase,
>(input: {
  readonly getCurrentUser: () => RenewalRecoveryUser | null;
  readonly getServerEntitlement: () => Promise<DaoewoEntitlementState>;
  readonly getStoreReady: () => Promise<unknown>;
  readonly getAvailablePurchases: () => Promise<readonly Purchase[]>;
  readonly verifyPurchase: (
    purchase: Purchase,
  ) => Promise<DaoewoEntitlementState>;
  readonly configuredProductIds: readonly string[];
  readonly freeEntitlement: DaoewoEntitlementState;
  readonly nowMs?: () => number;
}): () => Promise<DaoewoEntitlementState> {
  const configuredProductIds = new Set(
    input.configuredProductIds
      .map(productId => productId.trim())
      .filter(productId => productId.length > 0),
  );
  const lastRecoveryAttemptAtBySession = new WeakMap<object, number>();
  const readInFlightBySession = new WeakMap<
    object,
    Promise<DaoewoEntitlementState>
  >();
  const nowMs = input.nowMs ?? Date.now;

  function isCurrentNonAnonymousSession(
    expected: RenewalRecoveryUser,
  ): boolean {
    return isSameRenewalRecoveryAuthSession(expected, input.getCurrentUser());
  }

  async function recover(
    user: RenewalRecoveryUser,
    fallback: DaoewoEntitlementState,
  ): Promise<DaoewoEntitlementState> {
    try {
      if (
        configuredProductIds.size === 0 ||
        !isCurrentNonAnonymousSession(user)
      ) {
        return fallback;
      }
      await input.getStoreReady();
      if (!isCurrentNonAnonymousSession(user)) {
        return fallback;
      }
      const purchases = await input.getAvailablePurchases();
      if (!isCurrentNonAnonymousSession(user)) {
        return fallback;
      }

      // 같은 상품의 중복 transaction을 반복 verify/finish하지 않는다.
      const verifiedProductIds = new Set<string>();
      for (const purchase of purchases) {
        const productId = purchase.productId.trim();
        if (
          !configuredProductIds.has(productId) ||
          verifiedProductIds.has(productId)
        ) {
          continue;
        }
        verifiedProductIds.add(productId);
        if (!isCurrentNonAnonymousSession(user)) {
          return fallback;
        }
        try {
          const recovered = await input.verifyPurchase(purchase);
          if (!isCurrentNonAnonymousSession(user)) {
            return fallback;
          }
          if (recovered.plan === 'pro') {
            // verifyPurchase 내부의 비동기 구간에서 Auth가 다른 UID로 바뀌었다가
            // 돌아오면, 반환값만으로는 어느 계정 권위인지 확정할 수 없다. 현재 UID의
            // 서버 상태를 다시 읽어 첫 verify 결과가 다른 Auth 세션에 상속되지 않게 한다.
            const confirmed = await input.getServerEntitlement();
            if (!isCurrentNonAnonymousSession(user)) {
              return fallback;
            }
            if (confirmed.plan === 'pro') {
              return confirmed;
            }
          }
        } catch {
          // 만료 purchase나 일시적 store/server 오류는 다음 구성 상품을 확인한다.
        }
      }
    } catch {
      // 자동 복구 실패는 startup이나 기존 Free 권한을 차단하지 않는다.
    }
    return fallback;
  }

  async function readForSession(
    user: RenewalRecoveryUser,
  ): Promise<DaoewoEntitlementState> {
    let serverEntitlement: DaoewoEntitlementState;
    try {
      serverEntitlement = await input.getServerEntitlement();
    } catch {
      return input.freeEntitlement;
    }
    if (!isCurrentNonAnonymousSession(user)) {
      return input.freeEntitlement;
    }
    if (serverEntitlement.plan === 'pro') {
      return serverEntitlement;
    }

    let attemptAt: number;
    try {
      attemptAt = nowMs();
    } catch {
      attemptAt = Date.now();
    }
    if (!Number.isFinite(attemptAt)) {
      attemptAt = Date.now();
    }
    const previousAttemptAt = lastRecoveryAttemptAtBySession.get(
      user.authSession,
    );
    if (
      previousAttemptAt !== undefined &&
      attemptAt >= previousAttemptAt &&
      attemptAt - previousAttemptAt < RECOVERY_RETRY_COOLDOWN_MS
    ) {
      return serverEntitlement;
    }
    lastRecoveryAttemptAtBySession.set(user.authSession, attemptAt);
    return recover(user, serverEntitlement);
  }

  return async () => {
    const user = input.getCurrentUser();
    if (user === null || user.isAnonymous) {
      return input.freeEntitlement;
    }
    const inFlight = readInFlightBySession.get(user.authSession);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const operation = readForSession(user).finally(() => {
      if (readInFlightBySession.get(user.authSession) === operation) {
        readInFlightBySession.delete(user.authSession);
      }
    });
    readInFlightBySession.set(user.authSession, operation);
    return operation;
  };
}
