import {
  IAP,
  appLogin,
  type SubscriptionProductListItem,
} from '@apps-in-toss/framework';
import type { DaoewoEntitlementState, DaoewoStorage } from '@daoewo/product-ui';
import type { PublishedDeckContent } from '@daoewo/product-catalog/bundled-free-content';
import { classifySwipe, createInitialCardProgress, toDateKey } from '@daoewo/product-core';

import {
  createAppsInTossBackend,
  createAppsInTossRuntime,
  createStableDeviceIdProvider,
  mapAppsInTossPurchaseOffer,
  type AppsInTossBackend,
} from './runtime';

const mockNativeStorage = new Map<string, string>();
const originalFetch = global.fetch;

jest.mock('@apps-in-toss/framework', () => ({
  IAP: {
    completeProductGrant: jest.fn(),
    createSubscriptionPurchaseOrder: jest.fn(),
    getPendingOrders: jest.fn(),
    getProductItemList: jest.fn(),
  },
  Storage: {
    getItem: jest.fn(async (key: string) => mockNativeStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockNativeStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockNativeStorage.delete(key);
    }),
  },
  appLogin: jest.fn(),
  eventLog: jest.fn(),
  getOperationalEnvironment: jest.fn(() => 'production'),
  isMinVersionSupported: jest.fn(() => true),
}));

const FREE: DaoewoEntitlementState = {
  plan: 'free',
  source: 'test',
  validUntil: null,
};

const mockedIap = IAP as unknown as {
  readonly completeProductGrant: jest.Mock;
  readonly createSubscriptionPurchaseOrder: jest.Mock;
  readonly getPendingOrders: jest.Mock;
  readonly getProductItemList: jest.Mock;
};
const mockedAppLogin = appLogin as jest.Mock;

function fakeBackend(overrides: Partial<AppsInTossBackend> = {}): AppsInTossBackend {
  return {
    getCurrentUser: jest.fn(async () => null),
    signInWithToss: jest.fn(async () => {
      throw new Error('not configured');
    }),
    signOut: jest.fn(async () => undefined),
    deleteAccount: jest.fn(async () => undefined),
    getEntitlement: jest.fn(async () => FREE),
    verifySubscriptionOrder: jest.fn(async () => {
      throw new Error('not verified');
    }),
    request: jest.fn(async () => {
      throw new Error('not configured');
    }),
    ...overrides,
  } as unknown as AppsInTossBackend;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function bundledDeck(deckId: string, cardCount: number): PublishedDeckContent {
  const cards = Array.from({ length: cardCount }, (_, index) => ({
    id: `${deckId}-card-${index}`,
    deckId,
    index,
    front: `front ${index}`,
    back: `back ${index}`,
    tags: [],
    difficulty: 1 as const,
    sourceRefs: ['approved-test-source'],
  }));
  return {
    deckId,
    version: 1,
    chunkSize: 200,
    cardCount,
    publishedAt: '2026-07-12T00:00:00.000Z',
    publicationDigest: `sha256:${'a'.repeat(64)}`,
    chunks: [{
      chunkIndex: 0,
      checksum: `sha256:${'b'.repeat(64)}`,
      cards,
    }],
  };
}

describe('AppsInToss runtime security boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNativeStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('공개 카탈로그는 준비 중/null만 노출하고 본문 접근을 차단한다', async () => {
    const runtime = createAppsInTossRuntime();
    const catalog = await runtime.content.listCatalog();

    expect(catalog).toHaveLength(14);
    expect(catalog.every((deck) => deck.availability === 'coming-soon' && deck.cardCount === null)).toBe(true);
    await expect(
      runtime.content.createGoal({
        deckId: catalog[0]!.id,
        mode: 'days',
        value: 7,
        startDate: '2026-07-12',
      })
    ).rejects.toThrow('승인된 덱 본문');
  });

  it('게스트 Free 덱은 backend 호출 없이 bundle/cache로 목표·window·진도를 처리한다', async () => {
    const backend = fakeBackend();
    const deck = bundledDeck('english-essential-intro', 61);
    const runtime = createAppsInTossRuntime(
      backend,
      undefined,
      {[deck.deckId]: deck},
    );
    await runtime.auth.continueAsGuest();
    const goal = await runtime.content.createGoal({
      deckId: deck.deckId,
      mode: 'daily-count',
      value: 100,
      startDate: toDateKey(runtime.now()),
    });
    const window = await runtime.content.getCardWindow({
      deckId: deck.deckId,
      goalKey: goal.key,
    });
    const progress = classifySwipe(
      createInitialCardProgress(window.cards[0]!.id, deck.deckId, runtime.now()),
      'unknown',
      runtime.now(),
    );
    await runtime.content.commitProgressBatch({
      deckId: deck.deckId,
      goalKey: goal.key,
      windowId: window.id,
      progresses: [progress],
    });

    expect(goal.dailyCount).toBe(60);
    expect(window.cards).toHaveLength(60);
    expect(backend.request).not.toHaveBeenCalled();
    expect([...mockNativeStorage.keys()].some(key =>
      key.includes(encodeURIComponent('ait-local-guest')),
    )).toBe(true);
  });

  it('401 한 번에 ID 토큰과 App Check를 갱신하고 요청을 한 번만 재시도한다', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            firebaseCustomToken: 'custom-token',
            firebaseAppCheckToken: 'app-check-initial',
            appCheckTokenTtlMillis: 3_600_000,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          idToken: 'id-initial',
          refreshToken: 'refresh-initial',
          expiresIn: '3600',
          localId: 'toss_test_user',
        })
      )
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'unauthenticated' } }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id_token: 'id-refreshed',
          refresh_token: 'refresh-refreshed',
          expires_in: '3600',
          user_id: 'toss_test_user',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            firebaseAppCheckToken: 'app-check-refreshed',
            appCheckTokenTtlMillis: 3_600_000,
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { data: { decks: [] } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const backend = createAppsInTossBackend({
      apiBaseUrl: 'https://api.example.test',
      firebaseApiKey: 'public-api-key',
    });
    await backend.signInWithToss({
      authorizationCode: 'one-time-code',
      referrer: 'DEFAULT',
    });
    await expect(backend.request('/v1/catalog', {})).resolves.toEqual({
      decks: [],
    });

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.filter((url) => url.endsWith('/v1/catalog'))).toHaveLength(2);
    expect(urls.filter((url) => url.includes('securetoken.googleapis.com'))).toHaveLength(1);
    expect(urls.filter((url) => url.endsWith('/v1/auth/toss:refreshAppCheck'))).toHaveLength(1);
  });

  it('entitlement envelope은 active Pro일 때만 Pro로 해석한다', async () => {
    const pro: DaoewoEntitlementState = {
      plan: 'pro',
      source: 'apps-in-toss',
      validUntil: '2026-08-12T00:00:00.000Z',
    };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            firebaseCustomToken: 'custom-token',
            firebaseAppCheckToken: 'app-check-initial',
            appCheckTokenTtlMillis: 3_600_000,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          idToken: 'id-initial',
          refreshToken: 'refresh-initial',
          expiresIn: '3600',
          localId: 'toss_test_user',
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { data: { active: true, entitlement: pro } }))
      .mockResolvedValueOnce(
        jsonResponse(200, { data: { active: false, entitlement: pro } })
      ) as unknown as typeof fetch;
    const backend = createAppsInTossBackend({
      apiBaseUrl: 'https://api.example.test',
      firebaseApiKey: 'public-api-key',
    });
    await backend.signInWithToss({
      authorizationCode: 'one-time-code',
      referrer: 'DEFAULT',
    });

    await expect(backend.getEntitlement()).resolves.toEqual(pro);
    await expect(
      backend.verifySubscriptionOrder({
        orderId: 'test-order',
        sku: 'monthly-test-sku',
      })
    ).resolves.toEqual(expect.objectContaining({ plan: 'free' }));
  });

  it('AIT backend 탈퇴는 Identity Toolkit 직접 삭제 대신 권위 서버 endpoint를 호출한다', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            firebaseCustomToken: 'custom-token',
            firebaseAppCheckToken: 'app-check-initial',
            appCheckTokenTtlMillis: 3_600_000,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          idToken: 'id-initial',
          refreshToken: 'refresh-initial',
          expiresIn: '3600',
          localId: 'toss_test_user',
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { data: { deleted: true } }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const backend = createAppsInTossBackend({
      apiBaseUrl: 'https://api.example.test',
      firebaseApiKey: 'public-api-key',
    });
    await backend.signInWithToss({
      authorizationCode: 'one-time-code',
      referrer: 'DEFAULT',
    });

    await backend.deleteAccount();

    expect(String(fetchMock.mock.calls[2]![0])).toBe(
      'https://api.example.test/v1/account:delete',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]![1]?.body))).toEqual({
      confirmation: 'DELETE',
    });
    await expect(backend.getCurrentUser()).resolves.toBeNull();
  });

  it('탈퇴 직전에 Toss를 재인증하고 서버 삭제 성공 후 로컬 상태를 지운다', async () => {
    const user = {
      id: 'toss_test_user',
      displayName: '다외워 사용자',
      isGuest: false,
    };
    const signInWithToss = jest.fn(async () => user);
    const deleteAccount = jest.fn(async () => undefined);
    mockedAppLogin.mockResolvedValue({
      authorizationCode: 'fresh-one-time-code',
      referrer: 'DEFAULT',
    });
    const runtime = createAppsInTossRuntime(
      fakeBackend({
        getCurrentUser: jest.fn(async () => user),
        signInWithToss,
        deleteAccount,
      }),
    );
    await Promise.all([
      runtime.storage.setItem('daoewo:auth:guest', user),
      runtime.storage.setItem('daoewo:device-id:v1', 'device-id'),
      runtime.storage.setItem('daoewo:settings:v1', { ttsEnabled: true }),
      runtime.storage.setItem(
        'daoewo:learning-state:v2:toss_test_user',
        { version: 1 },
      ),
    ]);

    await runtime.auth.deleteAccount();

    expect(mockedAppLogin).toHaveBeenCalledTimes(1);
    expect(signInWithToss).toHaveBeenCalledWith({
      authorizationCode: 'fresh-one-time-code',
      referrer: 'DEFAULT',
    });
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(signInWithToss.mock.invocationCallOrder[0]).toBeLessThan(
      deleteAccount.mock.invocationCallOrder[0]!,
    );
    expect(mockNativeStorage.size).toBe(0);
  });

  it('재인증된 Toss UID가 바뀌면 새 계정을 삭제하지 않고 session을 닫는다', async () => {
    const signOut = jest.fn(async () => undefined);
    const deleteAccount = jest.fn(async () => undefined);
    mockedAppLogin.mockResolvedValue({
      authorizationCode: 'different-user-code',
      referrer: 'DEFAULT',
    });
    const runtime = createAppsInTossRuntime(
      fakeBackend({
        getCurrentUser: jest.fn(async () => ({
          id: 'original-user',
          displayName: '기존 사용자',
          isGuest: false,
        })),
        signInWithToss: jest.fn(async () => ({
          id: 'different-user',
          displayName: '다른 사용자',
          isGuest: false,
        })),
        signOut,
        deleteAccount,
      }),
    );

    await expect(runtime.auth.deleteAccount()).rejects.toThrow(
      '재인증된 토스 계정이 현재 계정과 달라',
    );
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('서버 검증이 실패하면 구독 grant와 complete를 진행하지 않는다', async () => {
    let purchaseHooks:
      | {
          readonly options: {
            readonly processProductGrant: (input: {
              readonly orderId: string;
              readonly subscriptionId?: string;
            }) => Promise<boolean>;
          };
          readonly onEvent: () => Promise<void>;
        }
      | undefined;
    mockedIap.getProductItemList.mockResolvedValue({
      products: [
        {
          type: 'SUBSCRIPTION',
          sku: 'monthly-test-sku',
          renewalCycle: 'MONTHLY',
          offers: [{ type: 'FREE_TRIAL', offerId: 'trial-test-offer' }],
        },
      ],
    });
    mockedIap.createSubscriptionPurchaseOrder.mockImplementation((hooks: typeof purchaseHooks) => {
      purchaseHooks = hooks;
      return jest.fn();
    });
    mockedIap.getPendingOrders.mockResolvedValue({
      orders: [{ orderId: 'pending-test-order', sku: 'monthly-test-sku' }],
    });
    const verifySubscriptionOrder = jest.fn(async () => {
      throw new Error('server rejected');
    });
    const runtime = createAppsInTossRuntime(
      fakeBackend({
        getCurrentUser: jest.fn(async () => ({
          id: 'test-user',
          displayName: '테스트',
          isGuest: false,
        })),
        verifySubscriptionOrder,
      })
    );

    const result = runtime.purchase.purchase('monthly').then(
      () => 'resolved' as const,
      () => 'rejected' as const
    );
    for (let attempt = 0; attempt < 10 && purchaseHooks === undefined; attempt += 1) {
      await Promise.resolve();
    }
    if (purchaseHooks === undefined) {
      throw new Error('purchase hooks were not registered');
    }

    await expect(purchaseHooks.options.processProductGrant({ orderId: 'test-order' })).resolves.toBe(false);
    await purchaseHooks.onEvent();

    expect(await result).toBe('rejected');
    await expect(runtime.purchase.restore()).rejects.toThrow('server rejected');
    expect(verifySubscriptionOrder).toHaveBeenCalledTimes(2);
    expect(mockedIap.completeProductGrant).not.toHaveBeenCalled();
  });

  it('AppsInToss Storage의 device ID를 재사용한다', async () => {
    const values = new Map<string, unknown>();
    const storage: DaoewoStorage = {
      async getItem<T>(key: string) {
        return (values.get(key) as T | undefined) ?? null;
      },
      async setItem<T>(key: string, value: T) {
        values.set(key, value);
      },
      async removeItem(key: string) {
        values.delete(key);
      },
    };

    const firstProvider = createStableDeviceIdProvider(storage);
    const first = await firstProvider();
    const second = await firstProvider();
    const afterRestart = await createStableDeviceIdProvider(storage)();

    expect(first).toMatch(/^[A-Za-z0-9_-]{16,256}$/);
    expect(second).toBe(first);
    expect(afterRestart).toBe(first);
    expect(values.size).toBe(1);
  });

  it('콘솔 현지화 가격과 정확한 무료 체험 기간만 노출한다', () => {
    const monthly: SubscriptionProductListItem = {
      type: 'SUBSCRIPTION',
      sku: 'monthly-test-sku',
      displayAmount: '4,900원',
      displayName: '다외워 Pro 월간',
      iconUrl: 'https://static.toss.im/daoewo.png',
      description: '월간 자동 갱신',
      renewalCycle: 'MONTHLY',
      offers: [
        {type: 'FREE_TRIAL', offerId: 'trial-7d', period: 'P7D'},
      ],
    };
    const annual = {
      ...monthly,
      sku: 'annual-test-sku',
      displayAmount: '39,000원',
      renewalCycle: 'YEARLY',
      offers: [
        {type: 'FREE_TRIAL', offerId: 'trial-month', period: 'P1M'},
      ],
    } satisfies SubscriptionProductListItem;

    expect(mapAppsInTossPurchaseOffer(monthly, 'monthly')).toEqual({
      plan: 'monthly',
      displayPrice: '4,900원',
      periodLabel: '월',
      description: '월간 자동 갱신',
      trialDays: 7,
    });
    expect(mapAppsInTossPurchaseOffer(annual, 'annual')).not.toHaveProperty(
      'trialDays',
    );
  });
});
