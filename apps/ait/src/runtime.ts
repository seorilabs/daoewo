import {
  IAP,
  Storage,
  appLogin,
  eventLog,
  getOperationalEnvironment,
  isMinVersionSupported,
  openURL,
  share,
  type SubscriptionProductListItem,
} from '@apps-in-toss/framework';
import { listPublicCatalog, type CatalogDeckForEntitlement, type PublicDeckMetadata } from '@daoewo/product-catalog';
import {
  createBundledFreeContentAdapter,
  type BundledFreeContentAdapter,
  type PublishedCard,
  type PublishedDeckContent,
} from '@daoewo/product-catalog/bundled-free-content';
import {
  addDaysToDateKey,
  createDeliveryWindowDeckRegistry,
  toDateKey,
  type CardProgress,
  type LocalDateKey,
  type ReviewRating,
  type StudyGoal,
  type StudyGoalMode,
} from '@daoewo/product-core';
import {
  type DaoewoAnalyticsValue,
  type DaoewoCardView,
  type DaoewoContentPort,
  type DaoewoCreateGoalInput,
  type DaoewoDeckView,
  type DaoewoEntitlementState,
  type DaoewoPurchaseOffer,
  type DaoewoRuntime,
  type DaoewoStorage,
  type DaoewoUser,
  type SubscriptionPlan,
} from '@daoewo/product-ui';
import {
  createNoopDaoewoSyncPort,
  createUnsupportedDaoewoDeckReadyNotifications,
  createUnsupportedDaoewoNotifications,
} from '@daoewo/product-ui/runtime';
import {
  createLearningSyncPort,
  type LearningSyncPushInput,
  type LearningSyncServerState,
} from '@daoewo/product-ui/sync';

const GUEST_USER_KEY = 'daoewo:auth:guest';
const TOSS_ACCOUNT_MARKER_KEY = 'daoewo:auth:toss-account:v1';
const DEVICE_ID_KEY = 'daoewo:device-id:v1';
const PURCHASE_TIMEOUT_MS = 120_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

const FREE_ENTITLEMENT: DaoewoEntitlementState = {
  plan: 'free',
  source: 'apps-in-toss-local',
  validUntil: null,
};

export interface TossLoginInput {
  readonly authorizationCode: string;
  readonly referrer: 'DEFAULT' | 'SANDBOX';
}

export interface TossSubscriptionOrder {
  readonly orderId: string;
  readonly sku: string;
  readonly subscriptionId?: string;
}

/**
 * Toss partner credential, Firebase token, App Check token은 이 경계 뒤에서만 다룬다.
 * UI/runtime은 검증된 사용자와 entitlement만 받는다.
 */
export interface AppsInTossBackend {
  getCurrentUser(): Promise<DaoewoUser | null>;
  signInWithToss(input: TossLoginInput): Promise<DaoewoUser>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  getEntitlement(): Promise<DaoewoEntitlementState>;
  verifySubscriptionOrder(order: TossSubscriptionOrder): Promise<DaoewoEntitlementState>;
  request<T>(path: string, body: Readonly<Record<string, unknown>>): Promise<T>;
}

export interface AppsInTossBackendConfig {
  readonly apiBaseUrl: string;
  readonly firebaseApiKey: string;
}

interface TossExchangeResponse {
  readonly firebaseCustomToken: string;
  readonly firebaseAppCheckToken: string;
  readonly appCheckTokenTtlMillis: number;
}

interface FirebaseSignInResponse {
  readonly idToken: string;
  readonly refreshToken: string;
  readonly expiresIn: string;
  readonly localId: string;
}

interface FirebaseRefreshResponse {
  readonly id_token: string;
  readonly refresh_token: string;
  readonly expires_in: string;
  readonly user_id: string;
}

interface AppCheckRefreshResponse {
  readonly firebaseAppCheckToken: string;
  readonly appCheckTokenTtlMillis: number;
}

interface ServerEntitlementResponse {
  readonly active: boolean;
  readonly entitlement: DaoewoEntitlementState | null;
}

interface BackendEnvelope<T> {
  readonly data?: T;
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
}

interface AuthenticatedSession {
  readonly idToken: string;
  readonly refreshToken: string;
  readonly appCheckToken: string;
  readonly idTokenExpiresAt: number;
  readonly appCheckTokenExpiresAt: number;
  readonly user: DaoewoUser;
}

interface TossAccountMarker {
  readonly uid: string;
}

interface ServerCatalogDeck {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly language: string;
  readonly tier: 'free' | 'pro';
  readonly status: 'published';
  readonly version: number;
  readonly cardCount: number;
  readonly tags: readonly string[];
  readonly locked: boolean;
}

interface ServerStudyGoal {
  readonly id: string;
  readonly deckId: string;
  readonly active: boolean;
  readonly targetCount: number;
  readonly startDate: string;
  readonly endDate?: string;
  readonly dailyTarget?: number;
  readonly assignments: Readonly<Record<string, readonly number[]>>;
}

interface ServerStudyCard {
  readonly id: string;
  readonly index: number;
  readonly front: string;
  readonly back: string;
  readonly hint?: string;
  readonly example?: string;
  readonly tags?: readonly string[];
}

interface ServerCardWindow {
  readonly windowId: string;
  readonly deckId: string;
  readonly cards: readonly ServerStudyCard[];
  readonly expiresAt: string;
}

interface ServerSyncState {
  readonly goals: readonly ServerStudyGoal[];
  readonly progress: readonly {
    readonly deckId: string;
    readonly cards: Readonly<Record<string, { readonly state?: CardProgress } | CardProgress>>;
  }[];
  readonly learningBackup?: LearningSyncServerState['learningBackup'];
}

export function createAppsInTossBackend(config: AppsInTossBackendConfig): AppsInTossBackend {
  const apiBaseUrl = requireNonEmptyUrl(config.apiBaseUrl, 'apiBaseUrl');
  const firebaseApiKey = requireNonEmpty(config.firebaseApiKey, 'firebaseApiKey');
  let session: AuthenticatedSession | null = null;
  let refreshPromise: Promise<void> | null = null;

  async function refreshSession(): Promise<void> {
    const previous = session;
    if (previous === null) {
      throw new Error('로그인이 필요해요.');
    }

    const firebase = await postDirectJson<FirebaseRefreshResponse>(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebaseApiKey)}`,
      `grant_type=refresh_token&refresh_token=${encodeURIComponent(previous.refreshToken)}`,
      { 'Content-Type': 'application/x-www-form-urlencoded' }
    );
    if (
      firebase.id_token.length === 0 ||
      firebase.refresh_token.length === 0 ||
      firebase.user_id !== previous.user.id
    ) {
      throw new Error('Firebase 로그인 갱신 응답을 확인할 수 없어요.');
    }
    if (session !== previous) {
      throw new Error('로그인 상태가 변경됐어요.');
    }

    const idTokenSession: AuthenticatedSession = {
      ...previous,
      idToken: firebase.id_token,
      refreshToken: firebase.refresh_token,
      idTokenExpiresAt: expirationFromSeconds(firebase.expires_in),
    };
    session = idTokenSession;

    const appCheck = await postBackendJson<AppCheckRefreshResponse>(
      `${apiBaseUrl}/v1/auth/toss:refreshAppCheck`,
      {},
      { Authorization: `Bearer ${idTokenSession.idToken}` }
    );
    if (appCheck.firebaseAppCheckToken.length === 0) {
      throw new Error('Firebase App Check 갱신 응답을 확인할 수 없어요.');
    }
    if (session !== idTokenSession) {
      throw new Error('로그인 상태가 변경됐어요.');
    }
    session = {
      ...idTokenSession,
      appCheckToken: appCheck.firebaseAppCheckToken,
      appCheckTokenExpiresAt: expirationFromMillis(appCheck.appCheckTokenTtlMillis),
    };
  }

  async function ensureFreshSession(force = false): Promise<AuthenticatedSession> {
    const current = session;
    if (current === null) {
      throw new Error('로그인이 필요해요.');
    }
    const nearExpiration =
      current.idTokenExpiresAt - Date.now() <= TOKEN_REFRESH_MARGIN_MS ||
      current.appCheckTokenExpiresAt - Date.now() <= TOKEN_REFRESH_MARGIN_MS;
    if (!force && !nearExpiration) {
      return current;
    }

    if (refreshPromise === null) {
      refreshPromise = refreshSession().finally(() => {
        refreshPromise = null;
      });
    }
    await refreshPromise;
    if (session === null) {
      throw new Error('로그인이 필요해요.');
    }
    return session;
  }

  async function authenticatedPost<T>(path: string, body: Readonly<Record<string, unknown>>): Promise<T> {
    const send = async (active: AuthenticatedSession): Promise<T> =>
      postBackendJson<T>(`${apiBaseUrl}${path}`, body, {
        Authorization: `Bearer ${active.idToken}`,
        'X-Firebase-AppCheck': active.appCheckToken,
      });

    const active = await ensureFreshSession();
    try {
      return await send(active);
    } catch (error) {
      if (!(error instanceof HttpRequestError) || error.status !== 401) {
        throw error;
      }
    }
    if (refreshPromise !== null) {
      await refreshPromise;
      if (session === null) {
        throw new Error('로그인이 필요해요.');
      }
      return send(session);
    }
    if (session !== null && session !== active) {
      return send(session);
    }
    return send(await ensureFreshSession(true));
  }

  return {
    async getCurrentUser() {
      return session?.user ?? null;
    },
    async signInWithToss(input) {
      const exchange = await postBackendJson<TossExchangeResponse>(`${apiBaseUrl}/v1/auth/toss:exchange`, {
        authorizationCode: input.authorizationCode,
        referrer: input.referrer,
      });
      if (exchange.firebaseCustomToken.length === 0 || exchange.firebaseAppCheckToken.length === 0) {
        throw new Error('로그인 보안 토큰을 확인할 수 없어요.');
      }

      const firebase = await postDirectJson<FirebaseSignInResponse>(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(firebaseApiKey)}`,
        JSON.stringify({
          token: exchange.firebaseCustomToken,
          returnSecureToken: true,
        }),
        { 'Content-Type': 'application/json' }
      );
      const user: DaoewoUser = {
        id: firebase.localId,
        displayName: '다외워 사용자',
        isGuest: false,
      };
      session = {
        idToken: firebase.idToken,
        refreshToken: firebase.refreshToken,
        appCheckToken: exchange.firebaseAppCheckToken,
        idTokenExpiresAt: expirationFromSeconds(firebase.expiresIn),
        appCheckTokenExpiresAt: expirationFromMillis(exchange.appCheckTokenTtlMillis),
        user,
      };
      return user;
    },
    async signOut() {
      session = null;
    },
    async deleteAccount() {
      if (session !== null) {
        await authenticatedPost('/v1/account:delete', { confirmation: 'DELETE' });
      }
      session = null;
    },
    async getEntitlement() {
      if (session === null) {
        return FREE_ENTITLEMENT;
      }
      const response = await authenticatedPost<ServerEntitlementResponse>('/v1/entitlement', {});
      return activeEntitlement(response);
    },
    async verifySubscriptionOrder(order) {
      const response = await authenticatedPost<ServerEntitlementResponse>('/v1/receipts:verify', {
        platform: 'apps-in-toss',
        productId: order.sku,
        orderId: order.orderId,
        sku: order.sku,
        ...(order.subscriptionId === undefined ? {} : { subscriptionId: order.subscriptionId }),
      });
      return activeEntitlement(response);
    },
    async request<T>(path: string, body: Readonly<Record<string, unknown>>) {
      return authenticatedPost<T>(path, body);
    },
  };
}

export function createAppsInTossRuntime(
  backend: AppsInTossBackend | undefined = undefined,
  legalUrls?: { readonly terms: string; readonly privacy: string },
  bundledFreeContent?: Readonly<Record<string, PublishedDeckContent>>
): DaoewoRuntime {
  const configuredBackend = backend !== undefined;
  const activeBackend = backend ?? createUnconfiguredBackend();
  const storage = createJsonStorageAdapter(Storage);
  const getDeviceId = createStableDeviceIdProvider(storage);
  const externalLinks = createExternalLinks(legalUrls);
  let authEpoch = 0;
  let coldStartRecoveryAttempted = false;
  let coldStartRecoveryPromise: Promise<DaoewoUser | null> | null = null;
  let interactiveSignInPromise: Promise<DaoewoUser> | null = null;
  let backendSessionRejected = false;

  async function readTossAccountMarker(): Promise<TossAccountMarker | null> {
    const marker = await storage.getItem<unknown>(TOSS_ACCOUNT_MARKER_KEY);
    if (
      typeof marker === 'object' &&
      marker !== null &&
      'uid' in marker &&
      typeof marker.uid === 'string' &&
      marker.uid.trim().length > 0
    ) {
      return { uid: marker.uid };
    }
    if (marker !== null) {
      await storage.removeItem(TOSS_ACCOUNT_MARKER_KEY);
    }
    return null;
  }

  async function getAcceptedBackendUser(): Promise<DaoewoUser | null> {
    if (backendSessionRejected) {
      return null;
    }
    return activeBackend.getCurrentUser();
  }

  async function closeRejectedBackendSession(): Promise<void> {
    backendSessionRejected = true;
    try {
      await activeBackend.signOut();
    } finally {
      await storage.removeItem(TOSS_ACCOUNT_MARKER_KEY);
    }
  }

  async function recoverColdStartSessionOnce(): Promise<DaoewoUser | null> {
    if (!configuredBackend) {
      return null;
    }
    if (coldStartRecoveryPromise !== null) {
      return coldStartRecoveryPromise;
    }
    if (coldStartRecoveryAttempted) {
      return null;
    }

    coldStartRecoveryAttempted = true;
    const recoveryEpoch = authEpoch;
    const operation = (async (): Promise<DaoewoUser | null> => {
      try {
        const marker = await readTossAccountMarker();
        if (marker === null || authEpoch !== recoveryEpoch) {
          return null;
        }

        const loginInput = await appLogin();
        if (authEpoch !== recoveryEpoch) {
          return null;
        }

        const user = await activeBackend.signInWithToss(loginInput);
        if (authEpoch !== recoveryEpoch) {
          await activeBackend.signOut();
          return null;
        }
        if (user.id !== marker.uid) {
          authEpoch += 1;
          await closeRejectedBackendSession();
          throw new Error('복구된 토스 계정이 저장된 계정과 달라 로그아웃했어요.');
        }
        backendSessionRejected = false;
        return user;
      } catch {
        // 자동 복구 실패는 시작 화면을 막지 않는다. 명시적 로그인은 다시 시도할 수 있다.
        return null;
      }
    })();
    coldStartRecoveryPromise = operation;
    try {
      return await operation;
    } finally {
      if (coldStartRecoveryPromise === operation) {
        coldStartRecoveryPromise = null;
      }
    }
  }

  async function ensureColdStartSession(): Promise<DaoewoUser | null> {
    if (coldStartRecoveryPromise !== null) {
      return coldStartRecoveryPromise;
    }
    if (interactiveSignInPromise !== null) {
      return interactiveSignInPromise;
    }
    const current = await getAcceptedBackendUser();
    if (current !== null) {
      return current;
    }
    return recoverColdStartSessionOnce();
  }

  async function signInInteractively(): Promise<DaoewoUser> {
    if (interactiveSignInPromise !== null) {
      return interactiveSignInPromise;
    }
    const operation = (async (): Promise<DaoewoUser> => {
      const signInEpoch = authEpoch + 1;
      authEpoch = signInEpoch;
      const guest = await storage.getItem<DaoewoUser>(GUEST_USER_KEY);
      const loginInput = await appLogin();
      const user = await activeBackend.signInWithToss(loginInput);
      if (authEpoch !== signInEpoch) {
        await activeBackend.signOut();
        throw new Error('로그인 중 계정 상태가 변경됐어요. 다시 시도해 주세요.');
      }

      try {
        await storage.setItem<TossAccountMarker>(TOSS_ACCOUNT_MARKER_KEY, {
          uid: user.id,
        });
        if (guest?.isGuest === true && guest.id !== user.id) {
          await bundledFree.mergeOwnerState(guest.id, user.id);
        }
        await storage.removeItem(GUEST_USER_KEY);
      } catch (error) {
        await activeBackend.signOut().catch(() => undefined);
        await storage.removeItem(TOSS_ACCOUNT_MARKER_KEY).catch(() => undefined);
        throw error;
      }
      backendSessionRejected = false;
      return user;
    })();
    interactiveSignInPromise = operation;
    try {
      return await operation;
    } finally {
      if (interactiveSignInPromise === operation) {
        interactiveSignInPromise = null;
      }
    }
  }

  async function getRuntimeUser(): Promise<DaoewoUser | null> {
    const authenticated = await ensureColdStartSession();
    if (authenticated !== null) {
      return authenticated;
    }
    const guest = await storage.getItem<DaoewoUser>(GUEST_USER_KEY);
    return guest?.isGuest === true ? guest : null;
  }
  const bundledFree = createBundledFreeContentAdapter({
    storage,
    getOwnerId: async () => (await getRuntimeUser())?.id ?? null,
    getEntitlement: () => activeBackend.getEntitlement().catch(() => FREE_ENTITLEMENT),
    ...(bundledFreeContent === undefined ? {} : { content: bundledFreeContent }),
  });

  return {
    analytics: {
      async track(name, properties) {
        await eventLog({
          log_name: name,
          log_type: 'event',
          params: properties as Readonly<Record<string, DaoewoAnalyticsValue>>,
        });
      },
    },
    storage,
    auth: {
      async getCurrentUser() {
        return getRuntimeUser();
      },
      async continueAsGuest() {
        authEpoch += 1;
        coldStartRecoveryAttempted = true;
        const guest: DaoewoUser = {
          id: 'ait-local-guest',
          displayName: '게스트',
          isGuest: true,
        };
        await Promise.all([
          activeBackend.signOut(),
          storage.removeItem(TOSS_ACCOUNT_MARKER_KEY),
          storage.setItem(GUEST_USER_KEY, guest),
        ]);
        backendSessionRejected = false;
        return guest;
      },
      async signIn(provider) {
        if (provider !== 'toss') {
          throw new Error('AppsInToss에서는 토스 로그인을 사용해 주세요.');
        }
        if (coldStartRecoveryPromise !== null) {
          const recovered = await coldStartRecoveryPromise;
          if (recovered !== null) {
            return recovered;
          }
        }
        const current = await getAcceptedBackendUser();
        return current ?? signInInteractively();
      },
      async signOut() {
        authEpoch += 1;
        const current = coldStartRecoveryPromise === null ? await getAcceptedBackendUser() : null;
        await Promise.all([
          ...(current === null ? [] : [bundledFree.removeOwnerState(current.id)]),
          activeBackend.signOut(),
          storage.removeItem(GUEST_USER_KEY),
          storage.removeItem(TOSS_ACCOUNT_MARKER_KEY),
        ]);
        backendSessionRejected = false;
      },
      async deleteAccount() {
        authEpoch += 1;
        const current = await getAcceptedBackendUser();
        const runtimeUser = current ?? (await storage.getItem<DaoewoUser>(GUEST_USER_KEY));
        if (current !== null) {
          // Toss login exchange로 Firebase auth_time을 갱신한 뒤 파괴적 endpoint를 호출한다.
          const reauthenticated = await activeBackend.signInWithToss(await appLogin());
          if (reauthenticated.id !== current.id) {
            await closeRejectedBackendSession();
            throw new Error('재인증된 토스 계정이 현재 계정과 달라 탈퇴를 중단했어요.');
          }
          await activeBackend.deleteAccount();
        }
        await Promise.all([
          ...(runtimeUser === null ? [] : [bundledFree.removeOwnerState(runtimeUser.id)]),
          storage.removeItem(GUEST_USER_KEY),
          storage.removeItem(TOSS_ACCOUNT_MARKER_KEY),
          storage.removeItem(DEVICE_ID_KEY),
          storage.removeItem('daoewo:learning-state:v1'),
          storage.removeItem('daoewo:settings:v1'),
          ...(current === null
            ? []
            : [storage.removeItem(`daoewo:learning-state:v2:${encodeURIComponent(current.id)}`)]),
        ]);
      },
    },
    purchase: {
      async getOffers() {
        assertSubscriptionRuntimeSupported();
        return listPurchaseOffers();
      },
      async getEntitlement() {
        await ensureColdStartSession();
        if (backendSessionRejected) {
          return FREE_ENTITLEMENT;
        }
        return activeBackend.getEntitlement();
      },
      async purchase(plan) {
        if ((await ensureColdStartSession()) === null) {
          throw new Error('구독하려면 먼저 토스 로그인을 완료해 주세요.');
        }
        assertSubscriptionRuntimeSupported();
        const product = await findSubscriptionProduct(plan);
        return purchaseSubscription(activeBackend, product, plan);
      },
      async restore() {
        if ((await ensureColdStartSession()) === null) {
          throw new Error('구독을 복원하려면 먼저 토스 로그인을 완료해 주세요.');
        }
        assertSubscriptionRuntimeSupported();
        const response = await IAP.getPendingOrders();
        for (const order of response?.orders ?? []) {
          const entitlement = await activeBackend.verifySubscriptionOrder({
            orderId: order.orderId,
            sku: order.sku,
          });
          if (entitlement.plan === 'pro') {
            await IAP.completeProductGrant({
              params: { orderId: order.orderId },
            });
          }
        }
        return activeBackend.getEntitlement();
      },
    },
    tts: {
      availability: 'unsupported',
      async speak(text) {
        void text;
        throw new Error('AppsInToss에서는 음성 읽기를 지원하지 않아요.');
      },
      async stop() {
        // 지원하지 않는 capability의 멱등 cleanup 경계다.
      },
    },
    sharing: {
      availability: 'available',
      async shareText(input) {
        await share({ message: input.message });
      },
    },
    notifications: createUnsupportedDaoewoNotifications(),
    deckReadyNotifications: createUnsupportedDaoewoDeckReadyNotifications(),
    content: createAppsInTossContentPort({
      backend: activeBackend,
      getDeviceId,
      bundledFree,
    }),
    sync: configuredBackend
      ? createLearningSyncPort({
          transport: createAppsInTossLearningSyncTransport(activeBackend, getDeviceId),
          localFree: {
            exportLearningBackup: (ownerId) => bundledFree.exportLearningBackup(ownerId),
            importLearningBackup: (ownerId, freeDecks) => bundledFree.importLearningBackup(freeDecks, ownerId),
            async resolveFreeCardSnapshots(cards) {
              const resolved = await bundledFree.getCardsByIds(cards);
              return resolved.map((card) => {
                const metadata = listPublicCatalog('pro').find((deck) => deck.id === card.deckId);
                return mapBundledCard(card, metadata?.locale ?? '한국어');
              });
            },
          },
          getEntitlement: () => activeBackend.getEntitlement(),
          createMutationId: () => createSafeId('sync'),
          canSync: async (userId) => (await getAcceptedBackendUser())?.id === userId,
        })
      : createNoopDaoewoSyncPort(),
    ...(externalLinks === undefined ? {} : { externalLinks }),
    now: () => new Date(),
  };
}

function createAppsInTossLearningSyncTransport(backend: AppsInTossBackend, getDeviceId: () => Promise<string>) {
  async function assertCurrentUser(userId: string): Promise<void> {
    if ((await backend.getCurrentUser())?.id !== userId) {
      throw new Error('동기화 계정이 현재 로그인 계정과 달라요.');
    }
  }

  return {
    async pull(userId: string): Promise<LearningSyncServerState> {
      await assertCurrentUser(userId);
      const result = await backend.request<{ syncState: ServerSyncState }>('/v1/sync:pull', {
        deviceId: await getDeviceId(),
      });
      await assertCurrentUser(userId);
      return result.syncState;
    },
    async push(userId: string, backup: LearningSyncPushInput): Promise<LearningSyncServerState> {
      await assertCurrentUser(userId);
      const result = await backend.request<{ syncState: ServerSyncState }>('/v1/sync:push', {
        deviceId: await getDeviceId(),
        ...backup,
      });
      await assertCurrentUser(userId);
      return result.syncState;
    },
  };
}

interface StringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createJsonStorageAdapter(nativeStorage: StringStorage): DaoewoStorage {
  return {
    async getItem<T>(key: string) {
      const value = await nativeStorage.getItem(key);
      if (value === null) {
        return null;
      }
      try {
        return JSON.parse(value) as T;
      } catch {
        await nativeStorage.removeItem(key);
        return null;
      }
    },
    async setItem<T>(key: string, value: T) {
      await nativeStorage.setItem(key, JSON.stringify(value));
    },
    async removeItem(key: string) {
      await nativeStorage.removeItem(key);
    },
  };
}

/** 기기 식별자는 계정 토큰과 분리해 AppsInToss Storage에만 보관한다. */
export function createStableDeviceIdProvider(storage: DaoewoStorage): () => Promise<string> {
  let pending: Promise<string> | null = null;
  return () => {
    if (pending === null) {
      pending = (async () => {
        const stored = await storage.getItem<string>(DEVICE_ID_KEY);
        if (stored !== null && /^[A-Za-z0-9_-]{16,256}$/.test(stored)) {
          return stored;
        }
        const generated = createSafeId('ait-device');
        await storage.setItem(DEVICE_ID_KEY, generated);
        return generated;
      })();
    }
    return pending;
  };
}

function createAppsInTossContentPort(input: {
  readonly backend: AppsInTossBackend;
  readonly getDeviceId: () => Promise<string>;
  readonly bundledFree: BundledFreeContentAdapter;
}): DaoewoContentPort {
  const serverWindows = createDeliveryWindowDeckRegistry();
  let catalogCache: readonly DaoewoDeckView[] = [];

  async function localCatalog(entitlement: DaoewoEntitlementState): Promise<readonly DaoewoDeckView[]> {
    return Promise.all(
      listPublicCatalog(entitlement.plan === 'pro' ? 'pro' : 'free').map(async (metadata) => {
        const base = mapPublicDeck(metadata);
        if (!input.bundledFree.hasDeck(metadata.id)) {
          return base;
        }
        const summary = await input.bundledFree.getDeckSummary(metadata.id).catch(() => null);
        return summary === null || !summary.active
          ? base
          : { ...base, progress: summary.progress, daysLeft: summary.daysLeft };
      })
    );
  }

  async function listCatalog(): Promise<readonly DaoewoDeckView[]> {
    const user = await input.backend.getCurrentUser();
    if (user === null) {
      catalogCache = await localCatalog(FREE_ENTITLEMENT);
      return catalogCache;
    }

    let entitlement: DaoewoEntitlementState;
    let catalog: { decks: readonly ServerCatalogDeck[] };
    let sync: { syncState: ServerSyncState };
    try {
      const deviceId = await input.getDeviceId();
      [entitlement, catalog, sync] = await Promise.all([
        input.backend.getEntitlement(),
        input.backend.request<{ decks: readonly ServerCatalogDeck[] }>('/v1/catalog', {}),
        input.backend.request<{ syncState: ServerSyncState }>('/v1/sync:pull', { deviceId }),
      ]);
    } catch {
      // 인증 서버가 오프라인이면 Pro를 잠그고 검증된 Free bundle만 계속 사용한다.
      catalogCache = await localCatalog(FREE_ENTITLEMENT);
      return catalogCache;
    }
    const publicCatalog = listPublicCatalog(entitlement.plan === 'pro' ? 'pro' : 'free');
    const local = await localCatalog(entitlement);
    const localById = new Map(local.map((deck) => [deck.id, deck] as const));
    const serverById = new Map(catalog.decks.map((deck) => [deck.id, deck] as const));
    const activeGoalsByDeck = new Map(
      sync.syncState.goals.filter((goal) => goal.active).map((goal) => [goal.deckId, goal] as const)
    );
    const progressByDeck = new Map(sync.syncState.progress.map((progress) => [progress.deckId, progress] as const));

    catalogCache = publicCatalog.map((metadata) => {
      if (metadata.tier === 'free') {
        return localById.get(metadata.id) ?? mapPublicDeck(metadata);
      }
      const published = serverById.get(metadata.id);
      const goal = activeGoalsByDeck.get(metadata.id);
      const progress = progressByDeck.get(metadata.id);
      const base = published === undefined ? mapPublicDeck(metadata) : mapServerDeck(published, metadata);
      if (goal === undefined) {
        return base;
      }
      const completed = Object.keys(progress?.cards ?? {}).length;
      return {
        ...base,
        progress: goal.targetCount <= 0 ? 0 : Math.min(1, completed / goal.targetCount),
        daysLeft: remainingAssignmentDays(goal.assignments),
      };
    });
    return catalogCache;
  }

  async function getDeck(deckId: string): Promise<DaoewoDeckView | null> {
    const decks = catalogCache.length > 0 ? catalogCache : await listCatalog();
    return decks.find((deck) => deck.id === deckId) ?? null;
  }

  async function requirePublishedProDeck(deckId: string): Promise<DaoewoDeckView> {
    const deck = await getDeck(deckId);
    if (deck === null || deck.availability !== 'published' || deck.cardCount === null || deck.cardCount <= 0) {
      throw new Error('승인된 덱 본문이 아직 준비되지 않았어요.');
    }
    if (deck.tier !== 'pro') {
      throw new Error('승인된 Free 덱 본문이 아직 준비되지 않았어요.');
    }
    if ((await input.backend.getCurrentUser()) === null) {
      throw new Error('학습하려면 먼저 로그인해 주세요.');
    }
    return deck;
  }

  return {
    listCatalog,
    getDeck,
    async createGoal(goalInput: DaoewoCreateGoalInput) {
      if (input.bundledFree.hasDeck(goalInput.deckId)) {
        return input.bundledFree.createGoal(goalInput);
      }
      const deck = await requirePublishedProDeck(goalInput.deckId);
      const response = await input.backend.request<{ goal: ServerStudyGoal }>('/v1/goals:createOrReset', {
        deckId: deck.id,
        targetCount: deck.cardCount,
        startDate: goalInput.startDate,
        timezone: resolvedTimezone(),
        deviceId: await input.getDeviceId(),
        ...(goalInput.mode === 'days'
          ? { endDate: addDaysToDateKey(goalInput.startDate, goalInput.value - 1) }
          : { dailyTarget: goalInput.value }),
      });
      return mapServerGoal(response.goal, goalInput.mode);
    },
    async getCardWindow(windowInput) {
      if (input.bundledFree.hasDeck(windowInput.deckId)) {
        const window = await input.bundledFree.getCardWindow(windowInput);
        const deck = await getDeck(window.deckId);
        return {
          id: window.id,
          deckId: window.deckId,
          goalKey: window.goalKey,
          cards: window.cards.map((card) => mapBundledCard(card, deck?.locale ?? '한국어')),
          targetCount: window.targetCount,
        };
      }
      const deck = await requirePublishedProDeck(windowInput.deckId);
      const response = await input.backend.request<{ window: ServerCardWindow }>('/v1/windows:today', {
        goalId: windowInput.goalKey ?? windowInput.deckId,
        deviceId: await input.getDeviceId(),
      });
      serverWindows.bind({
        requestedDeckId: deck.id,
        authoritativeDeckId: response.window.deckId,
        windowId: response.window.windowId,
      });
      return {
        id: response.window.windowId,
        deckId: response.window.deckId,
        ...(windowInput.goalKey === undefined ? {} : { goalKey: windowInput.goalKey }),
        cards: response.window.cards.map((card) => mapServerCard(card, response.window.deckId, deck.locale)),
        targetCount: response.window.cards.length,
        expiresAt: response.window.expiresAt,
      };
    },
    async commitProgressBatch(batch) {
      if (input.bundledFree.hasDeck(batch.deckId)) {
        await input.bundledFree.commitProgressBatch(batch);
        return;
      }
      const answers = batch.progresses
        .map((progress) => ({
          cardId: progress.cardId,
          rating: ratingFromProgress(progress),
        }))
        .filter((answer): answer is { cardId: string; rating: ReviewRating } => answer.rating !== null);
      if (answers.length === 0) {
        return;
      }
      const metadata = listPublicCatalog('pro').find((deck) => deck.id === batch.deckId);
      if (metadata?.tier !== 'pro') {
        throw new Error('승인된 Free 덱 본문이 아직 준비되지 않았어요.');
      }
      serverWindows.assertBound(batch.windowId, batch.deckId);
      if ((await input.backend.getCurrentUser()) === null) {
        throw new Error('학습 기록을 저장하려면 먼저 로그인해 주세요.');
      }
      await input.backend.request('/v1/progress:batchSubmit', {
        batchId: createSafeId('batch'),
        windowId: batch.windowId,
        deviceId: await input.getDeviceId(),
        answers,
      });
    },
    async submitDeckRequest(request) {
      if ((await input.backend.getCurrentUser()) === null) {
        throw new Error('덱을 요청하려면 먼저 로그인해 주세요.');
      }
      await input.backend.request('/v1/deckRequests:create', {
        topic: request.topic,
        category: request.category,
        language: request.locale,
        ...(request.note === undefined ? {} : { note: request.note }),
      });
    },
  };
}

function mapPublicDeck(deck: CatalogDeckForEntitlement): DaoewoDeckView {
  return {
    id: deck.id,
    title: deck.title,
    subtitle: deck.description,
    category: mapCategory(deck.category),
    locale: deck.locale,
    tier: deck.tier,
    source: deck.sourceType === 'curated-import' ? 'official' : 'ai-batch',
    availability: deck.availability,
    cardCount: deck.cardCount,
    tags: deck.tags,
  };
}

function mapServerDeck(deck: ServerCatalogDeck, metadata: PublicDeckMetadata): DaoewoDeckView {
  return {
    id: deck.id,
    title: deck.title,
    subtitle: deck.description,
    category: mapCategory(deck.category || metadata.category),
    locale: metadata.locale || deck.language,
    tier: deck.tier,
    source: metadata.sourceType === 'curated-import' ? 'official' : 'ai-batch',
    availability: 'published',
    cardCount: deck.cardCount,
    tags: deck.tags,
  };
}

function mapCategory(category: string): DaoewoDeckView['category'] {
  switch (category) {
    case 'language':
      return '언어';
    case 'certification':
      return '자격증';
    case 'career':
      return '직무';
    case 'k12-secondary':
      return 'K-12';
    case 'general-knowledge':
    default:
      return '교양';
  }
}

function mapServerGoal(goal: ServerStudyGoal, requestedMode?: StudyGoalMode): StudyGoal {
  const assignments = Object.fromEntries(
    Object.entries(goal.assignments).map(([date, indexes]) => [date, indexes.map((index) => `${goal.deckId}-${index}`)])
  ) as Readonly<Record<LocalDateKey, readonly string[]>>;
  const dailyCount =
    goal.dailyTarget ?? Math.max(0, ...Object.values(goal.assignments).map((indexes) => indexes.length));
  return {
    key: goal.id,
    deckId: goal.deckId,
    mode: requestedMode ?? (goal.dailyTarget === undefined ? 'days' : 'daily-count'),
    startDate: goal.startDate,
    totalCount: goal.targetCount,
    days: Math.max(1, Object.keys(goal.assignments).length),
    dailyCount,
    assignments,
  };
}

function mapServerCard(card: ServerStudyCard, deckId: string, locale: string): DaoewoCardView {
  return {
    id: card.id,
    deckId,
    front: card.front,
    back: card.back,
    ...(card.hint === undefined ? {} : { hint: card.hint }),
    ...(card.example === undefined ? {} : { example: card.example }),
    tags: card.tags ?? [],
    locale,
  };
}

function mapBundledCard(card: PublishedCard, locale: string): DaoewoCardView {
  return {
    id: card.id,
    deckId: card.deckId,
    front: card.front,
    back: card.back,
    ...(card.hint === undefined ? {} : { hint: card.hint }),
    ...(card.reading === undefined ? {} : { reading: card.reading }),
    ...(card.example === undefined ? {} : { example: card.example }),
    ...(card.exampleMeaning === undefined ? {} : { exampleMeaning: card.exampleMeaning }),
    tags: card.tags,
    locale,
  };
}

function ratingFromProgress(progress: CardProgress): ReviewRating | null {
  switch (progress.lastOutcome) {
    case 'known':
    case 'easy':
      return 'easy';
    case 'confused':
      return 'confused';
    case 'unknown':
    case 'missed':
      return 'missed';
    case null:
      return null;
  }
}

function remainingAssignmentDays(assignments: Readonly<Record<string, readonly number[]>>): number {
  const today = toDateKey(new Date(), resolvedTimezone());
  return Object.entries(assignments).filter(([date, indexes]) => date >= today && indexes.length > 0).length;
}

function resolvedTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
}

function createSafeId(prefix: string): string {
  const random = Array.from({ length: 3 }, () => Math.random().toString(36).slice(2, 12)).join('');
  return `${prefix}_${Date.now().toString(36)}_${random}`.slice(0, 80);
}

export function selectSubscriptionProduct(
  products: readonly SubscriptionProductListItem[],
  plan: SubscriptionPlan
): SubscriptionProductListItem {
  const cycle = plan === 'monthly' ? 'MONTHLY' : 'YEARLY';
  const matches = products.filter((product) => product.renewalCycle === cycle);
  if (matches.length !== 1) {
    throw new Error(`${cycle} AppsInToss 구독 상품은 정확히 1개여야 해요.`);
  }
  return matches[0]!;
}

async function findSubscriptionProduct(plan: SubscriptionPlan): Promise<SubscriptionProductListItem> {
  return selectSubscriptionProduct(await listSubscriptionProducts(), plan);
}

async function listSubscriptionProducts(): Promise<readonly SubscriptionProductListItem[]> {
  const response = await IAP.getProductItemList();
  return (response?.products ?? []).filter(
    (product): product is SubscriptionProductListItem => product.type === 'SUBSCRIPTION'
  );
}

async function listPurchaseOffers(): Promise<readonly DaoewoPurchaseOffer[]> {
  const subscriptions = await listSubscriptionProducts();
  return (['monthly', 'annual'] as const).map((plan) =>
    mapAppsInTossPurchaseOffer(selectSubscriptionProduct(subscriptions, plan), plan)
  );
}

export function mapAppsInTossPurchaseOffer(
  product: SubscriptionProductListItem,
  plan: SubscriptionPlan
): DaoewoPurchaseOffer {
  const expectedCycle = plan === 'monthly' ? 'MONTHLY' : 'YEARLY';
  if (product.renewalCycle !== expectedCycle || product.displayAmount.trim().length === 0) {
    throw new Error('AppsInToss 구독 상품 표시 정보를 확인할 수 없어요.');
  }
  const trialDays = exactTrialDays(product.offers?.find((offer) => offer.type === 'FREE_TRIAL')?.period);
  return {
    plan,
    displayPrice: product.displayAmount,
    periodLabel: plan === 'monthly' ? '월' : '년',
    ...(product.description.trim().length === 0 ? {} : { description: product.description.trim() }),
    ...(trialDays === undefined ? {} : { trialDays }),
  };
}

function exactTrialDays(period: string | undefined): number | undefined {
  if (period === undefined) {
    return undefined;
  }
  const match = /^P(\d+)(D|W)$/i.exec(period.trim());
  if (match === null) {
    return undefined;
  }
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count <= 0) {
    return undefined;
  }
  return match[2]!.toUpperCase() === 'W' ? count * 7 : count;
}

async function purchaseSubscription(
  backend: AppsInTossBackend,
  product: SubscriptionProductListItem,
  plan: SubscriptionPlan
): Promise<DaoewoEntitlementState> {
  return new Promise((resolve, reject) => {
    const resource: { cleanup?: () => void } = {};
    let verifiedEntitlement: DaoewoEntitlementState | null = null;
    let settled = false;

    const finish = (action: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resource.cleanup?.();
      action();
    };

    const timeout = setTimeout(() => {
      finish(() => reject(new Error('구독 결제 응답 시간이 초과됐어요.')));
    }, PURCHASE_TIMEOUT_MS);

    const trialOffer = product.offers?.find((offer) => offer.type === 'FREE_TRIAL');
    resource.cleanup = IAP.createSubscriptionPurchaseOrder({
      options: {
        sku: product.sku,
        ...(trialOffer === undefined ? {} : { offerId: trialOffer.offerId }),
        processProductGrant: async ({ orderId, subscriptionId }) => {
          try {
            const entitlement = await backend.verifySubscriptionOrder({
              orderId,
              sku: product.sku,
              ...(subscriptionId === undefined ? {} : { subscriptionId }),
            });
            if (entitlement.plan !== 'pro') {
              return false;
            }
            verifiedEntitlement = { ...entitlement, billingPlan: plan };
            return true;
          } catch {
            return false;
          }
        },
      },
      onEvent: async () => {
        const entitlement = verifiedEntitlement ?? (await backend.getEntitlement());
        if (entitlement.plan !== 'pro') {
          finish(() => reject(new Error('구독 검증을 완료하지 못했어요.')));
          return;
        }
        finish(() => resolve({ ...entitlement, billingPlan: plan }));
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : '구독 결제에 실패했어요.';
        finish(() => reject(new Error(message)));
      },
    });
  });
}

function assertSubscriptionRuntimeSupported(): void {
  if (getOperationalEnvironment() === 'sandbox') {
    throw new Error('AppsInToss Sandbox App은 정기결제를 지원하지 않아요.');
  }
  if (!isMinVersionSupported({ android: '5.253.0', ios: '5.250.0' })) {
    throw new Error('정기결제를 사용하려면 토스 앱을 업데이트해 주세요.');
  }
}

function createExternalLinks(
  legalUrls: { readonly terms: string; readonly privacy: string } | undefined
): DaoewoRuntime['externalLinks'] | undefined {
  if (legalUrls === undefined || !isPublishedHttpsUrl(legalUrls.terms) || !isPublishedHttpsUrl(legalUrls.privacy)) {
    return undefined;
  }
  return {
    termsUrl: legalUrls.terms,
    privacyUrl: legalUrls.privacy,
    async open(url) {
      if (!isPublishedHttpsUrl(url)) {
        throw new Error('공개된 HTTPS 문서만 열 수 있어요.');
      }
      await openURL(url);
    },
  };
}

function isPublishedHttpsUrl(value: string): boolean {
  const normalized = value.trim();
  return (
    /^https:\/\/[^/\s]+(?:\/|$)/i.test(normalized) &&
    !/(?:example\.com|placeholder|localhost|127\.0\.0\.1)/i.test(normalized)
  );
}

function createUnconfiguredBackend(): AppsInTossBackend {
  const error = () => new Error('AppsInToss 서버 연결이 아직 설정되지 않았어요.');
  return {
    async getCurrentUser() {
      return null;
    },
    async signInWithToss() {
      throw error();
    },
    async signOut() {},
    async deleteAccount() {
      throw error();
    },
    async getEntitlement() {
      return FREE_ENTITLEMENT;
    },
    async verifySubscriptionOrder() {
      throw error();
    },
    async request() {
      throw error();
    },
  };
}

class HttpRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

async function postBackendJson<T>(
  url: string,
  body: Readonly<Record<string, unknown>>,
  headers: Readonly<Record<string, string>> = {}
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const envelope = (await parseJsonResponse(response)) as BackendEnvelope<T>;
  if (!response.ok || envelope.data === undefined) {
    throw new HttpRequestError(response.status, envelope.error?.message ?? '서버 요청에 실패했어요.');
  }
  return envelope.data;
}

async function postDirectJson<T>(url: string, body: string, headers: Readonly<Record<string, string>>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });
  const value = (await parseJsonResponse(response)) as T | { readonly error?: { readonly message?: string } };
  if (!response.ok) {
    const failure = value as { readonly error?: { readonly message?: string } };
    throw new HttpRequestError(response.status, failure.error?.message ?? '인증 서버 요청에 실패했어요.');
  }
  return value as T;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new HttpRequestError(response.status, '서버 응답을 확인할 수 없어요.');
  }
}

function activeEntitlement(response: ServerEntitlementResponse): DaoewoEntitlementState {
  if (response.active && response.entitlement !== null && response.entitlement.plan === 'pro') {
    return response.entitlement;
  }
  return FREE_ENTITLEMENT;
}

function expirationFromSeconds(value: string): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('Firebase 토큰 만료 시간을 확인할 수 없어요.');
  }
  return Date.now() + seconds * 1_000;
}

function expirationFromMillis(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Firebase App Check 만료 시간을 확인할 수 없어요.');
  }
  return Date.now() + value;
}

function requireNonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return normalized;
}

function requireNonEmptyUrl(value: string, name: string): string {
  const normalized = requireNonEmpty(value, name).replace(/\/+$/, '');
  const url = new URL(normalized);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1') {
    throw new Error(`${name} must use HTTPS.`);
  }
  return normalized;
}
