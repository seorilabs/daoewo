import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';

import {
  hasActiveProEntitlement,
  toDateKey,
  type CardProgress,
} from '@daoewo/product-core';

import {
  AppText,
  EmptyState,
  PrimaryButton,
  Screen,
  TextButton,
} from './components';
import {
  canActivateDeck,
  classifyDemoCard,
  reviewDemoCard,
} from './core-adapter';
import type {DaoewoCardView, DaoewoDeckView} from './demo-data';
import type {
  DaoewoScreen,
  GoalMode,
  ReviewRating,
  SubscriptionPlan,
} from './navigation';
import {
  DAOEWO_LEGACY_LEARNING_STATE_STORAGE_KEY,
  deriveDashboardSummary,
  EMPTY_LEARNING_STATE,
  loadLearningState,
  mergeLearningStates,
  removeLearningState,
  saveLearningState,
  selectMistakeItems,
  withCompletedSession,
  withProgressSnapshot,
  type DaoewoLearningState,
} from './product-state';
import {
  createDemoRuntime,
  MOBILE_AUTH_OPTIONS,
  trackDaoewoEvent,
  type DaoewoAnalyticsEventMap,
  type DaoewoAnalyticsEventName,
  type DaoewoAuthOption,
  type DaoewoAuthProvider,
  type DaoewoEntitlementState,
  type DaoewoCardWindow,
  type DaoewoPaywallTrigger,
  type DaoewoRuntime,
  type DaoewoUser,
} from './runtime';
import {useDaoewoTheme} from './theme';
import {PaywallScreen, SettingsScreen} from './screens/account';
import {DeckDetailScreen, HomeScreen, LogoMark, OnboardingScreen} from './screens/home';
import {
  CatalogScreen,
  type DeckRequestDraft,
  deckRequestLocaleCode,
  DeckRequestScreen,
  StatisticsScreen,
} from './screens/library';
import {
  MistakesScreen,
  QuickReviewScreen,
  StudyScreen,
  type SwipeOutcome,
} from './screens/study';

const FALLBACK_USER: DaoewoUser = {
  id: 'local-preview',
  displayName: '게스트',
  isGuest: true,
};

const FREE_ENTITLEMENT: DaoewoEntitlementState = {
  plan: 'free',
  source: 'local-fallback',
  validUntil: null,
};

function paywallTriggerForScreen(screen: DaoewoScreen): DaoewoPaywallTrigger {
  switch (screen) {
    case 'home':
      return 'home-promo';
    case 'deck-detail':
      return 'active-deck-limit';
    case 'statistics':
      return 'advanced-statistics';
    case 'mistakes':
      return 'weakness-review';
    case 'settings':
      return 'subscription-settings';
    default:
      return 'unknown';
  }
}

function safelyTrack<Event extends DaoewoAnalyticsEventName>(
  runtime: DaoewoRuntime,
  event: Event,
  properties: DaoewoAnalyticsEventMap[Event],
): void {
  void trackDaoewoEvent(runtime.analytics, event, properties).catch(() => {
    // Analytics는 제품 행동을 차단하지 않으며 adapter 오류 메시지도 사용자에게 노출하지 않는다.
  });
}

function progressKey(card: Pick<DaoewoCardView, 'deckId' | 'id'>): string {
  return `${card.deckId}:${card.id}`;
}

interface ProgressCommitContext {
  readonly deckId: string;
  readonly windowId: string;
  readonly cardIds: readonly string[];
  readonly goalKey?: string;
}

type AsyncContentStatus = 'loading' | 'ready' | 'empty' | 'error';

interface ContentStateScreenProps {
  readonly title: string;
  readonly status: Exclude<AsyncContentStatus, 'ready'>;
  readonly onRetry: () => void;
  readonly onBack?: () => void;
}

function ContentStateScreen({
  title,
  status,
  onRetry,
  onBack,
}: ContentStateScreenProps) {
  const {colors} = useDaoewoTheme();

  return (
    <Screen scroll={false} accessibilityLabel={`${title} 콘텐츠 상태`}>
      {onBack ? (
        <View style={styles.stateBack}>
          <TextButton label="‹ 뒤로" onPress={onBack} tone="muted" />
        </View>
      ) : null}
      <View style={styles.stateContent}>
        {status === 'loading' ? (
          <>
            <ActivityIndicator color={colors.accent} size="large" />
            <AppText accessibilityLiveRegion="polite" style={styles.stateTitle}>
              {title} 불러오는 중
            </AppText>
          </>
        ) : status === 'empty' ? (
          <>
            <EmptyState
              title="아직 표시할 콘텐츠가 없어요"
              description="승인된 콘텐츠가 준비되면 이곳에 표시됩니다."
            />
            <PrimaryButton label="다시 확인하기" onPress={onRetry} />
          </>
        ) : (
          <>
            <EmptyState
              title="콘텐츠를 불러오지 못했어요"
              description="연결을 확인한 뒤 다시 시도해 주세요."
            />
            <PrimaryButton label="다시 시도하기" onPress={onRetry} />
          </>
        )}
      </View>
    </Screen>
  );
}

export interface DaoewoAppProps {
  /** 앱 target의 composition root가 실제 adapter를 주입한다. 미지정 시 안전한 메모리 demo를 사용한다. */
  readonly runtime?: DaoewoRuntime;
  /** 렌더 테스트와 화면 QA를 위한 시작 화면. 실제 앱은 생략한다. */
  readonly initialScreen?: DaoewoScreen;
  /** 기본 mobile은 Google/Apple. AppsInToss는 APPS_IN_TOSS_AUTH_OPTIONS를 주입한다. */
  readonly authOptions?: readonly DaoewoAuthOption[];
}

export function DaoewoApp({
  runtime: injectedRuntime,
  initialScreen,
  authOptions = MOBILE_AUTH_OPTIONS,
}: DaoewoAppProps) {
  const {colors} = useDaoewoTheme();
  const fallbackRuntime = useRef<DaoewoRuntime | null>(null);
  if (fallbackRuntime.current === null) {
    fallbackRuntime.current = createDemoRuntime();
  }
  const runtime = injectedRuntime ?? fallbackRuntime.current;
  const getPurchaseOffers = useMemo(() => {
    const getOffers = runtime.purchase.getOffers;
    return getOffers === undefined
      ? undefined
      : () => getOffers.call(runtime.purchase);
  }, [runtime.purchase]);

  const [initialized, setInitialized] = useState(false);
  const [screen, setScreen] = useState<DaoewoScreen>(initialScreen ?? 'onboarding');
  const [paywallReturn, setPaywallReturn] = useState<DaoewoScreen>('home');
  const [user, setUser] = useState<DaoewoUser | null>(null);
  const [entitlement, setEntitlement] =
    useState<DaoewoEntitlementState>(FREE_ENTITLEMENT);
  const [busyProvider, setBusyProvider] =
    useState<DaoewoAuthProvider | 'guest' | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [catalogDecks, setCatalogDecks] =
    useState<readonly DaoewoDeckView[]>([]);
  const [catalogStatus, setCatalogStatus] =
    useState<AsyncContentStatus>('loading');
  const [selectedDeck, setSelectedDeck] = useState<DaoewoDeckView | null>(null);
  const [deckStatus, setDeckStatus] =
    useState<AsyncContentStatus>('loading');
  const [sessionWindow, setSessionWindow] = useState<DaoewoCardWindow | null>(
    null,
  );
  const [sessionStatus, setSessionStatus] =
    useState<AsyncContentStatus>('loading');
  const [activeGoalKey, setActiveGoalKey] = useState<string | undefined>();
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [reviewCards, setReviewCards] = useState<readonly DaoewoCardView[]>([]);
  const [sessionAnswers, setSessionAnswers] = useState<
    Readonly<Record<string, SwipeOutcome>>
  >({});
  const [learningState, setLearningState] =
    useState<DaoewoLearningState>(EMPTY_LEARNING_STATE);
  const learningStateRef = useRef<DaoewoLearningState>(EMPTY_LEARNING_STATE);
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());
  const activeOwnerId = useRef<string | null>(null);
  const accountEpoch = useRef(0);
  const progress = useRef(new Map<string, CardProgress>());
  const progressCommitContext = useRef<ProgressCommitContext | null>(null);
  const sessionStartedAt = useRef<number | null>(null);
  const initialSessionRequested = useRef(false);

  const clearAccountMemory = useCallback(() => {
    activeOwnerId.current = null;
    setUser(null);
    setEntitlement(FREE_ENTITLEMENT);
    setCatalogDecks([]);
    setCatalogStatus('loading');
    setSelectedDeck(null);
    setDeckStatus('loading');
    setSessionWindow(null);
    setSessionStatus('loading');
    setActiveGoalKey(undefined);
    setGoalBusy(false);
    setGoalError(null);
    setSyncNotice(null);
    setReviewCards([]);
    setSessionAnswers({});
    learningStateRef.current = EMPTY_LEARNING_STATE;
    setLearningState(EMPTY_LEARNING_STATE);
    progress.current.clear();
    progressCommitContext.current = null;
    sessionStartedAt.current = null;
    initialSessionRequested.current = false;
    setPaywallReturn('home');
  }, []);

  const hydrateAccount = useCallback(
    async (
      nextUser: DaoewoUser | null,
      preloadedLearning?: DaoewoLearningState,
    ): Promise<boolean> => {
      const transition = accountEpoch.current + 1;
      accountEpoch.current = transition;
      clearAccountMemory();

      // 이전 계정의 queued save가 새 계정 상태 뒤에 실행되지 않게 먼저 drain한다.
      await persistenceQueue.current.catch(() => undefined);
      let legacyCleanupFailed = false;
      try {
        await runtime.storage.removeItem(
          DAOEWO_LEGACY_LEARNING_STATE_STORAGE_KEY,
        );
      } catch {
        legacyCleanupFailed = true;
      }

      if (accountEpoch.current !== transition) {
        return false;
      }
      if (nextUser === null) {
        if (legacyCleanupFailed) {
          setSyncNotice('이전 형식의 로컬 학습 기록을 정리하지 못했어요.');
        }
        return true;
      }

      const ownerId = nextUser.id.trim();
      if (ownerId.length === 0) {
        throw new Error('INVALID_ACCOUNT_OWNER');
      }

      let storedLearning = preloadedLearning ?? EMPTY_LEARNING_STATE;
      let loadFailed = false;
      if (preloadedLearning === undefined) {
        try {
          storedLearning = await loadLearningState(runtime.storage, ownerId);
        } catch {
          loadFailed = true;
        }
      }
      if (accountEpoch.current !== transition) {
        return false;
      }

      activeOwnerId.current = ownerId;
      learningStateRef.current = storedLearning;
      setLearningState(storedLearning);
      progress.current = new Map(
        storedLearning.progresses.map(item => [
          `${item.deckId}:${item.cardId}`,
          item,
        ]),
      );
      setUser(nextUser);
      if (loadFailed) {
        setSyncNotice('이 계정의 로컬 학습 기록을 불러오지 못했어요.');
      } else if (legacyCleanupFailed) {
        setSyncNotice('이전 형식의 로컬 학습 기록을 정리하지 못했어요.');
      }
      return true;
    },
    [clearAccountMemory, runtime.storage],
  );

  useEffect(() => {
    let active = true;

    Promise.all([
      runtime.auth.getCurrentUser(),
      runtime.purchase.getEntitlement(),
      runtime.storage
        .removeItem(DAOEWO_LEGACY_LEARNING_STATE_STORAGE_KEY)
        .catch(() => undefined),
    ])
      .then(async ([currentUser, currentEntitlement]) => {
        if (!active) {
          return;
        }
        const hydrated = await hydrateAccount(currentUser);
        if (!active || !hydrated) {
          return;
        }
        setEntitlement(currentEntitlement);
        if (initialScreen === undefined && currentUser !== null) {
          setScreen('home');
        }
      })
      .catch(() => {
        if (!active) {
          return;
        }
        accountEpoch.current += 1;
        clearAccountMemory();
        setAuthError(
          '계정 상태를 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
        );
      })
      .finally(() => {
        if (active) {
          setInitialized(true);
        }
      });

    return () => {
      active = false;
      accountEpoch.current += 1;
    };
  }, [clearAccountMemory, hydrateAccount, initialScreen, runtime]);

  const applyLearningState = useCallback(
    (next: DaoewoLearningState): Promise<void> => {
      const ownerId = activeOwnerId.current;
      const epoch = accountEpoch.current;
      if (ownerId === null) {
        setSyncNotice('계정을 확인할 수 없어 학습 기록을 저장하지 않았어요.');
        return Promise.reject(new Error('MISSING_ACCOUNT_OWNER'));
      }
      learningStateRef.current = next;
      setLearningState(next);
      const save = persistenceQueue.current
        .catch(() => undefined)
        .then(() => {
          if (
            accountEpoch.current !== epoch ||
            activeOwnerId.current !== ownerId
          ) {
            return;
          }
          return saveLearningState(runtime.storage, ownerId, next);
        });
      persistenceQueue.current = save;
      void save.catch(() => {
        if (
          accountEpoch.current === epoch &&
          activeOwnerId.current === ownerId
        ) {
          setSyncNotice(
            '이 계정의 학습 기록을 저장하지 못했어요. 저장 공간을 확인해 주세요.',
          );
        }
      });
      return save;
    },
    [runtime.storage],
  );

  const loadCatalog = useCallback(async () => {
    const requestEpoch = accountEpoch.current;
    setCatalogStatus('loading');
    try {
      const decks = await runtime.content.listCatalog();
      if (accountEpoch.current !== requestEpoch) {
        return;
      }
      if (decks.length === 0) {
        setCatalogDecks([]);
        setSelectedDeck(null);
        setCatalogStatus('empty');
        setDeckStatus('empty');
        return;
      }

      setCatalogDecks(decks);
      setSelectedDeck(current =>
        decks.find(deck => deck.id === current?.id) ??
        decks.find(deck => deck.progress !== undefined) ??
        decks[0] ??
        null,
      );
      setCatalogStatus('ready');
      setDeckStatus('ready');
    } catch {
      if (accountEpoch.current !== requestEpoch) {
        return;
      }
      setCatalogDecks([]);
      setSelectedDeck(null);
      setCatalogStatus('error');
      setDeckStatus('error');
    }
  }, [runtime]);

  useEffect(() => {
    if (
      initialized &&
      (user !== null || initialScreen !== undefined)
    ) {
      void loadCatalog();
    }
  }, [initialized, initialScreen, loadCatalog, user]);

  const openPaywall = useCallback(
    (trigger: DaoewoPaywallTrigger) => {
      setPaywallReturn(screen === 'paywall' ? 'home' : screen);
      setScreen('paywall');
      safelyTrack(runtime, 'memo_paywall_view', {trigger});
    },
    [runtime, screen],
  );

  const navigate = useCallback(
    (next: DaoewoScreen) => {
      if (next === 'paywall') {
        openPaywall(paywallTriggerForScreen(screen));
        return;
      }
      setScreen(next);
    },
    [openPaywall, screen],
  );

  const authenticate = async (
    provider: DaoewoAuthProvider,
    destination: DaoewoScreen = 'home',
  ) => {
    const sourceUser = user;
    const sourceOwnerId = activeOwnerId.current;
    setBusyProvider(provider);
    setAuthError(null);
    try {
      if (sourceUser?.isGuest === true && sourceOwnerId === sourceUser.id) {
        // 로그인 전에 마지막 guest save까지 끝내 source state를 확정한다.
        await persistenceQueue.current;
      }
      const sourceLearning = learningStateRef.current;
      const nextUser = await runtime.auth.signIn(provider);
      let nextEntitlement = FREE_ENTITLEMENT;
      let entitlementFailed = false;
      try {
        nextEntitlement = await runtime.purchase.getEntitlement();
      } catch {
        entitlementFailed = true;
      }
      let hydrated = true;
      if (
        sourceUser?.isGuest === true &&
        sourceOwnerId !== null &&
        sourceOwnerId === sourceUser.id
      ) {
        if (sourceOwnerId === nextUser.id) {
          // Firebase anonymous credential link처럼 UID가 유지되면 같은 local key와
          // in-memory state를 그대로 사용한다.
          activeOwnerId.current = nextUser.id;
          setUser(nextUser);
        } else {
          const targetLearning = await loadLearningState(
            runtime.storage,
            nextUser.id,
          );
          const mergedLearning = mergeLearningStates(
            sourceLearning,
            targetLearning,
          );
          // target save 성공 전에는 source key를 절대 지우지 않는다.
          await saveLearningState(runtime.storage, nextUser.id, mergedLearning);
          let sourceCleanupFailed = false;
          try {
            await removeLearningState(runtime.storage, sourceOwnerId);
          } catch {
            sourceCleanupFailed = true;
          }
          hydrated = await hydrateAccount(nextUser, mergedLearning);
          if (sourceCleanupFailed && hydrated) {
            setSyncNotice(
              '계정 연결은 완료했지만 이전 게스트 기록 사본을 정리하지 못했어요.',
            );
          }
        }
      } else {
        hydrated = await hydrateAccount(nextUser);
      }
      if (!hydrated) {
        return;
      }
      setEntitlement(nextEntitlement);
      if (entitlementFailed) {
        setSyncNotice(
          '구독 상태를 확인하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.',
        );
      }
      navigate(destination);
    } catch {
      // OAuth/서버/target 저장 실패에서는 현재 guest state와 source key를 보존한다.
      setAuthError(
        '로그인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.',
      );
    } finally {
      setBusyProvider(null);
    }
  };

  const continueAsGuest = async () => {
    setBusyProvider('guest');
    setAuthError(null);
    try {
      const nextUser = await runtime.auth.continueAsGuest();
      const hydrated = await hydrateAccount(nextUser);
      if (!hydrated) {
        return;
      }
      setEntitlement(FREE_ENTITLEMENT);
      navigate('home');
    } catch {
      accountEpoch.current += 1;
      clearAccountMemory();
      setAuthError(
        '게스트 시작을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.',
      );
    } finally {
      setBusyProvider(null);
    }
  };

  const isPro = hasActiveProEntitlement(entitlement, runtime.now());
  const activeDecks = catalogDecks.filter(
    deck =>
      deck.availability === 'published' &&
      deck.progress !== undefined &&
      (deck.tier === 'free' || isPro),
  );
  const visibleActiveDecks = isPro ? activeDecks : activeDecks.slice(0, 1);
  const studyAvailable = catalogDecks.some(
    deck => deck.availability === 'published' && deck.cardCount !== null,
  );

  const loadSession = useCallback(
    async (deck: DaoewoDeckView, goalKey?: string) => {
      const requestEpoch = accountEpoch.current;
      setSelectedDeck(deck);
      setSessionAnswers({});
      progressCommitContext.current = null;
      if (deck.availability !== 'published' || deck.cardCount === null) {
        setSessionWindow(null);
        setSessionStatus('empty');
        setScreen('study');
        return;
      }
      setSessionStatus('loading');
      setSessionWindow(null);
      setScreen('study');
      try {
        const window = await runtime.content.getCardWindow({
          deckId: deck.id,
          ...(goalKey ? {goalKey} : {}),
        });
        if (accountEpoch.current !== requestEpoch) {
          return;
        }
        if (window.cards.length === 0) {
          setSessionStatus('empty');
          return;
        }
        setSessionWindow(window);
        setSessionStatus('ready');
        progressCommitContext.current = {
          deckId: window.deckId,
          windowId: window.id,
          cardIds: window.cards.map(card => card.id),
          ...(window.goalKey ?? goalKey
            ? {goalKey: window.goalKey ?? goalKey}
            : {}),
        };
        sessionStartedAt.current = runtime.now().getTime();
        safelyTrack(runtime, 'memo_session_start', {
          deck_id: deck.id,
          target_count: window.targetCount,
        });
      } catch {
        if (accountEpoch.current !== requestEpoch) {
          return;
        }
        setSessionStatus('error');
      }
    },
    [runtime],
  );

  useEffect(() => {
    if (
      initialScreen === 'study' &&
      catalogStatus === 'ready' &&
      selectedDeck !== null &&
      !initialSessionRequested.current
    ) {
      initialSessionRequested.current = true;
      void loadSession(selectedDeck);
    }
  }, [catalogStatus, initialScreen, loadSession, selectedDeck]);

  const openDeck = async (deck: DaoewoDeckView) => {
    const requestEpoch = accountEpoch.current;
    setSelectedDeck(deck);
    if (deck.availability === 'published') {
      const decision = canActivateDeck(
        deck,
        visibleActiveDecks.map(item => item.id),
        entitlement,
        runtime.now(),
      );
      if (!decision.allowed && decision.reason === 'pro-required') {
        safelyTrack(runtime, 'memo_premium_deck_tap', {
          deck_id: deck.id,
        });
        openPaywall('premium-deck');
        return;
      }
    }
    setDeckStatus('loading');
    setScreen('deck-detail');
    try {
      const detail = await runtime.content.getDeck(deck.id);
      if (accountEpoch.current !== requestEpoch) {
        return;
      }
      if (detail === null) {
        setDeckStatus('empty');
        return;
      }
      if (detail.availability === 'published') {
        const refreshedDecision = canActivateDeck(
          detail,
          visibleActiveDecks.map(item => item.id),
          entitlement,
          runtime.now(),
        );
        if (
          !refreshedDecision.allowed &&
          refreshedDecision.reason === 'pro-required'
        ) {
          safelyTrack(runtime, 'memo_premium_deck_tap', {deck_id: detail.id});
          openPaywall('premium-deck');
          return;
        }
      }
      setSelectedDeck(detail);
      setDeckStatus('ready');
      safelyTrack(runtime, 'memo_deck_open', {
        deck_id: detail.id,
        tier: detail.tier,
        source: detail.source,
      });
    } catch {
      if (accountEpoch.current !== requestEpoch) {
        return;
      }
      setDeckStatus('error');
    }
  };

  const startGoal = async (mode: GoalMode, value: number) => {
    if (selectedDeck === null || goalBusy) {
      return;
    }
    if (
      selectedDeck.availability !== 'published' ||
      selectedDeck.cardCount === null
    ) {
      setGoalError('카드 승인이 끝난 뒤 목표를 설정할 수 있어요.');
      return;
    }
    const decision = canActivateDeck(
      selectedDeck,
      visibleActiveDecks.map(deck => deck.id),
      entitlement,
      runtime.now(),
    );
    if (!decision.allowed) {
      if (decision.reason === 'pro-required') {
        safelyTrack(runtime, 'memo_premium_deck_tap', {
          deck_id: selectedDeck.id,
        });
      }
      openPaywall(
        decision.reason === 'pro-required'
          ? 'premium-deck'
          : 'active-deck-limit',
      );
      return;
    }

    setGoalBusy(true);
    setGoalError(null);
    const requestEpoch = accountEpoch.current;
    try {
      const goal = await runtime.content.createGoal({
        deckId: selectedDeck.id,
        mode,
        value,
        startDate: toDateKey(runtime.now()),
      });
      if (accountEpoch.current !== requestEpoch) {
        return;
      }
      setActiveGoalKey(goal.key);
      safelyTrack(runtime, 'memo_goal_set', {
        mode,
        days: goal.days,
        daily_count: goal.dailyCount,
      });
      await loadSession(selectedDeck, goal.key);
    } catch {
      if (accountEpoch.current !== requestEpoch) {
        return;
      }
      setGoalError(
        '목표를 만들지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
      );
    } finally {
      if (accountEpoch.current === requestEpoch) {
        setGoalBusy(false);
      }
    }
  };

  const startTodayStudy = () => {
    const deck =
      visibleActiveDecks[0] ??
      (selectedDeck?.availability === 'published' ? selectedDeck : undefined) ??
      catalogDecks.find(item => item.availability === 'published');
    if (deck === undefined || deck === null) {
      setSyncNotice('현재 학습 가능한 덱이 없어요. 준비 중인 덱을 확인해 주세요.');
      navigate('catalog');
      return;
    }
    const decision = canActivateDeck(
      deck,
      visibleActiveDecks.map(item => item.id),
      entitlement,
      runtime.now(),
    );
    if (!decision.allowed) {
      if (decision.reason === 'pro-required') {
        safelyTrack(runtime, 'memo_premium_deck_tap', {deck_id: deck.id});
      }
      openPaywall(
        decision.reason === 'pro-required'
          ? 'premium-deck'
          : 'active-deck-limit',
      );
      return;
    }
    void loadSession(deck, activeGoalKey);
  };

  const sessionCards = sessionWindow?.cards ?? [];

  const answerStudyCard = (card: DaoewoCardView, outcome: SwipeOutcome) => {
    const next = classifyDemoCard(
      card,
      outcome,
      runtime.now(),
      progress.current.get(progressKey(card)),
    );
    progress.current.set(progressKey(card), next);
    setSessionAnswers(current => ({...current, [progressKey(card)]: outcome}));
    const persistCardBody =
      catalogDecks.find(deck => deck.id === card.deckId)?.tier === 'free';
    void applyLearningState(
      withProgressSnapshot(
        learningStateRef.current,
        next,
        card,
        persistCardBody,
      ),
    ).catch(() => {
      // applyLearningState가 사용자용 저장 오류 안내를 설정한다.
    });
  };

  const commitCurrentProgress = async (): Promise<void> => {
    const context = progressCommitContext.current;
    if (context === null) {
      return;
    }
    const allowedCardIds = new Set(context.cardIds);
    const progresses = [...progress.current.values()].filter(
      item =>
        item.deckId === context.deckId && allowedCardIds.has(item.cardId),
    );
    if (progresses.length === 0) {
      return;
    }
    const requestEpoch = accountEpoch.current;
    try {
      await runtime.content.commitProgressBatch({
        deckId: context.deckId,
        ...(context.goalKey ? {goalKey: context.goalKey} : {}),
        windowId: context.windowId,
        progresses,
      });
      if (accountEpoch.current === requestEpoch) {
        setSyncNotice(null);
      }
    } catch {
      if (accountEpoch.current === requestEpoch) {
        setSyncNotice(
          '학습 기록을 동기화하지 못했어요. 연결되면 다시 시도해 주세요.',
        );
      }
    }
  };

  const releaseWindowBodies = () => {
    setSessionWindow(null);
    setSessionStatus('loading');
    setSessionAnswers({});
    sessionStartedAt.current = null;
  };

  const closeStudy = async () => {
    releaseWindowBodies();
    setReviewCards([]);
    navigate('home');
    await commitCurrentProgress();
    progressCommitContext.current = null;
  };

  const closeReview = async () => {
    releaseWindowBodies();
    setReviewCards([]);
    navigate('mistakes');
    await commitCurrentProgress();
    progressCommitContext.current = null;
  };

  const completeStudy = async (
    unknownCards: readonly DaoewoCardView[],
  ) => {
    const completedAt = runtime.now().getTime();
    const elapsedMs = Math.max(
      0,
      completedAt - (sessionStartedAt.current ?? completedAt),
    );
    if (selectedDeck !== null && sessionWindow !== null) {
      const completedState = withCompletedSession(learningStateRef.current, {
        id: `${sessionWindow.id}:${completedAt}`,
        deckId: selectedDeck.id,
        date: toDateKey(new Date(completedAt)),
        target: Math.max(sessionWindow.targetCount, sessionCards.length),
        completed: sessionCards.length,
        known: Math.max(0, sessionCards.length - unknownCards.length),
        unknown: unknownCards.length,
        reviewCount: 0,
        elapsedMs,
        completedAt: new Date(completedAt).toISOString(),
      });
      try {
        releaseWindowBodies();
        await applyLearningState(completedState);
      } catch {
        // 사용자용 로컬 저장 오류 안내는 applyLearningState에서 처리한다.
      }
    }
    await commitCurrentProgress();
    safelyTrack(runtime, 'memo_session_complete', {
      known: Math.max(0, sessionCards.length - unknownCards.length),
      unknown: unknownCards.length,
      elapsed_ms: elapsedMs,
    });
    const completedSummary = deriveDashboardSummary(
      learningStateRef.current,
      catalogDecks,
      runtime.now(),
    );
    if (completedSummary.streak.current > 0) {
      safelyTrack(runtime, 'memo_streak_extend', {
        streak_days: completedSummary.streak.current,
      });
    }
    if (unknownCards.length === 0) {
      setReviewCards([]);
      progressCommitContext.current = null;
      navigate('home');
      return;
    }
    setReviewCards(unknownCards);
    navigate('quick-review');
  };

  const rateReview = (card: DaoewoCardView, rating: ReviewRating) => {
    const next = reviewDemoCard(
      card,
      rating,
      runtime.now(),
      progress.current.get(progressKey(card)),
    );
    progress.current.set(progressKey(card), next);
    const persistCardBody =
      catalogDecks.find(deck => deck.id === card.deckId)?.tier === 'free';
    void applyLearningState(
      withProgressSnapshot(
        learningStateRef.current,
        next,
        card,
        persistCardBody,
      ),
    ).catch(() => {
      // applyLearningState가 사용자용 저장 오류 안내를 설정한다.
    });
    safelyTrack(runtime, 'memo_review_outcome', {
      outcome: rating,
    });
  };

  const speak = (card: DaoewoCardView) => {
    void runtime.tts.speak(card.front, card.locale).catch(() => {
      // TTS 미지원 환경에서도 카드 학습은 계속 가능하다.
    });
  };

  const submitDeckRequest = async (draft: DeckRequestDraft) => {
    await runtime.content.submitDeckRequest({
      topic: draft.topic,
      category: draft.category,
      locale: deckRequestLocaleCode(draft.locale),
      ...(draft.note ? {note: draft.note} : {}),
    });
    safelyTrack(runtime, 'memo_deck_request', {
      category: draft.category,
      locale: deckRequestLocaleCode(draft.locale),
    });
  };

  const purchase = async (plan: SubscriptionPlan, trial: boolean) => {
    if (user?.isGuest !== false) {
      throw new Error('ACCOUNT_LINK_REQUIRED');
    }
    const next = await runtime.purchase.purchase(plan);
    setEntitlement(next);
    safelyTrack(runtime, 'memo_subscribe', {
      plan,
      trial,
    });
  };

  const restore = async () => {
    if (user?.isGuest !== false) {
      throw new Error('ACCOUNT_LINK_REQUIRED');
    }
    const next = await runtime.purchase.restore();
    setEntitlement(next);
  };

  const browseCatalog = useCallback(
    (category: string) => {
      safelyTrack(runtime, 'memo_catalog_browse', {category});
    },
    [runtime],
  );

  const shareProgress = useCallback(() => {
    safelyTrack(runtime, 'memo_share', {
      type: 'weekly-progress',
    });
  }, [runtime]);

  const completeReview = async () => {
    releaseWindowBodies();
    setReviewCards([]);
    navigate('home');
    await commitCurrentProgress();
    progressCommitContext.current = null;
  };

  const removeCurrentAccountState = async () => {
    const ownerId = activeOwnerId.current;
    const transition = accountEpoch.current + 1;
    accountEpoch.current = transition;
    activeOwnerId.current = null;
    await persistenceQueue.current.catch(() => undefined);
    try {
      await runtime.storage.removeItem(
        DAOEWO_LEGACY_LEARNING_STATE_STORAGE_KEY,
      );
      if (ownerId !== null) {
        await removeLearningState(runtime.storage, ownerId);
      }
    } catch (error) {
      if (accountEpoch.current === transition) {
        activeOwnerId.current = ownerId;
      }
      throw error;
    }
    if (accountEpoch.current === transition) {
      clearAccountMemory();
    }
  };

  const signOut = async () => {
    await removeCurrentAccountState();
    await runtime.auth.signOut();
    navigate('onboarding');
  };

  const deleteAccount = async () => {
    await runtime.auth.deleteAccount();
    await removeCurrentAccountState();
    navigate('onboarding');
  };

  if (!initialized) {
    return (
      <Screen scroll={false} accessibilityLabel="다외워 준비 중">
        <View style={styles.loading}>
          <LogoMark />
          <AppText accessibilityRole="header" style={styles.loadingTitle}>
            다외워
          </AppText>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </Screen>
    );
  }

  const effectiveUser = user ?? FALLBACK_USER;
  const currentSessionSummary =
    sessionStatus === 'ready' && sessionWindow !== null
      ? {
          target: sessionWindow.targetCount,
          answered: Object.keys(sessionAnswers).length,
        }
      : undefined;
  const dashboardSummary = deriveDashboardSummary(
    learningState,
    catalogDecks,
    runtime.now(),
    currentSessionSummary,
  );
  const mistakeItems = selectMistakeItems(learningState, runtime.now());
  const dueReviewCards = mistakeItems
    .filter(item => item.isDue)
    .map(item => item.card);

  switch (screen) {
    case 'onboarding':
      return (
        <OnboardingScreen
          authOptions={authOptions}
          error={authError}
          busyProvider={busyProvider}
          onContinueAsGuest={continueAsGuest}
          onSignIn={authenticate}
        />
      );
    case 'home':
      if (catalogStatus !== 'ready') {
        return (
          <ContentStateScreen
            title="덱 카탈로그"
            status={catalogStatus}
            onRetry={() => void loadCatalog()}
          />
        );
      }
      return (
        <HomeScreen
          activeDecks={visibleActiveDecks}
          isPro={isPro}
          navigate={navigate}
          notice={syncNotice}
          onContinueStudy={startTodayStudy}
          onSelectDeck={deck => void openDeck(deck)}
          studyAvailable={studyAvailable}
          summary={dashboardSummary}
          user={effectiveUser}
        />
      );
    case 'deck-detail':
      if (deckStatus !== 'ready' || selectedDeck === null) {
        return (
          <ContentStateScreen
            title="덱 상세"
            status={deckStatus === 'ready' ? 'empty' : deckStatus}
            onBack={() => navigate('catalog')}
            onRetry={() => {
              if (selectedDeck) {
                void openDeck(selectedDeck);
              } else {
                void loadCatalog();
              }
            }}
          />
        );
      }
      return (
        <DeckDetailScreen
          deck={selectedDeck}
          goalBusy={goalBusy}
          goalError={goalError}
          now={runtime.now()}
          onBack={() => navigate('catalog')}
          onRequestDeck={() => navigate('deck-request')}
          onStart={startGoal}
        />
      );
    case 'study':
      if (sessionStatus !== 'ready') {
        return (
          <ContentStateScreen
            title="오늘 학습"
            status={sessionStatus}
            onBack={() => navigate('home')}
            onRetry={() => {
              if (selectedDeck) {
                void loadSession(selectedDeck, activeGoalKey);
              } else {
                void loadCatalog();
              }
            }}
          />
        );
      }
      return (
        <StudyScreen
          cards={sessionCards}
          onAnswer={answerStudyCard}
          onClose={() => void closeStudy()}
          onComplete={completeStudy}
          onSpeak={speak}
        />
      );
    case 'quick-review':
      return (
        <QuickReviewScreen
          cards={reviewCards}
          onClose={() => void closeReview()}
          onComplete={completeReview}
          onRate={rateReview}
          onSpeak={speak}
        />
      );
    case 'mistakes':
      return (
        <MistakesScreen
          items={mistakeItems}
          isPro={isPro}
          now={runtime.now()}
          onBack={() => navigate('home')}
          onOpenPaywall={() => navigate('paywall')}
          onStartReview={() => {
            setReviewCards(dueReviewCards);
            navigate('quick-review');
          }}
          weaknessTags={dashboardSummary.weaknessTags}
        />
      );
    case 'catalog':
      if (catalogStatus !== 'ready') {
        return (
          <ContentStateScreen
            title="덱 카탈로그"
            status={catalogStatus}
            onBack={() => navigate('home')}
            onRetry={() => void loadCatalog()}
          />
        );
      }
      return (
        <CatalogScreen
          decks={catalogDecks}
          entitlement={entitlement}
          now={runtime.now()}
          onBack={() => navigate('home')}
          onBrowseCategory={browseCatalog}
          onRequestDeck={() => navigate('deck-request')}
          onSelectDeck={deck => void openDeck(deck)}
        />
      );
    case 'deck-request':
      return (
        <DeckRequestScreen
          isPro={isPro}
          onBack={() => navigate('catalog')}
          onSubmit={submitDeckRequest}
        />
      );
    case 'statistics':
      return (
        <StatisticsScreen
          isPro={isPro}
          navigate={navigate}
          onContinueStudy={startTodayStudy}
          onShare={shareProgress}
          summary={dashboardSummary}
        />
      );
    case 'paywall':
      return (
        <PaywallScreen
          authError={authError}
          authOptions={authOptions}
          busyProvider={busyProvider}
          externalLinks={runtime.externalLinks}
          getOffers={getPurchaseOffers}
          isPro={isPro}
          isGuest={effectiveUser.isGuest}
          onBack={() => navigate(paywallReturn)}
          onSignIn={provider => authenticate(provider, 'paywall')}
          onPurchase={purchase}
          onRestore={restore}
        />
      );
    case 'settings':
      return (
        <SettingsScreen
          authError={authError}
          authOptions={authOptions}
          busyProvider={busyProvider}
          entitlement={entitlement}
          isPro={isPro}
          navigate={navigate}
          onDeleteAccount={deleteAccount}
          onSignIn={provider => authenticate(provider, 'settings')}
          onSignOut={signOut}
          storage={runtime.storage}
          user={effectiveUser}
        />
      );
  }
}

export default DaoewoApp;

const styles = StyleSheet.create({
  loading: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22},
  loadingTitle: {fontSize: 29, lineHeight: 38, fontWeight: '800'},
  stateBack: {paddingTop: 8, alignItems: 'flex-start'},
  stateContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
    gap: 18,
    paddingBottom: 40,
  },
  stateTitle: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
});
