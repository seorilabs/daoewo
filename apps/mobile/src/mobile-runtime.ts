import {appleAuth} from '@invertase/react-native-apple-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  listPublicCatalog,
  type CatalogDeckForEntitlement,
  type PublicDeckMetadata,
} from '@daoewo/product-catalog';
import {
  createBundledFreeContentAdapter,
  type BundledFreeContentAdapter,
  type PublishedCard,
} from '@daoewo/product-catalog/bundled-free-content';
import type {
  CardProgress,
  LocalDateKey,
  ReviewRating,
  StudyGoal,
} from '@daoewo/product-core';
import {
  addDaysToDateKey,
  createDeliveryWindowDeckRegistry,
  daysBetweenDateKeys,
  toDateKey,
} from '@daoewo/product-core';
import {getAnalytics, logEvent} from '@react-native-firebase/analytics';
import {
  ReactNativeFirebaseAppCheckProvider,
  initializeAppCheck,
} from '@react-native-firebase/app-check';
import {
  GoogleAuthProvider,
  OAuthProvider,
  getAuth,
  getIdToken,
  linkWithCredential,
  reauthenticateWithCredential,
  revokeToken,
  signInAnonymously,
  signInWithCredential,
  signOut,
  type AuthCredential,
  type User,
} from '@react-native-firebase/auth';
import {getFunctions, httpsCallable} from '@react-native-firebase/functions';
import {GoogleSignin} from '@react-native-google-signin/google-signin';
import {
  type DaoewoAnalyticsValue,
  type DaoewoCardView,
  type DaoewoContentPort,
  type DaoewoCreateGoalInput,
  type DaoewoDeckView,
  type DaoewoEntitlementState,
  type DaoewoPurchaseOffer,
  type DaoewoRuntime,
  type DaoewoUser,
  type SubscriptionPlan,
} from '@daoewo/product-ui';
import {
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  isEligibleForIntroOfferIOS,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type ProductSubscription,
  type Purchase,
} from 'react-native-iap';
import {AccessibilityInfo, Linking, Platform} from 'react-native';

import type {MobileRuntimeConfig} from './runtime-config';
import {resolveMobileAccountDeletionProof} from './account-deletion-policy';
import {
  createStoreAccountBinding,
  type StoreAccountBinding,
} from './store-account-binding';

const PURCHASE_TIMEOUT_MS = 120_000;
const DEVICE_ID_KEY = 'daoewo:device-id:v1';
const FIREBASE_LOCAL_GUEST_KEY = 'daoewo:auth:firebase-local-guest:v1';
const FREE_ENTITLEMENT: DaoewoEntitlementState = {
  plan: 'free',
  source: 'firebase-default',
  validUntil: null,
};

interface CallableResult<T> {
  readonly data: T;
}

interface ServerEntitlementResponse {
  readonly active: boolean;
  readonly entitlement: DaoewoEntitlementState | null;
}

interface ReceiptRequest {
  readonly platform: 'google-play' | 'app-store';
  readonly productId: string;
  readonly purchaseToken?: string;
  readonly transactionId?: string;
  readonly packageName?: string;
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
  readonly targetCount: number;
  readonly startDate: string;
  readonly endDate?: string;
  readonly dailyTarget?: number;
  readonly assignments: Readonly<Record<string, readonly number[]>>;
}

interface ServerStudyCard {
  readonly id: string;
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
    readonly cards: Readonly<Record<string, unknown>>;
  }[];
}

export function createMobileRuntime(config: MobileRuntimeConfig): DaoewoRuntime {
  if (!config.firebaseEnabled) {
    throw new Error('Firebase mobile runtime is disabled.');
  }

  const auth = getAuth();
  const analytics = getAnalytics();
  const functions = getFunctions(undefined, config.functionsRegion);
  const appCheckReady = initializeAppCheck(undefined, {
    provider: new ReactNativeFirebaseAppCheckProvider({
      android: {provider: __DEV__ ? 'debug' : 'playIntegrity'},
      apple: {
        provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback',
      },
    }),
    isTokenAutoRefreshEnabled: true,
  });
  const getStoreReady = createStoreConnectionProvider();
  const getDeviceId = createDeviceIdProvider();
  const externalLinks = createExternalLinks(config.legalUrls);
  const storage = createJsonAsyncStorage();
  const bundledFree = createBundledFreeContentAdapter({
    storage,
    getOwnerId: async () =>
      auth.currentUser?.uid ??
      (await storage.getItem<DaoewoUser>(FIREBASE_LOCAL_GUEST_KEY))?.id ??
      null,
  });

  if (config.googleWebClientId.trim().length > 0) {
    GoogleSignin.configure({webClientId: config.googleWebClientId});
  }

  const callEntitlement = httpsCallable<
    Record<string, never>,
    ServerEntitlementResponse
  >(functions, 'getEntitlement');
  const callVerifyReceipt = httpsCallable<
    ReceiptRequest,
    ServerEntitlementResponse
  >(functions, 'verifyReceipt');
  const callMergeAnonymous = httpsCallable<
    {sourceIdToken: string; targetIdToken: string; deviceId: string},
    {merge: unknown}
  >(functions, 'mergeAnonymousAccount');
  const callDeleteAccount = httpsCallable<
    {confirmation: 'DELETE'},
    {deleted: true}
  >(functions, 'deleteAccount');

  async function signInOrLinkAccount(
    credential: AuthCredential,
  ): Promise<DaoewoUser> {
    const currentUser = auth.currentUser;
    if (currentUser?.isAnonymous !== true) {
      const result = await signInWithCredential(auth, credential);
      return toDaoewoUser(result.user);
    }

    const sourceIdToken = await getIdToken(currentUser, true);
    try {
      const linked = await linkWithCredential(currentUser, credential);
      return toDaoewoUser(linked.user);
    } catch (error) {
      if (!isCredentialAlreadyLinkedError(error)) {
        throw error;
      }
    }

    const target = await signInWithCredential(auth, credential);
    const targetIdToken = await getIdToken(target.user, true);
    await appCheckReady;
    await callMergeAnonymous({
      sourceIdToken,
      targetIdToken,
      deviceId: await getDeviceId(),
    });
    await bundledFree.mergeOwnerState(currentUser.uid, target.user.uid);
    return toDaoewoUser(target.user);
  }

  async function getEntitlement(): Promise<DaoewoEntitlementState> {
    if (auth.currentUser === null) {
      return FREE_ENTITLEMENT;
    }
    await appCheckReady;
    const result = (await callEntitlement({})) as CallableResult<ServerEntitlementResponse>;
    return result.data.active && result.data.entitlement !== null
      ? result.data.entitlement
      : FREE_ENTITLEMENT;
  }

  async function verifyPurchase(
    purchase: Purchase,
  ): Promise<DaoewoEntitlementState> {
    await appCheckReady;
    const request = receiptRequestFromPurchase(purchase);
    const result = (await callVerifyReceipt(request)) as CallableResult<ServerEntitlementResponse>;
    if (
      !result.data.active ||
      result.data.entitlement === null ||
      result.data.entitlement.plan !== 'pro'
    ) {
      throw new Error('구독 영수증 검증에 실패했어요.');
    }
    await finishTransaction({purchase, isConsumable: false});
    return result.data.entitlement;
  }

  return {
    analytics: {
      async track(name, properties) {
        await logEvent(
          analytics,
          name,
          normalizeAnalyticsProperties(
            properties as Readonly<Record<string, DaoewoAnalyticsValue>>,
          ),
        );
      },
    },
    storage,
    auth: {
      async getCurrentUser() {
        if (auth.currentUser !== null) {
          return toDaoewoUser(auth.currentUser);
        }
        const localGuest = await storage.getItem<DaoewoUser>(
          FIREBASE_LOCAL_GUEST_KEY,
        );
        return localGuest?.isGuest === true ? localGuest : null;
      },
      async continueAsGuest() {
        if (auth.currentUser !== null) {
          return toDaoewoUser(auth.currentUser);
        }
        const existing = await storage.getItem<DaoewoUser>(
          FIREBASE_LOCAL_GUEST_KEY,
        );
        let credential: Awaited<ReturnType<typeof signInAnonymously>>;
        try {
          credential = await signInAnonymously(auth);
        } catch {
          if (existing?.isGuest === true) {
            return existing;
          }
          const guest: DaoewoUser = {
            id: createSafeId('mobile-offline-guest'),
            displayName: '게스트',
            isGuest: true,
          };
          await storage.setItem(FIREBASE_LOCAL_GUEST_KEY, guest);
          return guest;
        }
        if (
          existing?.isGuest === true &&
          existing.id !== credential.user.uid
        ) {
          await bundledFree.mergeOwnerState(existing.id, credential.user.uid);
        }
        await storage.removeItem(FIREBASE_LOCAL_GUEST_KEY);
        return toDaoewoUser(credential.user);
      },
      async signIn(provider) {
        const localGuest = await storage.getItem<DaoewoUser>(
          FIREBASE_LOCAL_GUEST_KEY,
        );
        let signedIn: DaoewoUser;
        if (provider === 'google') {
          const credential = await googleCredential(config.googleWebClientId);
          signedIn = await signInOrLinkAccount(credential);
        } else if (provider === 'apple') {
          const credential = await appleCredential();
          signedIn = await signInOrLinkAccount(credential);
        } else {
          throw new Error('지원하지 않는 로그인 방식이에요.');
        }
        if (localGuest?.isGuest === true && localGuest.id !== signedIn.id) {
          await bundledFree.mergeOwnerState(localGuest.id, signedIn.id);
        }
        await storage.removeItem(FIREBASE_LOCAL_GUEST_KEY);
        return signedIn;
      },
      async signOut() {
        const localGuest = await storage.getItem<DaoewoUser>(
          FIREBASE_LOCAL_GUEST_KEY,
        );
        const ownerId = auth.currentUser?.uid ?? localGuest?.id;
        if (ownerId !== undefined) {
          await bundledFree.removeOwnerState(ownerId);
        }
        await Promise.all([
          auth.currentUser === null ? Promise.resolve() : signOut(auth),
          storage.removeItem(FIREBASE_LOCAL_GUEST_KEY),
          GoogleSignin.signOut().catch(() => null),
        ]);
      },
      async deleteAccount() {
        const user = auth.currentUser;
        if (user === null) {
          await removeAllDaoewoStorage();
          return;
        }
        const providerIds = new Set(
          user.providerData.map(provider => provider.providerId),
        );
        const proof = resolveMobileAccountDeletionProof({
          isAnonymous: user.isAnonymous,
          providerIds,
          platform: Platform.OS,
        });
        if (proof === 'google-reauthentication') {
          await reauthenticateWithCredential(
            user,
            await googleCredential(config.googleWebClientId),
          );
        } else if (proof === 'apple-reauthentication') {
          const response = await appleAuth.performRequest({
            requestedOperation: appleAuth.Operation.LOGIN,
          });
          if (response.identityToken === null) {
            throw new Error('Apple 재인증 토큰을 확인할 수 없어요.');
          }
          await reauthenticateWithCredential(
            user,
            new OAuthProvider('apple.com').credential({
              idToken: response.identityToken,
              rawNonce: response.nonce ?? undefined,
            }),
          );
          if (response.authorizationCode !== null) {
            await revokeToken(auth, response.authorizationCode);
          }
        } else {
          // 익명 계정에는 재인증 credential이 없어 서버가 token 폐기 여부와 App Check를 검증한다.
          await getIdToken(user, true);
        }
        await appCheckReady;
        await callDeleteAccount({confirmation: 'DELETE'});
        await GoogleSignin.revokeAccess().catch(() => null);
        await removeAllDaoewoStorage();
        await signOut(auth).catch(() => undefined);
      },
    },
    purchase: {
      async getOffers() {
        await getStoreReady();
        return fetchPurchaseOffers(config);
      },
      async getEntitlement() {
        return getEntitlement();
      },
      async purchase(plan) {
        const purchasingUser = ensurePurchasableUser(auth.currentUser);
        await getStoreReady();
        const productId = productIdForPlan(config, plan);
        const product = await fetchSubscription(productId);
        const entitlement = await requestAndVerifySubscription(
          product,
          createStoreAccountBinding(purchasingUser.uid),
          purchase => verifyPurchase(purchase),
        );
        return {...entitlement, billingPlan: plan};
      },
      async restore() {
        ensurePurchasableUser(auth.currentUser);
        await getStoreReady();
        const configured = new Set([
          config.subscriptionProductIds.monthly,
          config.subscriptionProductIds.annual,
        ]);
        const purchases = await getAvailablePurchases();
        let restored: DaoewoEntitlementState | null = null;
        for (const purchase of purchases) {
          if (configured.has(purchase.productId)) {
            restored = await verifyPurchase(purchase);
          }
        }
        return restored ?? getEntitlement();
      },
    },
    tts: {
      async speak(text) {
        AccessibilityInfo.announceForAccessibility(text);
      },
      async stop() {},
    },
    content: createFirebaseContentPort({
      auth,
      functions,
      appCheckReady,
      getDeviceId,
      getEntitlement,
      bundledFree,
    }),
    ...(externalLinks === undefined ? {} : {externalLinks}),
    now: () => new Date(),
  };
}

async function removeAllDaoewoStorage(): Promise<void> {
  const daoewoKeys = (await AsyncStorage.getAllKeys()).filter(key =>
    key.startsWith('daoewo:'),
  );
  if (daoewoKeys.length > 0) {
    await Promise.all(daoewoKeys.map(key => AsyncStorage.removeItem(key)));
  }
}

function createJsonAsyncStorage(): DaoewoRuntime['storage'] {
  return {
    async getItem<T>(key: string) {
      const value = await AsyncStorage.getItem(key);
      if (value === null) {
        return null;
      }
      try {
        return JSON.parse(value) as T;
      } catch {
        await AsyncStorage.removeItem(key);
        return null;
      }
    },
    async setItem<T>(key: string, value: T) {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    },
    async removeItem(key: string) {
      await AsyncStorage.removeItem(key);
    },
  };
}

async function googleCredential(webClientId: string): Promise<AuthCredential> {
  if (webClientId.trim().length === 0) {
    throw new Error('Google 로그인 설정이 필요해요.');
  }
  if (Platform.OS === 'android') {
    await GoogleSignin.hasPlayServices({showPlayServicesUpdateDialog: true});
  }
  const response = await GoogleSignin.signIn();
  if (response.type !== 'success' || response.data.idToken === null) {
    throw new Error('Google 로그인이 취소됐어요.');
  }
  return GoogleAuthProvider.credential(response.data.idToken);
}

async function appleCredential(): Promise<AuthCredential> {
  if (Platform.OS !== 'ios') {
    throw new Error('Apple 로그인은 iOS에서 사용할 수 있어요.');
  }
  const response = await appleAuth.performRequest({
    requestedOperation: appleAuth.Operation.LOGIN,
    requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
  });
  if (response.identityToken === null) {
    throw new Error('Apple 로그인 토큰을 확인할 수 없어요.');
  }
  return new OAuthProvider('apple.com').credential({
    idToken: response.identityToken,
    rawNonce: response.nonce ?? undefined,
  });
}

function toDaoewoUser(user: User): DaoewoUser {
  return {
    id: user.uid,
    displayName: user.displayName?.trim() || (user.isAnonymous ? '게스트' : '다외워 사용자'),
    ...(user.email === null ? {} : {email: user.email}),
    isGuest: user.isAnonymous,
  };
}

function createDeviceIdProvider(): () => Promise<string> {
  let pending: Promise<string> | null = null;
  return () => {
    pending ??= (async () => {
      const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (stored !== null && /^[A-Za-z0-9_-]{16,128}$/.test(stored)) {
        return stored;
      }
      const created = createSafeId('mobile');
      await AsyncStorage.setItem(DEVICE_ID_KEY, created);
      return created;
    })().catch(error => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

function isCredentialAlreadyLinkedError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = String(error.code);
  return (
    code === 'auth/credential-already-in-use' ||
    code === 'auth/email-already-in-use' ||
    code === 'auth/account-exists-with-different-credential'
  );
}

function mapPublicDeck(deck: CatalogDeckForEntitlement): DaoewoDeckView {
  return {
    id: deck.id,
    title: deck.title,
    subtitle: deck.description,
    category: mapCatalogCategory(deck.category),
    locale: mapContentLanguage(deck.contentLanguage),
    tier: deck.tier,
    source:
      deck.sourceType === 'curated-import' ? 'official' : 'ai-batch',
    availability: deck.availability,
    cardCount: deck.cardCount,
    tags: deck.tags,
    isNew: deck.priority === 'P1',
  };
}

function mapServerDeck(
  deck: ServerCatalogDeck,
  metadata: PublicDeckMetadata,
): DaoewoDeckView {
  return {
    id: deck.id,
    title: deck.title,
    subtitle: deck.description,
    category: mapCatalogCategory(metadata.category),
    locale: mapContentLanguage(metadata.contentLanguage),
    tier: deck.tier,
    source:
      metadata.sourceType === 'curated-import' ? 'official' : 'ai-batch',
    availability: 'published',
    cardCount: deck.cardCount,
    tags: deck.tags,
    isNew: metadata.priority === 'P1',
  };
}

function mapCatalogCategory(
  category: PublicDeckMetadata['category'],
): DaoewoDeckView['category'] {
  switch (category) {
    case 'language':
      return '언어';
    case 'certification':
      return '자격증';
    case 'career':
      return '직무';
    case 'general-knowledge':
      return '교양';
    case 'k12-secondary':
      return 'K-12';
  }
}

function mapContentLanguage(
  language: PublicDeckMetadata['contentLanguage'],
): string {
  switch (language) {
    case 'ko':
      return '한국어';
    case 'en':
      return '영어';
    case 'ja':
      return '일본어';
  }
}

function mapServerGoal(
  goal: ServerStudyGoal,
  mode: StudyGoal['mode'],
): StudyGoal {
  const assignments = Object.fromEntries(
    Object.entries(goal.assignments).map(([date, indexes]) => [
      date,
      indexes.map(index => `${goal.deckId}:${index}`),
    ]),
  ) as Readonly<Record<LocalDateKey, readonly string[]>>;
  const dayCounts = Object.values(assignments).map(cards => cards.length);
  const days = Object.keys(assignments).length;
  return {
    key: goal.id,
    deckId: goal.deckId,
    mode,
    startDate: goal.startDate as LocalDateKey,
    totalCount: goal.targetCount,
    days,
    dailyCount:
      goal.dailyTarget ?? (dayCounts.length === 0 ? 0 : Math.max(...dayCounts)),
    assignments,
  };
}

function mapServerCard(
  card: ServerStudyCard,
  deckId: string,
  locale: string | undefined,
): DaoewoCardView {
  return {
    id: card.id,
    deckId,
    front: card.front,
    back: card.back,
    ...(card.hint === undefined ? {} : {hint: card.hint}),
    ...(card.example === undefined ? {} : {example: card.example}),
    tags: card.tags ?? [],
    locale: locale ?? '한국어',
  };
}

function mapBundledCard(
  card: PublishedCard,
  locale: string | undefined,
): DaoewoCardView {
  return {
    id: card.id,
    deckId: card.deckId,
    front: card.front,
    back: card.back,
    ...(card.hint === undefined ? {} : {hint: card.hint}),
    ...(card.reading === undefined ? {} : {reading: card.reading}),
    ...(card.example === undefined ? {} : {example: card.example}),
    ...(card.exampleMeaning === undefined
      ? {}
      : {exampleMeaning: card.exampleMeaning}),
    tags: card.tags,
    locale: locale ?? '한국어',
  };
}

function remainingAssignmentDays(
  assignments: Readonly<Record<string, readonly number[]>>,
): number {
  const dates = Object.entries(assignments)
    .filter(([, indexes]) => indexes.length > 0)
    .map(([date]) => date)
    .sort();
  const lastDate = dates.at(-1);
  if (lastDate === undefined) {
    return 0;
  }
  const today = toDateKey(new Date(), resolvedTimezone());
  return Math.max(0, daysBetweenDateKeys(today, lastDate) + 1);
}

function resolvedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
  } catch {
    return 'Asia/Seoul';
  }
}

function addLocalDays(date: LocalDateKey, days: number): LocalDateKey {
  return addDaysToDateKey(date, days);
}

function ratingFromProgress(progress: CardProgress): ReviewRating | null {
  switch (progress.lastOutcome) {
    case 'known':
    case 'easy':
      return 'easy';
    case 'unknown':
    case 'missed':
      return 'missed';
    case 'confused':
      return 'confused';
    case null:
      return null;
  }
}

function createSafeId(prefix: string): string {
  const random = `${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}`;
  return `${prefix}_${Date.now().toString(36)}_${random}`.slice(0, 128);
}

function createFirebaseContentPort(input: {
  readonly auth: ReturnType<typeof getAuth>;
  readonly functions: ReturnType<typeof getFunctions>;
  readonly appCheckReady: Promise<unknown>;
  readonly getDeviceId: () => Promise<string>;
  readonly getEntitlement: () => Promise<DaoewoEntitlementState>;
  readonly bundledFree: BundledFreeContentAdapter;
}): DaoewoContentPort {
  const serverWindows = createDeliveryWindowDeckRegistry();
  const callCatalog = httpsCallable<
    Record<string, never>,
    {decks: readonly ServerCatalogDeck[]}
  >(input.functions, 'getCatalog');
  const callSyncState = httpsCallable<
    {deviceId: string},
    {syncState: ServerSyncState}
  >(input.functions, 'getSyncState');
  const callCreateGoal = httpsCallable<
    Record<string, unknown>,
    {goal: ServerStudyGoal}
  >(input.functions, 'createOrResetGoal');
  const callWindow = httpsCallable<
    {goalId: string; deviceId: string},
    {window: ServerCardWindow}
  >(input.functions, 'getTodayWindow');
  const callProgress = httpsCallable<
    Record<string, unknown>,
    unknown
  >(input.functions, 'submitProgressBatch');
  const callDeckRequest = httpsCallable<
    Record<string, unknown>,
    unknown
  >(input.functions, 'createDeckRequest');

  let catalogCache: readonly DaoewoDeckView[] = [];

  async function localCatalog(
    entitlement: DaoewoEntitlementState,
  ): Promise<readonly DaoewoDeckView[]> {
    const staticCatalog = listPublicCatalog(
      entitlement.plan === 'pro' ? 'pro' : 'free',
    );
    return Promise.all(
      staticCatalog.map(async metadata => {
        const base = mapPublicDeck(metadata);
        if (!input.bundledFree.hasDeck(metadata.id)) {
          return base;
        }
        const summary = await input.bundledFree
          .getDeckSummary(metadata.id)
          .catch(() => null);
        return summary === null || !summary.active
          ? base
          : {...base, progress: summary.progress, daysLeft: summary.daysLeft};
      }),
    );
  }

  async function listCatalog(): Promise<readonly DaoewoDeckView[]> {
    const entitlement = await input.getEntitlement().catch(() => FREE_ENTITLEMENT);
    const staticCatalog = listPublicCatalog(
      entitlement.plan === 'pro' ? 'pro' : 'free',
    );
    const local = await localCatalog(entitlement);
    const localById = new Map(local.map(deck => [deck.id, deck] as const));
    if (input.auth.currentUser === null) {
      catalogCache = local;
      return catalogCache;
    }

    let catalogResult: CallableResult<{decks: readonly ServerCatalogDeck[]}>;
    let syncResult: CallableResult<{syncState: ServerSyncState}>;
    try {
      await input.appCheckReady;
      const deviceId = await input.getDeviceId();
      [catalogResult, syncResult] = await Promise.all([
        callCatalog({}) as Promise<CallableResult<{decks: readonly ServerCatalogDeck[]}>>,
        callSyncState({deviceId}) as Promise<CallableResult<{syncState: ServerSyncState}>>,
      ]);
    } catch {
      // 서버가 오프라인이어도 검증된 Free bundle 학습은 계속 가능하다. Pro는 잠금 상태로 fail-closed한다.
      catalogCache = await localCatalog(FREE_ENTITLEMENT);
      return catalogCache;
    }
    const serverById = new Map(
      catalogResult.data.decks.map(deck => [deck.id, deck] as const),
    );
    const goalsByDeck = new Map(
      syncResult.data.syncState.goals.map(goal => [goal.deckId, goal] as const),
    );
    const progressByDeck = new Map(
      syncResult.data.syncState.progress.map(progress => [
        progress.deckId,
        progress,
      ] as const),
    );

    catalogCache = staticCatalog.map(metadata => {
      if (metadata.tier === 'free') {
        return localById.get(metadata.id) ?? mapPublicDeck(metadata);
      }
      const published = serverById.get(metadata.id);
      const goal = goalsByDeck.get(metadata.id);
      const progress = progressByDeck.get(metadata.id);
      const base =
        published === undefined
          ? mapPublicDeck(metadata)
          : mapServerDeck(published, metadata);
      if (goal === undefined) {
        return base;
      }
      const completed = Object.keys(progress?.cards ?? {}).length;
      return {
        ...base,
        progress:
          goal.targetCount === 0
            ? 0
            : Math.min(1, completed / goal.targetCount),
        daysLeft: remainingAssignmentDays(goal.assignments),
      };
    });
    return catalogCache;
  }

  return {
    listCatalog,
    async getDeck(deckId) {
      const decks = catalogCache.length > 0 ? catalogCache : await listCatalog();
      return decks.find(deck => deck.id === deckId) ?? null;
    },
    async createGoal(goalInput: DaoewoCreateGoalInput) {
      if (input.bundledFree.hasDeck(goalInput.deckId)) {
        return input.bundledFree.createGoal(goalInput);
      }
      const decks = catalogCache.length > 0 ? catalogCache : await listCatalog();
      const deck = decks.find(item => item.id === goalInput.deckId);
      if (
        deck === undefined ||
        deck.availability !== 'published' ||
        deck.cardCount === null ||
        deck.cardCount <= 0
      ) {
        throw new Error('승인된 덱 본문이 아직 준비되지 않았어요.');
      }
      if (deck.tier === 'free') {
        throw new Error('이 Free 덱은 앱 업데이트 후 오프라인 학습할 수 있어요.');
      }
      await input.appCheckReady;
      const result = await callCreateGoal({
        deckId: deck.id,
        targetCount: deck.cardCount,
        startDate: goalInput.startDate,
        timezone: resolvedTimezone(),
        deviceId: await input.getDeviceId(),
        ...(goalInput.mode === 'days'
          ? {endDate: addLocalDays(goalInput.startDate, goalInput.value - 1)}
          : {dailyTarget: goalInput.value}),
      });
      return mapServerGoal(result.data.goal, goalInput.mode);
    },
    async getCardWindow(windowInput) {
      if (input.bundledFree.hasDeck(windowInput.deckId)) {
        const window = await input.bundledFree.getCardWindow(windowInput);
        const deck =
          catalogCache.find(item => item.id === window.deckId) ?? null;
        return {
          id: window.id,
          deckId: window.deckId,
          goalKey: window.goalKey,
          cards: window.cards.map(card =>
            mapBundledCard(card, deck?.locale),
          ),
          targetCount: window.targetCount,
        };
      }
      const metadata = listPublicCatalog('pro').find(
        deck => deck.id === windowInput.deckId,
      );
      if (metadata?.tier !== 'pro') {
        throw new Error('승인된 Free 덱 본문이 아직 준비되지 않았어요.');
      }
      await input.appCheckReady;
      const result = await callWindow({
        goalId: windowInput.goalKey ?? windowInput.deckId,
        deviceId: await input.getDeviceId(),
      });
      const deck =
        catalogCache.find(item => item.id === result.data.window.deckId) ??
        null;
      serverWindows.bind({
        requestedDeckId: windowInput.deckId,
        authoritativeDeckId: result.data.window.deckId,
        windowId: result.data.window.windowId,
      });
      return {
        id: result.data.window.windowId,
        deckId: result.data.window.deckId,
        ...(windowInput.goalKey === undefined
          ? {}
          : {goalKey: windowInput.goalKey}),
        cards: result.data.window.cards.map(card =>
          mapServerCard(card, result.data.window.deckId, deck?.locale),
        ),
        targetCount: result.data.window.cards.length,
        expiresAt: result.data.window.expiresAt,
      };
    },
    async commitProgressBatch(batch) {
      if (input.bundledFree.hasDeck(batch.deckId)) {
        await input.bundledFree.commitProgressBatch(batch);
        return;
      }
      const metadata = listPublicCatalog('pro').find(
        deck => deck.id === batch.deckId,
      );
      if (metadata?.tier !== 'pro') {
        throw new Error('승인된 Free 덱 본문이 아직 준비되지 않았어요.');
      }
      serverWindows.assertBound(batch.windowId, batch.deckId);
      const answers = batch.progresses
        .map(progress => ({
          cardId: progress.cardId,
          rating: ratingFromProgress(progress),
        }))
        .filter(
          (answer): answer is {cardId: string; rating: ReviewRating} =>
            answer.rating !== null,
        );
      if (answers.length === 0) {
        return;
      }
      await input.appCheckReady;
      await callProgress({
        batchId: createSafeId('batch'),
        windowId: batch.windowId,
        deviceId: await input.getDeviceId(),
        answers,
      });
    },
    async submitDeckRequest(request) {
      await input.appCheckReady;
      await callDeckRequest({
        topic: request.topic,
        category: request.category,
        language: request.locale,
        ...(request.note === undefined ? {} : {note: request.note}),
      });
    },
  };
}

function createStoreConnection(): Promise<void> {
  return initConnection().then(connected => {
    if (!connected) {
      throw new Error('스토어에 연결할 수 없어요.');
    }
  });
}

function createStoreConnectionProvider(): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    pending ??= createStoreConnection().catch(error => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

async function fetchSubscription(
  productId: string,
): Promise<ProductSubscription> {
  const products = await fetchProducts({skus: [productId], type: 'subs'});
  const matches = (products ?? []).filter(
    (product): product is ProductSubscription =>
      product.type === 'subs' && product.id === productId,
  );
  if (matches.length !== 1) {
    throw new Error('스토어 구독 상품을 확인할 수 없어요.');
  }
  return matches[0]!;
}

async function fetchPurchaseOffers(
  config: MobileRuntimeConfig,
): Promise<readonly DaoewoPurchaseOffer[]> {
  const configured = [
    ['monthly', productIdForPlan(config, 'monthly')],
    ['annual', productIdForPlan(config, 'annual')],
  ] as const;
  if (configured[0][1] === configured[1][1]) {
    throw new Error('월간·연간 구독 상품 ID를 각각 설정해 주세요.');
  }
  const products = await fetchProducts({
    skus: configured.map(([, productId]) => productId),
    type: 'subs',
  });
  const subscriptions = (products ?? []).filter(
    (product): product is ProductSubscription => product.type === 'subs',
  );

  return Promise.all(
    configured.map(async ([plan, productId]) => {
      const matches = subscriptions.filter(product => product.id === productId);
      if (matches.length !== 1) {
        throw new Error('스토어 구독 상품을 확인할 수 없어요.');
      }
      return mapPurchaseOffer(matches[0]!, plan);
    }),
  );
}

async function mapPurchaseOffer(
  product: ProductSubscription,
  plan: SubscriptionPlan,
): Promise<DaoewoPurchaseOffer> {
  const base = {
    plan,
    displayPrice: androidRecurringPrice(product) ?? product.displayPrice,
    periodLabel: plan === 'monthly' ? '월' : '년',
    ...(product.description.trim().length === 0
      ? {}
      : {description: product.description.trim()}),
  } satisfies DaoewoPurchaseOffer;
  const trialDays =
    product.platform === 'android'
      ? androidTrialDays(product)
      : await iosTrialDays(product);
  return trialDays === undefined ? base : {...base, trialDays};
}

function androidRecurringPrice(
  product: ProductSubscription,
): string | undefined {
  if (product.platform !== 'android') {
    return undefined;
  }
  const offer = selectedAndroidSubscriptionOffer(product);
  const paidPhases =
    offer?.pricingPhasesAndroid?.pricingPhaseList.filter(
      phase => phase.priceAmountMicros !== '0' && phase.formattedPrice.trim().length > 0,
    ) ?? [];
  return paidPhases.at(-1)?.formattedPrice;
}

function androidTrialDays(product: ProductSubscription): number | undefined {
  if (product.platform !== 'android') {
    return undefined;
  }
  const offer = selectedAndroidSubscriptionOffer(product);
  const trial = offer?.pricingPhasesAndroid?.pricingPhaseList.find(
    phase => phase.priceAmountMicros === '0',
  );
  return trial === undefined ? undefined : exactTrialDays(trial.billingPeriod);
}

async function iosTrialDays(
  product: ProductSubscription,
): Promise<number | undefined> {
  if (
    product.platform !== 'ios' ||
    product.introductoryPricePaymentModeIOS !== 'free-trial' ||
    product.subscriptionGroupIdIOS == null ||
    product.subscriptionGroupIdIOS.trim().length === 0
  ) {
    return undefined;
  }
  const eligible = await isEligibleForIntroOfferIOS(
    product.subscriptionGroupIdIOS,
  ).catch(() => false);
  if (!eligible) {
    return undefined;
  }
  const unit = product.introductoryPriceSubscriptionPeriodIOS;
  const count = Number(product.introductoryPriceNumberOfPeriodsIOS ?? '1');
  if (!Number.isSafeInteger(count) || count <= 0 || unit == null) {
    return undefined;
  }
  return exactTrialDays(`${unit}:${count}`);
}

function selectedAndroidSubscriptionOffer(
  product: Extract<ProductSubscription, {platform: 'android'}>,
) {
  const offers = product.subscriptionOffers.filter(
    offer => offer.offerTokenAndroid != null,
  );
  return (
    offers.find(offer =>
      offer.pricingPhasesAndroid?.pricingPhaseList.some(
        phase => phase.priceAmountMicros === '0',
      ),
    ) ?? offers[0]
  );
}

function exactTrialDays(period: string): number | undefined {
  const iso = /^P(\d+)(D|W)$/i.exec(period);
  if (iso !== null) {
    const count = Number(iso[1]);
    if (Number.isSafeInteger(count) && count > 0) {
      return iso[2]!.toUpperCase() === 'W' ? count * 7 : count;
    }
    return undefined;
  }
  const apple = /^(day|week):(\d+)$/i.exec(period);
  if (apple === null) {
    return undefined;
  }
  const count = Number(apple[2]);
  if (!Number.isSafeInteger(count) || count <= 0) {
    return undefined;
  }
  return apple[1]!.toLowerCase() === 'week' ? count * 7 : count;
}

function requestAndVerifySubscription(
  product: ProductSubscription,
  accountBinding: StoreAccountBinding,
  verify: (purchase: Purchase) => Promise<DaoewoEntitlementState>,
): Promise<DaoewoEntitlementState> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const purchaseSubscription = purchaseUpdatedListener(async purchase => {
      if (purchase.productId !== product.id || settled) {
        return;
      }
      try {
        const entitlement = await verify(purchase);
        finish(() => resolve(entitlement));
      } catch (error) {
        finish(() => reject(error));
      }
    });
    const errorSubscription = purchaseErrorListener(error => {
      finish(() => reject(new Error(error.message)));
    });
    const timeout = setTimeout(() => {
      finish(() => reject(new Error('구독 결제 응답 시간이 초과됐어요.')));
    }, PURCHASE_TIMEOUT_MS);

    function finish(action: () => void): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      purchaseSubscription.remove();
      errorSubscription.remove();
      action();
    }

    const androidOffer =
      product.platform === 'android'
        ? selectAndroidOffer(product)
        : undefined;
    requestPurchase({
      type: 'subs',
      request: {
        apple: {
          sku: product.id,
          appAccountToken: accountBinding.appleAppAccountToken,
        },
        google: {
          skus: [product.id],
          obfuscatedAccountId: accountBinding.googleObfuscatedAccountId,
          ...(androidOffer === undefined
            ? {}
            : {
                subscriptionOffers: [
                  {sku: product.id, offerToken: androidOffer},
                ],
              }),
        },
      },
    }).catch(error => finish(() => reject(error)));
  });
}

function selectAndroidOffer(product: ProductSubscription): string | undefined {
  if (product.platform !== 'android') {
    return undefined;
  }
  return selectedAndroidSubscriptionOffer(product)?.offerTokenAndroid ?? undefined;
}

function receiptRequestFromPurchase(purchase: Purchase): ReceiptRequest {
  if ('packageNameAndroid' in purchase) {
    if (purchase.purchaseToken == null) {
      throw new Error('Google Play 구매 토큰을 확인할 수 없어요.');
    }
    return {
      platform: 'google-play',
      productId: purchase.productId,
      purchaseToken: purchase.purchaseToken,
      ...(purchase.packageNameAndroid == null
        ? {}
        : {packageName: purchase.packageNameAndroid}),
    };
  }
  if (purchase.id.length === 0) {
    throw new Error('App Store 거래 ID를 확인할 수 없어요.');
  }
  return {
    platform: 'app-store',
    productId: purchase.productId,
    transactionId: purchase.id,
  };
}

function productIdForPlan(
  config: MobileRuntimeConfig,
  plan: SubscriptionPlan,
): string {
  const productId = config.subscriptionProductIds[plan];
  if (productId.trim().length === 0) {
    throw new Error('스토어 구독 상품이 아직 설정되지 않았어요.');
  }
  return productId;
}

function ensurePurchasableUser(user: User | null): User {
  if (user === null || user.isAnonymous) {
    throw new Error('구독하려면 먼저 로그인해 주세요.');
  }
  return user;
}

function createExternalLinks(
  legalUrls: MobileRuntimeConfig['legalUrls'],
): DaoewoRuntime['externalLinks'] | undefined {
  if (
    !isPublishedHttpsUrl(legalUrls.terms) ||
    !isPublishedHttpsUrl(legalUrls.privacy)
  ) {
    return undefined;
  }
  return {
    termsUrl: legalUrls.terms,
    privacyUrl: legalUrls.privacy,
    async open(url) {
      if (!isPublishedHttpsUrl(url)) {
        throw new Error('공개된 HTTPS 문서만 열 수 있어요.');
      }
      await Linking.openURL(url);
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

function normalizeAnalyticsProperties(
  properties: Readonly<Record<string, DaoewoAnalyticsValue>>,
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(properties)
      .filter((entry): entry is [string, string | number | boolean] =>
        entry[1] !== null,
      )
      .map(([key, value]) => [
        key,
        typeof value === 'boolean' ? (value ? 1 : 0) : value,
      ]),
  );
}
