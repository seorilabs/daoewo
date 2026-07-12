import type { DaoewoEntitlementState } from '@daoewo/product-ui';

import {
  createMissedRenewalEntitlementReader,
  createRenewalRecoveryAuthSessionTracker,
  isSameRenewalRecoveryAuthSession,
  type RenewalRecoveryUser,
} from '../src/missed-renewal-recovery';

const FREE: DaoewoEntitlementState = {
  plan: 'free',
  source: 'test-free',
  validUntil: null,
};
const PRO: DaoewoEntitlementState = {
  plan: 'pro',
  source: 'test-store-recovery',
  validUntil: '2026-08-12T00:00:00.000Z',
};
const USER_A_SESSION = {};
const USER_B_SESSION = {};
const ANONYMOUS_SESSION = {};

describe('missed renewal entitlement recovery', () => {
  it('token refresh User 교체에는 세대를 유지하고 실제 Auth 전환에서만 회전한다', () => {
    const tracker = createRenewalRecoveryAuthSessionTracker({
      uid: 'user-a',
      isAnonymous: false,
    });
    const first = tracker.snapshot({ uid: 'user-a', isAnonymous: false });

    // RNFirebase auth_id_token_changed는 같은 UID의 새 User/Proxy를 만든다.
    const refreshed = tracker.snapshot({ uid: 'user-a', isAnonymous: false });
    expect(refreshed?.authSession).toBe(first?.authSession);
    expect(isSameRenewalRecoveryAuthSession(first!, refreshed)).toBe(true);

    tracker.observe(null);
    tracker.observe({ uid: 'user-a', isAnonymous: false });
    const signedInAgain = tracker.snapshot({
      uid: 'user-a',
      isAnonymous: false,
    });
    expect(signedInAgain?.authSession).not.toBe(first?.authSession);
    expect(isSameRenewalRecoveryAuthSession(first!, signedInAgain)).toBe(false);

    tracker.observe({ uid: 'user-a', isAnonymous: true });
    const linkedState = tracker.snapshot({
      uid: 'user-a',
      isAnonymous: true,
    });
    expect(linkedState?.authSession).not.toBe(signedInAgain?.authSession);
  });

  it('Free 응답에서 구성 상품을 한 번만 서버 재검증해 Pro를 복구한다', async () => {
    const getServerEntitlement = jest
      .fn()
      .mockResolvedValueOnce(FREE)
      .mockResolvedValueOnce(PRO)
      .mockResolvedValueOnce(FREE);
    const getStoreReady = jest.fn(async () => undefined);
    const getAvailablePurchases = jest.fn(async () => [
      { productId: 'monthly', opaqueReceipt: 'RAW_TOKEN_A' },
      { productId: 'monthly', opaqueReceipt: 'RAW_TOKEN_DUPLICATE' },
      { productId: 'unconfigured', opaqueReceipt: 'RAW_TOKEN_UNKNOWN' },
    ]);
    const verifyPurchase = jest.fn(async () => PRO);
    const readEntitlement = createMissedRenewalEntitlementReader({
      getCurrentUser: () => ({
        uid: 'user-a',
        isAnonymous: false,
        authSession: USER_A_SESSION,
      }),
      getServerEntitlement,
      getStoreReady,
      getAvailablePurchases,
      verifyPurchase,
      configuredProductIds: ['monthly', 'annual'],
      freeEntitlement: FREE,
    });

    await expect(
      Promise.all([readEntitlement(), readEntitlement()]),
    ).resolves.toEqual([PRO, PRO]);
    expect(getServerEntitlement).toHaveBeenCalledTimes(2);
    // 같은 세션의 이후 명시적 서버 Free는 존중하되 store 재검증은 반복하지 않는다.
    await expect(readEntitlement()).resolves.toEqual(FREE);

    expect(getServerEntitlement).toHaveBeenCalledTimes(3);
    expect(getStoreReady).toHaveBeenCalledTimes(1);
    expect(getAvailablePurchases).toHaveBeenCalledTimes(1);
    expect(verifyPurchase).toHaveBeenCalledTimes(1);
    expect(verifyPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'monthly' }),
    );
  });

  it('server/store/config/verify 실패는 예외 대신 기존 Free로 fallback한다', async () => {
    const serverFailureStore = jest.fn(async () => []);
    const serverFailure = createMissedRenewalEntitlementReader({
      getCurrentUser: () => ({
        uid: 'user-a',
        isAnonymous: false,
        authSession: USER_A_SESSION,
      }),
      getServerEntitlement: async () => {
        throw new Error('network unavailable');
      },
      getStoreReady: async () => undefined,
      getAvailablePurchases: serverFailureStore,
      verifyPurchase: async () => PRO,
      configuredProductIds: ['monthly'],
      freeEntitlement: FREE,
    });
    await expect(serverFailure()).resolves.toEqual(FREE);
    expect(serverFailureStore).not.toHaveBeenCalled();

    const emptyConfigStore = jest.fn(async () => []);
    const emptyConfig = createMissedRenewalEntitlementReader({
      getCurrentUser: () => ({
        uid: 'user-a',
        isAnonymous: false,
        authSession: USER_A_SESSION,
      }),
      getServerEntitlement: async () => FREE,
      getStoreReady: async () => undefined,
      getAvailablePurchases: emptyConfigStore,
      verifyPurchase: async () => PRO,
      configuredProductIds: ['', '   '],
      freeEntitlement: FREE,
    });
    await expect(emptyConfig()).resolves.toEqual(FREE);
    expect(emptyConfigStore).not.toHaveBeenCalled();

    const storeFailure = createMissedRenewalEntitlementReader({
      getCurrentUser: () => ({
        uid: 'user-a',
        isAnonymous: false,
        authSession: USER_A_SESSION,
      }),
      getServerEntitlement: async () => FREE,
      getStoreReady: async () => undefined,
      getAvailablePurchases: async () => {
        throw new Error('store unavailable');
      },
      verifyPurchase: async () => PRO,
      configuredProductIds: ['monthly'],
      freeEntitlement: FREE,
    });
    await expect(storeFailure()).resolves.toEqual(FREE);

    const verifyFailure = createMissedRenewalEntitlementReader({
      getCurrentUser: () => ({
        uid: 'user-a',
        isAnonymous: false,
        authSession: USER_A_SESSION,
      }),
      getServerEntitlement: async () => FREE,
      getStoreReady: async () => undefined,
      getAvailablePurchases: async () => [{ productId: 'monthly' }],
      verifyPurchase: async () => {
        throw new Error('server rejected receipt');
      },
      configuredProductIds: ['monthly'],
      freeEntitlement: FREE,
    });
    await expect(verifyFailure()).resolves.toEqual(FREE);
  });

  it('일시적 verify 실패는 같은 세션에서 cooldown 뒤 다시 복구한다', async () => {
    let now = 1_000;
    let authoritative = FREE;
    const verifyPurchase = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary store failure'))
      .mockImplementationOnce(async () => {
        authoritative = PRO;
        return PRO;
      });
    const readEntitlement = createMissedRenewalEntitlementReader({
      getCurrentUser: () => ({
        uid: 'user-a',
        isAnonymous: false,
        authSession: USER_A_SESSION,
      }),
      getServerEntitlement: async () => authoritative,
      getStoreReady: async () => undefined,
      getAvailablePurchases: async () => [{ productId: 'monthly' }],
      verifyPurchase,
      configuredProductIds: ['monthly'],
      freeEntitlement: FREE,
      nowMs: () => now,
    });

    await expect(readEntitlement()).resolves.toEqual(FREE);
    await expect(readEntitlement()).resolves.toEqual(FREE);
    expect(verifyPurchase).toHaveBeenCalledTimes(1);

    now += 5 * 60_000;
    await expect(readEntitlement()).resolves.toEqual(PRO);
    expect(verifyPurchase).toHaveBeenCalledTimes(2);
  });

  it('익명 사용자는 server와 store 복구 경계를 호출하지 않는다', async () => {
    const getServerEntitlement = jest.fn(async () => FREE);
    const getAvailablePurchases = jest.fn(async () => [
      { productId: 'monthly' },
    ]);
    const verifyPurchase = jest.fn(async () => PRO);
    const readEntitlement = createMissedRenewalEntitlementReader({
      getCurrentUser: () => ({
        uid: 'anonymous-a',
        isAnonymous: true,
        authSession: ANONYMOUS_SESSION,
      }),
      getServerEntitlement,
      getStoreReady: async () => undefined,
      getAvailablePurchases,
      verifyPurchase,
      configuredProductIds: ['monthly'],
      freeEntitlement: FREE,
    });

    await expect(readEntitlement()).resolves.toEqual(FREE);
    expect(getServerEntitlement).not.toHaveBeenCalled();
    expect(getAvailablePurchases).not.toHaveBeenCalled();
    expect(verifyPurchase).not.toHaveBeenCalled();
  });

  it('계정 전환 시 Auth session별로 복구하고 같은 UID 재로그인을 막지 않는다', async () => {
    const userASecondSession = {};
    let currentUser: RenewalRecoveryUser = {
      uid: 'user-a',
      isAnonymous: false,
      authSession: USER_A_SESSION,
    };
    const sessionNames = new Map<object, string>([
      [USER_A_SESSION, 'user-a-first'],
      [USER_B_SESSION, 'user-b'],
      [userASecondSession, 'user-a-second'],
    ]);
    const verifiedSessions: string[] = [];
    const serverEntitlements = new Map<object, DaoewoEntitlementState>();
    const getAvailablePurchases = jest.fn(async () => [
      { productId: 'monthly' },
    ]);
    const verifyPurchase = jest.fn(async () => {
      const sessionName = sessionNames.get(currentUser.authSession)!;
      verifiedSessions.push(sessionName);
      const recovered = { ...PRO, source: `recovered-${sessionName}` };
      serverEntitlements.set(currentUser.authSession, recovered);
      return recovered;
    });
    const readEntitlement = createMissedRenewalEntitlementReader({
      getCurrentUser: () => currentUser,
      getServerEntitlement: async () =>
        serverEntitlements.get(currentUser.authSession) ?? FREE,
      getStoreReady: async () => undefined,
      getAvailablePurchases,
      verifyPurchase,
      configuredProductIds: ['monthly'],
      freeEntitlement: FREE,
    });

    await expect(readEntitlement()).resolves.toEqual({
      ...PRO,
      source: 'recovered-user-a-first',
    });
    currentUser = {
      uid: 'user-b',
      isAnonymous: false,
      authSession: USER_B_SESSION,
    };
    await expect(readEntitlement()).resolves.toEqual({
      ...PRO,
      source: 'recovered-user-b',
    });
    currentUser = {
      uid: 'user-a',
      isAnonymous: false,
      authSession: userASecondSession,
    };
    await expect(readEntitlement()).resolves.toEqual({
      ...PRO,
      source: 'recovered-user-a-second',
    });

    expect(verifiedSessions).toEqual([
      'user-a-first',
      'user-b',
      'user-a-second',
    ]);
    expect(getAvailablePurchases).toHaveBeenCalledTimes(3);
    expect(verifyPurchase).toHaveBeenCalledTimes(3);
  });

  it('verify 내부에서 Auth가 왕복해도 다른 UID의 Pro 결과를 상속하지 않는다', async () => {
    let currentUser: RenewalRecoveryUser = {
      uid: 'user-a',
      isAnonymous: false,
      authSession: USER_A_SESSION,
    };
    let releaseAuthRead!: () => void;
    const authReadRelease = new Promise<void>(resolve => {
      releaseAuthRead = resolve;
    });
    let notifyVerifyStarted!: () => void;
    const verifyStarted = new Promise<void>(resolve => {
      notifyVerifyStarted = resolve;
    });
    let notifyAuthCaptured!: () => void;
    const authCaptured = new Promise<void>(resolve => {
      notifyAuthCaptured = resolve;
    });
    let releaseVerifyResult!: () => void;
    const verifyResultRelease = new Promise<void>(resolve => {
      releaseVerifyResult = resolve;
    });
    const getServerEntitlement = jest.fn(async () => FREE);
    const verifyPurchase = jest.fn(async () => {
      notifyVerifyStarted();
      await authReadRelease;
      const verifiedUid = currentUser.uid;
      notifyAuthCaptured();
      await verifyResultRelease;
      return { ...PRO, source: `recovered-${verifiedUid}` };
    });
    const readEntitlement = createMissedRenewalEntitlementReader({
      getCurrentUser: () => currentUser,
      getServerEntitlement,
      getStoreReady: async () => undefined,
      getAvailablePurchases: async () => [{ productId: 'monthly' }],
      verifyPurchase,
      configuredProductIds: ['monthly'],
      freeEntitlement: FREE,
    });

    const pending = readEntitlement();
    await verifyStarted;
    currentUser = {
      uid: 'user-b',
      isAnonymous: false,
      authSession: USER_B_SESSION,
    };
    releaseAuthRead();
    await authCaptured;
    currentUser = {
      uid: 'user-a',
      isAnonymous: false,
      authSession: {},
    };
    releaseVerifyResult();

    await expect(pending).resolves.toEqual(FREE);
    expect(verifyPurchase).toHaveBeenCalledTimes(1);
    expect(getServerEntitlement).toHaveBeenCalledTimes(1);
  });

  it('store 조회 중 계정이 바뀌면 이전 UID purchase를 새 UID로 검증하지 않는다', async () => {
    let currentUser: RenewalRecoveryUser = {
      uid: 'user-a',
      isAnonymous: false,
      authSession: USER_A_SESSION,
    };
    let resolvePurchases!: (
      purchases: readonly { productId: string }[],
    ) => void;
    const purchases = new Promise<readonly { productId: string }[]>(resolve => {
      resolvePurchases = resolve;
    });
    const verifyPurchase = jest.fn(async () => PRO);
    const readEntitlement = createMissedRenewalEntitlementReader({
      getCurrentUser: () => currentUser,
      getServerEntitlement: async () => FREE,
      getStoreReady: async () => undefined,
      getAvailablePurchases: () => purchases,
      verifyPurchase,
      configuredProductIds: ['monthly'],
      freeEntitlement: FREE,
    });

    const pending = readEntitlement();
    await Promise.resolve();
    await Promise.resolve();
    currentUser = {
      uid: 'user-b',
      isAnonymous: false,
      authSession: USER_B_SESSION,
    };
    resolvePurchases([{ productId: 'monthly' }]);

    await expect(pending).resolves.toEqual(FREE);
    expect(verifyPurchase).not.toHaveBeenCalled();
  });
});
