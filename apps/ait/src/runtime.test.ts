import { IAP, Storage, appLogin, share, type SubscriptionProductListItem } from '@apps-in-toss/framework';
import type { DaoewoEntitlementState, DaoewoStorage, DaoewoUser } from '@daoewo/product-ui';
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
const TOSS_ACCOUNT_MARKER_KEY = 'daoewo:auth:toss-account:v1';

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
  share: jest.fn(async () => undefined),
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
const mockedShare = share as jest.Mock;
const mockedStorage = Storage as unknown as {
  readonly setItem: jest.Mock;
};

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
    chunks: [
      {
        chunkIndex: 0,
        checksum: `sha256:${'b'.repeat(64)}`,
        cards,
      },
    ],
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

  it('공식 메시지 공유를 사용하고 local 학습 알림은 fail-closed한다', async () => {
    const runtime = createAppsInTossRuntime();

    expect(runtime.sharing.availability).toBe('available');
    await runtime.sharing.shareText({ title: 'ignored', message: '{"version":1}' });
    expect(mockedShare).toHaveBeenCalledWith({ message: '{"version":1}' });

    expect(runtime.tts.availability).toBe('unsupported');
    await expect(runtime.tts.speak('지원하지 않는 음성')).rejects.toThrow(
      'AppsInToss에서는 음성 읽기를 지원하지 않아요.'
    );
    expect(runtime.notifications.availability).toBe('unsupported');
    await expect(
      runtime.notifications.applyPreferences({
        dailyReminder: true,
        reviewReminder: false,
        nextReviewAt: null,
      })
    ).rejects.toThrow('NOTIFICATIONS_UNSUPPORTED');
  });

  it('게스트 Free 덱은 backend 호출 없이 bundle/cache로 목표·window·진도를 처리한다', async () => {
    const backend = fakeBackend();
    const deck = bundledDeck('english-essential-intro', 61);
    const runtime = createAppsInTossRuntime(backend, undefined, { [deck.deckId]: deck });
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
      runtime.now()
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
    expect([...mockNativeStorage.keys()].some((key) => key.includes(encodeURIComponent('ait-local-guest')))).toBe(true);
  });

  it('성공한 Toss 로그인은 UID와 불투명 작업 세대만 저장하고 인증 code/token은 저장하지 않는다', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            firebaseCustomToken: 'firebase-custom-secret',
            firebaseAppCheckToken: 'app-check-secret',
            appCheckTokenTtlMillis: 3_600_000,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          idToken: 'firebase-id-secret',
          refreshToken: 'firebase-refresh-secret',
          expiresIn: '3600',
          localId: 'toss_marker_user',
        })
      );
    global.fetch = fetchMock as unknown as typeof fetch;
    mockedAppLogin.mockResolvedValue({
      authorizationCode: 'one-time-authorization-secret',
      referrer: 'DEFAULT',
    });
    const runtime = createAppsInTossRuntime(
      createAppsInTossBackend({
        apiBaseUrl: 'https://api.example.test',
        firebaseApiKey: 'public-api-key',
      })
    );

    await expect(runtime.auth.signIn('toss')).resolves.toEqual(expect.objectContaining({ id: 'toss_marker_user' }));

    expect([...mockNativeStorage.keys()]).toEqual([TOSS_ACCOUNT_MARKER_KEY]);
    expect(JSON.parse(mockNativeStorage.get(TOSS_ACCOUNT_MARKER_KEY)!)).toEqual({
      uid: 'toss_marker_user',
      operationId: expect.stringMatching(/^toss-login_/),
    });
    const stored = JSON.stringify([...mockNativeStorage.entries()]);
    expect(stored).not.toMatch(
      /one-time-authorization-secret|firebase-custom-secret|app-check-secret|firebase-id-secret|firebase-refresh-secret|authorizationCode|idToken|refreshToken/i
    );

    await runtime.auth.signOut();
    expect(mockNativeStorage.has(TOSS_ACCOUNT_MARKER_KEY)).toBe(false);
  });

  it('account marker 저장 실패 시 생성된 backend session을 닫고 로그인 완료로 보지 않는다', async () => {
    const user: DaoewoUser = {
      id: 'marker-write-failure-user',
      displayName: '저장 실패 사용자',
      isGuest: false,
    };
    const signOut = jest.fn(async () => undefined);
    const backend = fakeBackend({
      signInWithToss: jest.fn(async () => user),
      signOut,
    });
    mockedAppLogin.mockResolvedValue({
      authorizationCode: 'one-time-code',
      referrer: 'DEFAULT',
    });
    mockedStorage.setItem.mockRejectedValueOnce(new Error('storage full'));
    const runtime = createAppsInTossRuntime(backend);

    await expect(runtime.auth.signIn('toss')).rejects.toThrow('storage full');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(mockNativeStorage.has(TOSS_ACCOUNT_MARKER_KEY)).toBe(false);
  });

  it('로그인 marker write와 sign-out을 직렬화해 marker를 남기지 않는다', async () => {
    const user: DaoewoUser = {
      id: 'late-marker-user',
      displayName: '늦은 marker 사용자',
      isGuest: false,
    };
    let currentUser: DaoewoUser | null = null;
    let notifyMarkerWriteStarted!: () => void;
    const markerWriteStarted = new Promise<void>((resolve) => {
      notifyMarkerWriteStarted = resolve;
    });
    let releaseMarkerWrite!: () => void;
    const markerWriteRelease = new Promise<void>((resolve) => {
      releaseMarkerWrite = resolve;
    });
    mockedStorage.setItem.mockImplementationOnce(async (key: string, value: string) => {
      notifyMarkerWriteStarted();
      await markerWriteRelease;
      mockNativeStorage.set(key, value);
    });
    mockedAppLogin.mockResolvedValue({
      authorizationCode: 'late-marker-code',
      referrer: 'DEFAULT',
    });
    const runtime = createAppsInTossRuntime(
      fakeBackend({
        getCurrentUser: jest.fn(async () => currentUser),
        signInWithToss: jest.fn(async () => {
          currentUser = user;
          return user;
        }),
        signOut: jest.fn(async () => {
          currentUser = null;
        }),
      })
    );

    const signingIn = runtime.auth.signIn('toss');
    await markerWriteStarted;
    const signingOut = runtime.auth.signOut();
    releaseMarkerWrite();

    await expect(signingIn).resolves.toEqual(user);
    await signingOut;
    expect(mockNativeStorage.has(TOSS_ACCOUNT_MARKER_KEY)).toBe(false);
    await expect(runtime.auth.getCurrentUser()).resolves.toBeNull();
  });

  it('cold start 복구는 동시 startup 호출을 하나의 appLogin 교환으로 coalesce한다', async () => {
    const user: DaoewoUser = {
      id: 'toss_recovered_user',
      displayName: '복구 사용자',
      isGuest: false,
    };
    let currentUser: DaoewoUser | null = null;
    let releaseSignIn: (() => void) | undefined;
    const signInGate = new Promise<void>((resolve) => {
      releaseSignIn = resolve;
    });
    const signInWithToss = jest.fn(async () => {
      await signInGate;
      currentUser = user;
      return user;
    });
    const backend = fakeBackend({
      getCurrentUser: jest.fn(async () => currentUser),
      signInWithToss,
    });
    mockNativeStorage.set(TOSS_ACCOUNT_MARKER_KEY, JSON.stringify({ uid: user.id }));
    mockedAppLogin.mockResolvedValue({
      authorizationCode: 'fresh-cold-start-code',
      referrer: 'DEFAULT',
    });
    const runtime = createAppsInTossRuntime(backend);

    const startup = Promise.all([
      runtime.auth.getCurrentUser(),
      runtime.auth.getCurrentUser(),
      runtime.purchase.getEntitlement(),
    ]);
    for (let attempt = 0; attempt < 10 && signInWithToss.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }

    expect(mockedAppLogin).toHaveBeenCalledTimes(1);
    expect(signInWithToss).toHaveBeenCalledTimes(1);
    releaseSignIn?.();
    await expect(startup).resolves.toEqual([user, user, FREE]);
    await expect(runtime.auth.getCurrentUser()).resolves.toEqual(user);
    expect(mockedAppLogin).toHaveBeenCalledTimes(1);
  });

  it('cold start 실패는 세션 내 자동 재시도를 막고 명시적 로그인은 허용한다', async () => {
    const user: DaoewoUser = {
      id: 'toss_retry_user',
      displayName: '재시도 사용자',
      isGuest: false,
    };
    let currentUser: DaoewoUser | null = null;
    const signOut = jest.fn(async () => undefined);
    const signInWithToss = jest.fn(async () => {
      currentUser = user;
      return user;
    });
    mockNativeStorage.set(TOSS_ACCOUNT_MARKER_KEY, JSON.stringify({ uid: user.id }));
    mockedAppLogin.mockRejectedValueOnce(new Error('cold start unavailable')).mockResolvedValueOnce({
      authorizationCode: 'explicit-login-code',
      referrer: 'DEFAULT',
    });
    const runtime = createAppsInTossRuntime(
      fakeBackend({
        getCurrentUser: jest.fn(async () => currentUser),
        signInWithToss,
        signOut,
      })
    );

    await expect(
      Promise.all([runtime.auth.getCurrentUser(), runtime.auth.getCurrentUser(), runtime.purchase.getEntitlement()])
    ).resolves.toEqual([
      null,
      null,
      {
        plan: 'free',
        source: 'apps-in-toss-local',
        validUntil: null,
      },
    ]);
    await expect(runtime.auth.getCurrentUser()).resolves.toBeNull();
    await expect(runtime.auth.getCurrentUser()).resolves.toBeNull();
    expect(mockedAppLogin).toHaveBeenCalledTimes(1);
    expect(signInWithToss).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(mockNativeStorage.has(TOSS_ACCOUNT_MARKER_KEY)).toBe(false);

    await expect(runtime.auth.signIn('toss')).resolves.toEqual(user);
    expect(mockedAppLogin).toHaveBeenCalledTimes(2);
    expect(signInWithToss).toHaveBeenCalledTimes(1);
  });

  it('손상된 Toss account marker를 조용히 제거하고 명시적 로그인을 허용한다', async () => {
    const user: DaoewoUser = {
      id: 'toss_after_corrupt_marker',
      displayName: '복구 사용자',
      isGuest: false,
    };
    const signInWithToss = jest.fn(async () => user);
    mockNativeStorage.set(TOSS_ACCOUNT_MARKER_KEY, '{"uid":');
    mockedAppLogin.mockResolvedValue({
      authorizationCode: 'fresh-explicit-code',
      referrer: 'DEFAULT',
    });
    const runtime = createAppsInTossRuntime(
      fakeBackend({
        signInWithToss,
      })
    );

    await expect(runtime.auth.getCurrentUser()).resolves.toBeNull();
    expect(mockNativeStorage.has(TOSS_ACCOUNT_MARKER_KEY)).toBe(false);
    expect(mockedAppLogin).not.toHaveBeenCalled();

    await expect(runtime.auth.signIn('toss')).resolves.toEqual(user);
    expect(signInWithToss).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockNativeStorage.get(TOSS_ACCOUNT_MARKER_KEY)!)).toEqual({
      uid: user.id,
      operationId: expect.stringMatching(/^toss-login_/),
    });
  });

  it('게스트 선택은 이전 Toss marker와 backend session을 닫고 자동 복구를 차단한다', async () => {
    const signOut = jest.fn(async () => undefined);
    mockNativeStorage.set(TOSS_ACCOUNT_MARKER_KEY, JSON.stringify({ uid: 'previous-toss-user' }));
    const runtime = createAppsInTossRuntime(fakeBackend({ signOut }));

    await expect(runtime.auth.continueAsGuest()).resolves.toMatchObject({
      id: 'ait-local-guest',
      isGuest: true,
    });
    await expect(runtime.auth.getCurrentUser()).resolves.toMatchObject({
      id: 'ait-local-guest',
      isGuest: true,
    });

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(mockNativeStorage.has(TOSS_ACCOUNT_MARKER_KEY)).toBe(false);
    expect(mockedAppLogin).not.toHaveBeenCalled();
  });

  it('cold start UID mismatch는 fail-closed하고 guest/local state를 변경하지 않는다', async () => {
    const guest: DaoewoUser = {
      id: 'ait-local-guest',
      displayName: '게스트',
      isGuest: true,
    };
    const localLearning = { version: 1, sessions: [{ id: 'local-session' }] };
    let currentUser: DaoewoUser | null = null;
    const signOut = jest.fn(async () => undefined);
    const runtime = createAppsInTossRuntime(
      fakeBackend({
        getCurrentUser: jest.fn(async () => currentUser),
        signInWithToss: jest.fn(async () => {
          currentUser = {
            id: 'different-toss-user',
            displayName: '다른 사용자',
            isGuest: false,
          };
          return currentUser;
        }),
        signOut,
      })
    );
    await Promise.all([
      runtime.storage.setItem(TOSS_ACCOUNT_MARKER_KEY, {
        uid: 'expected-toss-user',
      }),
      runtime.storage.setItem('daoewo:auth:guest', guest),
      runtime.storage.setItem('daoewo:learning-state:v2:ait-local-guest', localLearning),
    ]);
    mockedAppLogin.mockResolvedValue({
      authorizationCode: 'different-user-code',
      referrer: 'DEFAULT',
    });

    await expect(runtime.auth.getCurrentUser()).resolves.toEqual(guest);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(mockNativeStorage.has(TOSS_ACCOUNT_MARKER_KEY)).toBe(false);
    await expect(runtime.storage.getItem('daoewo:auth:guest')).resolves.toEqual(guest);
    await expect(runtime.storage.getItem('daoewo:learning-state:v2:ait-local-guest')).resolves.toEqual(localLearning);
    expect([...mockNativeStorage.keys()].some((key) => key.includes(encodeURIComponent('different-toss-user')))).toBe(
      false
    );

    await expect(runtime.auth.getCurrentUser()).resolves.toEqual(guest);
    expect(mockedAppLogin).toHaveBeenCalledTimes(1);
  });

  it('로그인 학습 동기화는 AIT REST pull/push 계약과 같은 device ID를 사용한다', async () => {
    const user = {
      id: 'toss_sync_user',
      displayName: '동기화 사용자',
      isGuest: false,
    };
    const emptySnapshot = {
      version: 1 as const,
      freeDecks: [],
      sessions: [],
    };
    const requestMock = jest.fn(async (path: string, body: Readonly<Record<string, unknown>>) => ({
      syncState: {
        goals: [],
        progress: [],
        learningBackup: {
          revision: path === '/v1/sync:push' ? 4 : 3,
          updatedAt: '2026-07-12T01:00:00.000Z',
          snapshot: path === '/v1/sync:push' ? body.snapshot : emptySnapshot,
        },
      },
    }));
    const runtime = createAppsInTossRuntime(
      fakeBackend({
        getCurrentUser: jest.fn(async () => user),
        request: requestMock as unknown as AppsInTossBackend['request'],
      })
    );

    const pulled = await runtime.sync.pull(user.id);
    expect(pulled).not.toBeNull();
    await runtime.sync.push(user.id, pulled!);

    expect(requestMock.mock.calls[0]?.[0]).toBe('/v1/sync:pull');
    expect(requestMock.mock.calls[0]?.[1]).toEqual({
      deviceId: expect.stringMatching(/^[A-Za-z0-9_-]{16,256}$/),
    });
    expect(requestMock.mock.calls[1]?.[0]).toBe('/v1/sync:push');
    const pushBody = requestMock.mock.calls[1]?.[1];
    expect(pushBody).toEqual({
      deviceId: requestMock.mock.calls[0]?.[1].deviceId,
      baseRevision: 3,
      mutationId: expect.stringMatching(/^sync_/),
      snapshot: emptySnapshot,
    });
    expect(JSON.stringify(pushBody)).not.toMatch(/"(?:front|back|cardSnapshots|uid)"/);
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

  it('A 요청의 401을 교체된 B session으로 재전송하지 않는다', async () => {
    let notifyRequestStarted!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      notifyRequestStarted = resolve;
    });
    let resolveUnauthorized!: (response: Response) => void;
    const unauthorized = new Promise<Response>((resolve) => {
      resolveUnauthorized = resolve;
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            firebaseCustomToken: 'custom-a',
            firebaseAppCheckToken: 'app-check-a',
            appCheckTokenTtlMillis: 3_600_000,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          idToken: 'id-a',
          refreshToken: 'refresh-a',
          expiresIn: '3600',
          localId: 'user-a',
        })
      )
      .mockImplementationOnce(async () => {
        notifyRequestStarted();
        return unauthorized;
      })
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: {
            firebaseCustomToken: 'custom-b',
            firebaseAppCheckToken: 'app-check-b',
            appCheckTokenTtlMillis: 3_600_000,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          idToken: 'id-b',
          refreshToken: 'refresh-b',
          expiresIn: '3600',
          localId: 'user-b',
        })
      );
    global.fetch = fetchMock as unknown as typeof fetch;
    const backend = createAppsInTossBackend({
      apiBaseUrl: 'https://api.example.test',
      firebaseApiKey: 'public-api-key',
    });
    await backend.signInWithToss({ authorizationCode: 'code-a', referrer: 'DEFAULT' });

    const pending = backend.request('/v1/receipts:verify', { orderId: 'order-a' }, 'user-a');
    await requestStarted;
    await backend.signOut();
    await backend.signInWithToss({ authorizationCode: 'code-b', referrer: 'DEFAULT' });
    resolveUnauthorized(jsonResponse(401, { error: { code: 'unauthenticated' } }));

    await expect(pending).rejects.toThrow('요청 중 로그인 계정이 변경됐어요');
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const requestBodies = fetchMock.mock.calls.map((call) => String((call[1] as RequestInit | undefined)?.body ?? ''));
    expect(requestBodies.filter((body) => body.includes('order-a'))).toHaveLength(1);
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
    ).resolves.toEqual({
      plan: 'free',
      source: 'apps-in-toss-local',
      validUntil: null,
    });
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

    expect(String(fetchMock.mock.calls[2]![0])).toBe('https://api.example.test/v1/account:delete');
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
      })
    );
    await Promise.all([
      runtime.storage.setItem('daoewo:auth:guest', user),
      runtime.storage.setItem(TOSS_ACCOUNT_MARKER_KEY, { uid: user.id }),
      runtime.storage.setItem('daoewo:device-id:v1', 'device-id'),
      runtime.storage.setItem('daoewo:settings:v1', { ttsEnabled: true }),
      runtime.storage.setItem('daoewo:learning-state:v2:toss_test_user', { version: 1 }),
    ]);

    await runtime.auth.deleteAccount();

    expect(mockedAppLogin).toHaveBeenCalledTimes(1);
    expect(signInWithToss).toHaveBeenCalledWith({
      authorizationCode: 'fresh-one-time-code',
      referrer: 'DEFAULT',
    });
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(signInWithToss.mock.invocationCallOrder[0]).toBeLessThan(deleteAccount.mock.invocationCallOrder[0]!);
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
      })
    );

    await expect(runtime.auth.deleteAccount()).rejects.toThrow('재인증된 토스 계정이 현재 계정과 달라');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('탈퇴와 guest 전환을 직렬화해 탈퇴 완료 뒤 만든 guest 상태를 보존한다', async () => {
    const user: DaoewoUser = {
      id: 'delete-user-a',
      displayName: '삭제 사용자',
      isGuest: false,
    };
    let currentUser: DaoewoUser | null = user;
    let notifyReauthStarted!: () => void;
    const reauthStarted = new Promise<void>((resolve) => {
      notifyReauthStarted = resolve;
    });
    let releaseReauth!: () => void;
    const reauthRelease = new Promise<void>((resolve) => {
      releaseReauth = resolve;
    });
    mockedAppLogin.mockImplementationOnce(async () => {
      notifyReauthStarted();
      await reauthRelease;
      return { authorizationCode: 'delete-code-a', referrer: 'DEFAULT' };
    });
    const runtime = createAppsInTossRuntime(
      fakeBackend({
        getCurrentUser: jest.fn(async () => currentUser),
        signInWithToss: jest.fn(async () => {
          currentUser = user;
          return user;
        }),
        deleteAccount: jest.fn(async () => {
          currentUser = null;
        }),
        signOut: jest.fn(async () => {
          currentUser = null;
        }),
      })
    );

    const deleting = runtime.auth.deleteAccount();
    await reauthStarted;
    const continuingAsGuest = runtime.auth.continueAsGuest();
    await Promise.resolve();
    expect(mockNativeStorage.has('daoewo:auth:guest')).toBe(false);

    releaseReauth();
    await deleting;
    const guest = await continuingAsGuest;

    expect(guest).toEqual({
      id: 'ait-local-guest',
      displayName: '게스트',
      isGuest: true,
    });
    await expect(runtime.storage.getItem('daoewo:auth:guest')).resolves.toEqual(guest);
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

  it('최신 결제 검증이 실패하면 이전 성공 entitlement를 재사용하지 않는다', async () => {
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
    const pro: DaoewoEntitlementState = {
      plan: 'pro',
      source: 'apps-in-toss',
      validUntil: '2026-08-12T00:00:00.000Z',
    };
    mockedIap.getProductItemList.mockResolvedValue({
      products: [
        {
          type: 'SUBSCRIPTION',
          sku: 'monthly-test-sku',
          renewalCycle: 'MONTHLY',
          offers: [],
        },
      ],
    });
    mockedIap.createSubscriptionPurchaseOrder.mockImplementation((hooks: typeof purchaseHooks) => {
      purchaseHooks = hooks;
      return jest.fn();
    });
    const verifySubscriptionOrder = jest
      .fn()
      .mockResolvedValueOnce(pro)
      .mockRejectedValueOnce(new Error('latest verification rejected'));
    const getEntitlement = jest.fn(async () => pro);
    const runtime = createAppsInTossRuntime(
      fakeBackend({
        getCurrentUser: jest.fn(async () => ({
          id: 'test-user',
          displayName: '테스트',
          isGuest: false,
        })),
        getEntitlement,
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

    await expect(purchaseHooks.options.processProductGrant({ orderId: 'verified-order' })).resolves.toBe(true);
    await expect(purchaseHooks.options.processProductGrant({ orderId: 'rejected-order' })).resolves.toBe(false);
    await purchaseHooks.onEvent();

    expect(await result).toBe('rejected');
    expect(getEntitlement).not.toHaveBeenCalled();
  });

  it('복원은 pending order별 최신 검증 결과만 grant하고 최종 권위를 다시 조회한다', async () => {
    const pro: DaoewoEntitlementState = {
      plan: 'pro',
      source: 'apps-in-toss',
      validUntil: '2026-08-12T00:00:00.000Z',
    };
    mockedIap.getPendingOrders.mockResolvedValue({
      orders: [
        { orderId: 'verified-pending-order', sku: 'monthly-test-sku' },
        { orderId: 'inactive-pending-order', sku: 'monthly-test-sku' },
      ],
    });
    const verifySubscriptionOrder = jest.fn().mockResolvedValueOnce(pro).mockResolvedValueOnce(FREE);
    const getEntitlement = jest.fn(async () => FREE);
    const runtime = createAppsInTossRuntime(
      fakeBackend({
        getCurrentUser: jest.fn(async () => ({
          id: 'test-user',
          displayName: '테스트',
          isGuest: false,
        })),
        getEntitlement,
        verifySubscriptionOrder,
      })
    );

    await expect(runtime.purchase.restore()).resolves.toEqual(FREE);

    expect(verifySubscriptionOrder).toHaveBeenNthCalledWith(
      1,
      {
        orderId: 'verified-pending-order',
        sku: 'monthly-test-sku',
      },
      'test-user'
    );
    expect(verifySubscriptionOrder).toHaveBeenNthCalledWith(
      2,
      {
        orderId: 'inactive-pending-order',
        sku: 'monthly-test-sku',
      },
      'test-user'
    );
    expect(mockedIap.completeProductGrant).toHaveBeenCalledTimes(1);
    expect(mockedIap.completeProductGrant).toHaveBeenCalledWith({
      params: { orderId: 'verified-pending-order' },
    });
    expect(getEntitlement).toHaveBeenCalledWith('test-user');
  });

  it('entitlement 조회 중 로그아웃하면 이전 계정 Pro를 반환하지 않는다', async () => {
    const user: DaoewoUser = {
      id: 'entitlement-user-a',
      displayName: 'A 사용자',
      isGuest: false,
    };
    const pro: DaoewoEntitlementState = {
      plan: 'pro',
      source: 'apps-in-toss',
      validUntil: '2026-08-12T00:00:00.000Z',
    };
    let currentUser: DaoewoUser | null = user;
    let notifyEntitlementStarted!: () => void;
    const entitlementStarted = new Promise<void>((resolve) => {
      notifyEntitlementStarted = resolve;
    });
    let resolveEntitlement!: (value: DaoewoEntitlementState) => void;
    const entitlementResult = new Promise<DaoewoEntitlementState>((resolve) => {
      resolveEntitlement = resolve;
    });
    const getEntitlement = jest.fn(async (expectedUserId?: string) => {
      expect(expectedUserId).toBe(user.id);
      notifyEntitlementStarted();
      return entitlementResult;
    });
    const runtime = createAppsInTossRuntime(
      fakeBackend({
        getCurrentUser: jest.fn(async () => currentUser),
        getEntitlement,
        signOut: jest.fn(async () => {
          currentUser = null;
        }),
      })
    );

    const pending = runtime.purchase.getEntitlement();
    await entitlementStarted;
    await runtime.auth.signOut();
    resolveEntitlement(pro);

    await expect(pending).resolves.toEqual({
      plan: 'free',
      source: 'apps-in-toss-local',
      validUntil: null,
    });
  });

  it('같은 로그인 세션의 entitlement 조회 장애는 Free로 숨기지 않는다', async () => {
    const user: DaoewoUser = {
      id: 'entitlement-network-user',
      displayName: '조회 사용자',
      isGuest: false,
    };
    const getEntitlement = jest.fn(async () => {
      throw new Error('entitlement network unavailable');
    });
    const runtime = createAppsInTossRuntime(
      fakeBackend({
        getCurrentUser: jest.fn(async () => user),
        getEntitlement,
      })
    );

    await expect(runtime.purchase.getEntitlement()).rejects.toThrow('entitlement network unavailable');
    expect(getEntitlement).toHaveBeenCalledWith(user.id);
  });

  it('복원 검증 중 B로 전환해도 A order를 B grant로 완료하지 않는다', async () => {
    const userA: DaoewoUser = {
      id: 'restore-user-a',
      displayName: 'A 사용자',
      isGuest: false,
    };
    const userB: DaoewoUser = {
      id: 'restore-user-b',
      displayName: 'B 사용자',
      isGuest: false,
    };
    const pro: DaoewoEntitlementState = {
      plan: 'pro',
      source: 'apps-in-toss',
      validUntil: '2026-08-12T00:00:00.000Z',
    };
    let currentUser: DaoewoUser | null = userA;
    let notifyVerifyStarted!: () => void;
    const verifyStarted = new Promise<void>((resolve) => {
      notifyVerifyStarted = resolve;
    });
    let resolveVerify!: (value: DaoewoEntitlementState) => void;
    const verifyResult = new Promise<DaoewoEntitlementState>((resolve) => {
      resolveVerify = resolve;
    });
    mockedIap.getPendingOrders.mockResolvedValue({
      orders: [{ orderId: 'pending-order-a', sku: 'monthly-test-sku' }],
    });
    const verifySubscriptionOrder = jest.fn(async (_order: unknown, expectedUserId?: string) => {
      expect(expectedUserId).toBe(userA.id);
      notifyVerifyStarted();
      return verifyResult;
    });
    mockedAppLogin.mockResolvedValue({ authorizationCode: 'code-b', referrer: 'DEFAULT' });
    const runtime = createAppsInTossRuntime(
      fakeBackend({
        getCurrentUser: jest.fn(async () => currentUser),
        signInWithToss: jest.fn(async () => {
          currentUser = userB;
          return userB;
        }),
        signOut: jest.fn(async () => {
          currentUser = null;
        }),
        verifySubscriptionOrder,
      })
    );

    const restoring = runtime.purchase.restore();
    await verifyStarted;
    await runtime.auth.signOut();
    await runtime.auth.signIn('toss');
    resolveVerify(pro);

    await expect(restoring).rejects.toThrow('구독 처리 중 로그인 계정이 변경됐어요');
    expect(mockedIap.completeProductGrant).not.toHaveBeenCalled();
    expect(currentUser).toEqual(userB);
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

  it('AppsInToss Storage를 사용할 수 없어도 device ID를 세션 내 재사용한다', async () => {
    const storage: DaoewoStorage = {
      async getItem() {
        throw new Error('storage unavailable');
      },
      async setItem() {
        throw new Error('storage unavailable');
      },
      async removeItem() {
        throw new Error('storage unavailable');
      },
    };
    const provider = createStableDeviceIdProvider(storage);

    const [first, second] = await Promise.all([provider(), provider()]);
    const third = await provider();

    expect(first).toMatch(/^[A-Za-z0-9_-]{16,256}$/);
    expect(second).toBe(first);
    expect(third).toBe(first);
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
      offers: [{ type: 'FREE_TRIAL', offerId: 'trial-7d', period: 'P7D' }],
    };
    const annual = {
      ...monthly,
      sku: 'annual-test-sku',
      displayAmount: '39,000원',
      renewalCycle: 'YEARLY',
      offers: [{ type: 'FREE_TRIAL', offerId: 'trial-month', period: 'P1M' }],
    } satisfies SubscriptionProductListItem;

    expect(mapAppsInTossPurchaseOffer(monthly, 'monthly')).toEqual({
      plan: 'monthly',
      displayPrice: '4,900원',
      periodLabel: '월',
      description: '월간 자동 갱신',
      trialDays: 7,
    });
    expect(mapAppsInTossPurchaseOffer(annual, 'annual')).not.toHaveProperty('trialDays');
  });
});
