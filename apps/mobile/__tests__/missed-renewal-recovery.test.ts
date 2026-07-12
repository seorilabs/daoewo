import type {DaoewoEntitlementState} from '@daoewo/product-ui';

import {
  createMissedRenewalEntitlementReader,
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

describe('missed renewal entitlement recovery', () => {
  it('Free 응답에서 구성 상품을 한 번만 서버 재검증해 Pro를 복구한다', async () => {
    const getServerEntitlement = jest.fn(async () => FREE);
    const getStoreReady = jest.fn(async () => undefined);
    const getAvailablePurchases = jest.fn(async () => [
      {productId: 'monthly', opaqueReceipt: 'RAW_TOKEN_A'},
      {productId: 'monthly', opaqueReceipt: 'RAW_TOKEN_DUPLICATE'},
      {productId: 'unconfigured', opaqueReceipt: 'RAW_TOKEN_UNKNOWN'},
    ]);
    const verifyPurchase = jest.fn(async () => PRO);
    const readEntitlement = createMissedRenewalEntitlementReader({
      getCurrentUser: () => ({uid: 'user-a', isAnonymous: false}),
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
    // 같은 세션의 이후 명시적 서버 Free는 존중하되 store 재검증은 반복하지 않는다.
    await expect(readEntitlement()).resolves.toEqual(FREE);

    expect(getServerEntitlement).toHaveBeenCalledTimes(3);
    expect(getStoreReady).toHaveBeenCalledTimes(1);
    expect(getAvailablePurchases).toHaveBeenCalledTimes(1);
    expect(verifyPurchase).toHaveBeenCalledTimes(1);
    expect(verifyPurchase).toHaveBeenCalledWith(
      expect.objectContaining({productId: 'monthly'}),
    );
  });

  it('server/store/config/verify 실패는 예외 대신 기존 Free로 fallback한다', async () => {
    const serverFailureStore = jest.fn(async () => []);
    const serverFailure = createMissedRenewalEntitlementReader({
      getCurrentUser: () => ({uid: 'user-a', isAnonymous: false}),
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
      getCurrentUser: () => ({uid: 'user-a', isAnonymous: false}),
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
      getCurrentUser: () => ({uid: 'user-a', isAnonymous: false}),
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
      getCurrentUser: () => ({uid: 'user-a', isAnonymous: false}),
      getServerEntitlement: async () => FREE,
      getStoreReady: async () => undefined,
      getAvailablePurchases: async () => [{productId: 'monthly'}],
      verifyPurchase: async () => {
        throw new Error('server rejected receipt');
      },
      configuredProductIds: ['monthly'],
      freeEntitlement: FREE,
    });
    await expect(verifyFailure()).resolves.toEqual(FREE);
  });

  it('익명 사용자는 server와 store 복구 경계를 호출하지 않는다', async () => {
    const getServerEntitlement = jest.fn(async () => FREE);
    const getAvailablePurchases = jest.fn(async () => [
      {productId: 'monthly'},
    ]);
    const verifyPurchase = jest.fn(async () => PRO);
    const readEntitlement = createMissedRenewalEntitlementReader({
      getCurrentUser: () => ({uid: 'anonymous-a', isAnonymous: true}),
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

  it('계정 전환 시 UID별로 한 번씩 복구하고 이전 UID 결과를 섞지 않는다', async () => {
    let currentUser: RenewalRecoveryUser = {
      uid: 'user-a',
      isAnonymous: false,
    };
    const verifiedUids: string[] = [];
    const getAvailablePurchases = jest.fn(async () => [
      {productId: 'monthly'},
    ]);
    const verifyPurchase = jest.fn(async () => {
      verifiedUids.push(currentUser.uid);
      return {...PRO, source: `recovered-${currentUser.uid}`};
    });
    const readEntitlement = createMissedRenewalEntitlementReader({
      getCurrentUser: () => currentUser,
      getServerEntitlement: async () => FREE,
      getStoreReady: async () => undefined,
      getAvailablePurchases,
      verifyPurchase,
      configuredProductIds: ['monthly'],
      freeEntitlement: FREE,
    });

    await expect(readEntitlement()).resolves.toEqual({
      ...PRO,
      source: 'recovered-user-a',
    });
    currentUser = {uid: 'user-b', isAnonymous: false};
    await expect(readEntitlement()).resolves.toEqual({
      ...PRO,
      source: 'recovered-user-b',
    });
    currentUser = {uid: 'user-a', isAnonymous: false};
    await expect(readEntitlement()).resolves.toEqual(FREE);

    expect(verifiedUids).toEqual(['user-a', 'user-b']);
    expect(getAvailablePurchases).toHaveBeenCalledTimes(2);
    expect(verifyPurchase).toHaveBeenCalledTimes(2);
  });

  it('store 조회 중 계정이 바뀌면 이전 UID purchase를 새 UID로 검증하지 않는다', async () => {
    let currentUser: RenewalRecoveryUser = {
      uid: 'user-a',
      isAnonymous: false,
    };
    let resolvePurchases!: (purchases: readonly {productId: string}[]) => void;
    const purchases = new Promise<readonly {productId: string}[]>(resolve => {
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
    currentUser = {uid: 'user-b', isAnonymous: false};
    resolvePurchases([{productId: 'monthly'}]);

    await expect(pending).resolves.toEqual(FREE);
    expect(verifyPurchase).not.toHaveBeenCalled();
  });
});
