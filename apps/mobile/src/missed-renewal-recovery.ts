import type {DaoewoEntitlementState} from '@daoewo/product-ui';

export interface RenewalRecoveryUser {
  readonly uid: string;
  readonly isAnonymous: boolean;
}

export interface RenewalRecoveryPurchase {
  readonly productId: string;
}

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
}): () => Promise<DaoewoEntitlementState> {
  const configuredProductIds = new Set(
    input.configuredProductIds
      .map(productId => productId.trim())
      .filter(productId => productId.length > 0),
  );
  const attemptedUids = new Set<string>();
  const recoveryInFlightByUid = new Map<
    string,
    Promise<DaoewoEntitlementState>
  >();

  function isCurrentNonAnonymousUser(uid: string): boolean {
    const current = input.getCurrentUser();
    return current?.uid === uid && current.isAnonymous === false;
  }

  async function recover(
    uid: string,
    fallback: DaoewoEntitlementState,
  ): Promise<DaoewoEntitlementState> {
    try {
      if (
        configuredProductIds.size === 0 ||
        !isCurrentNonAnonymousUser(uid)
      ) {
        return fallback;
      }
      await input.getStoreReady();
      if (!isCurrentNonAnonymousUser(uid)) {
        return fallback;
      }
      const purchases = await input.getAvailablePurchases();
      if (!isCurrentNonAnonymousUser(uid)) {
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
        if (!isCurrentNonAnonymousUser(uid)) {
          return fallback;
        }
        try {
          const recovered = await input.verifyPurchase(purchase);
          if (!isCurrentNonAnonymousUser(uid)) {
            return fallback;
          }
          if (recovered.plan === 'pro') {
            return recovered;
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

  return async () => {
    const user = input.getCurrentUser();
    if (user === null || user.isAnonymous) {
      return input.freeEntitlement;
    }

    let serverEntitlement: DaoewoEntitlementState;
    try {
      serverEntitlement = await input.getServerEntitlement();
    } catch {
      return input.freeEntitlement;
    }
    if (!isCurrentNonAnonymousUser(user.uid)) {
      return input.freeEntitlement;
    }
    if (serverEntitlement.plan === 'pro') {
      return serverEntitlement;
    }

    const inFlight = recoveryInFlightByUid.get(user.uid);
    if (inFlight !== undefined) {
      return inFlight;
    }
    if (attemptedUids.has(user.uid)) {
      // 이후의 명시적 서버 Free 응답은 권위 상태로 존중한다.
      return serverEntitlement;
    }
    attemptedUids.add(user.uid);
    const recovery = recover(user.uid, serverEntitlement).finally(() => {
      recoveryInFlightByUid.delete(user.uid);
    });
    recoveryInFlightByUid.set(user.uid, recovery);
    return recovery;
  };
}
