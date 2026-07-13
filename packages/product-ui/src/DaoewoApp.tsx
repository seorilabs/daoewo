import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  StyleSheet,
  View,
} from "react-native";

import {
  hasActiveProEntitlement,
  toDateKey,
  type CardProgress,
  type LearningSyncSnapshot,
  type SyncEnvelope,
} from "@daoewo/product-core";

import {
  AppText,
  EmptyState,
  PrimaryButton,
  Screen,
  TextButton,
} from "./components";
import {
  canActivateDeck,
  classifyDemoCard,
  reviewDemoCard,
} from "./core-adapter";
import type { DaoewoCardView, DaoewoDeckView } from "./demo-data";
import type {
  DaoewoScreen,
  GoalMode,
  ReviewRating,
  SubscriptionPlan,
} from "./navigation";
import {
  createLearningDataExport,
  DAOEWO_LEGACY_SETTINGS_STORAGE_KEY,
  DAOEWO_LEGACY_LEARNING_STATE_STORAGE_KEY,
  DEFAULT_SETTINGS_STATE,
  deriveDashboardSummary,
  EMPTY_LEARNING_STATE,
  loadSettingsState,
  loadLearningState,
  mergeLearningStateFromSync,
  mergeLearningStates,
  removeLearningState,
  removeSettingsState,
  saveSettingsState,
  saveLearningState,
  selectMistakeItems,
  serializeLearningDataExport,
  withCompletedSession,
  withProgressSnapshot,
  type DaoewoLearningState,
  type DaoewoSettingsState,
} from "./product-state";
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
} from "./runtime";
import { useDaoewoTheme } from "./theme";
import { PaywallScreen, SettingsScreen } from "./screens/account";
import {
  DeckDetailScreen,
  HomeScreen,
  LogoMark,
  OnboardingScreen,
} from "./screens/home";
import {
  CatalogScreen,
  type DeckRequestDraft,
  deckRequestLocaleCode,
  DeckRequestScreen,
  StatisticsScreen,
} from "./screens/library";
import {
  MistakesScreen,
  QuickReviewScreen,
  StudyScreen,
  type SwipeOutcome,
} from "./screens/study";

const FALLBACK_USER: DaoewoUser = {
  id: "local-preview",
  displayName: "게스트",
  isGuest: true,
};

const FREE_ENTITLEMENT: DaoewoEntitlementState = {
  plan: "free",
  source: "local-fallback",
  validUntil: null,
};

function paywallTriggerForScreen(screen: DaoewoScreen): DaoewoPaywallTrigger {
  switch (screen) {
    case "home":
      return "home-promo";
    case "deck-detail":
      return "active-deck-limit";
    case "statistics":
      return "advanced-statistics";
    case "mistakes":
      return "weakness-review";
    case "settings":
      return "subscription-settings";
    default:
      return "unknown";
  }
}

function safelyTrack<Event extends DaoewoAnalyticsEventName>(
  runtime: DaoewoRuntime,
  event: Event,
  properties: DaoewoAnalyticsEventMap[Event]
): void {
  void trackDaoewoEvent(runtime.analytics, event, properties).catch(() => {
    // Analytics는 제품 행동을 차단하지 않으며 adapter 오류 메시지도 사용자에게 노출하지 않는다.
  });
}

function progressKey(card: Pick<DaoewoCardView, "deckId" | "id">): string {
  return `${card.deckId}:${card.id}`;
}

function earliestReviewAt(state: DaoewoLearningState): string | null {
  let earliest: { readonly value: string; readonly time: number } | null = null;
  for (const progress of state.progresses) {
    if (progress.nextReviewAt === null) {
      continue;
    }
    const time = Date.parse(progress.nextReviewAt);
    if (!Number.isFinite(time)) {
      continue;
    }
    if (earliest === null || time < earliest.time) {
      earliest = { value: progress.nextReviewAt, time };
    }
  }
  return earliest?.value ?? null;
}

function notificationPreferences(
  settings: DaoewoSettingsState,
  state: DaoewoLearningState
) {
  return {
    dailyReminder: settings.dailyReminder,
    reviewReminder: settings.reviewReminder,
    nextReviewAt: settings.reviewReminder ? earliestReviewAt(state) : null,
  } as const;
}

interface ProgressCommitContext {
  readonly deckId: string;
  readonly windowId: string;
  readonly cardIds: readonly string[];
  readonly goalKey?: string;
}

type AsyncContentStatus = "loading" | "ready" | "empty" | "error";

interface ContentStateScreenProps {
  readonly title: string;
  readonly status: Exclude<AsyncContentStatus, "ready">;
  readonly onRetry: () => void;
  readonly onBack?: () => void;
}

function ContentStateScreen({
  title,
  status,
  onRetry,
  onBack,
}: ContentStateScreenProps) {
  const { colors } = useDaoewoTheme();

  return (
    <Screen scroll={false} accessibilityLabel={`${title} 콘텐츠 상태`}>
      {onBack ? (
        <View style={styles.stateBack}>
          <TextButton label="‹ 뒤로" onPress={onBack} tone="muted" />
        </View>
      ) : null}
      <View style={styles.stateContent}>
        {status === "loading" ? (
          <>
            <ActivityIndicator color={colors.accent} size="large" />
            <AppText accessibilityLiveRegion="polite" style={styles.stateTitle}>
              {title} 불러오는 중
            </AppText>
          </>
        ) : status === "empty" ? (
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
  const { colors } = useDaoewoTheme();
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
  const [screen, setScreen] = useState<DaoewoScreen>(
    initialScreen ?? "onboarding"
  );
  const [paywallReturn, setPaywallReturn] = useState<DaoewoScreen>("home");
  const [user, setUser] = useState<DaoewoUser | null>(null);
  const [entitlement, setEntitlement] =
    useState<DaoewoEntitlementState>(FREE_ENTITLEMENT);
  const [busyProvider, setBusyProvider] = useState<
    DaoewoAuthProvider | "guest" | null
  >(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [catalogDecks, setCatalogDecks] = useState<readonly DaoewoDeckView[]>(
    []
  );
  const [catalogStatus, setCatalogStatus] =
    useState<AsyncContentStatus>("loading");
  const [selectedDeck, setSelectedDeck] = useState<DaoewoDeckView | null>(null);
  const [deckStatus, setDeckStatus] = useState<AsyncContentStatus>("loading");
  const [sessionWindow, setSessionWindow] = useState<DaoewoCardWindow | null>(
    null
  );
  const [sessionStatus, setSessionStatus] =
    useState<AsyncContentStatus>("loading");
  const [activeGoalKey, setActiveGoalKey] = useState<string | undefined>();
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [, refreshDeckReadyAvailability] = useState(0);
  const [reviewCards, setReviewCards] = useState<readonly DaoewoCardView[]>([]);
  const [sessionAnswers, setSessionAnswers] = useState<
    Readonly<Record<string, SwipeOutcome>>
  >({});
  const [learningState, setLearningState] =
    useState<DaoewoLearningState>(EMPTY_LEARNING_STATE);
  const learningStateRef = useRef<DaoewoLearningState>(EMPTY_LEARNING_STATE);
  const [settings, setSettings] = useState<DaoewoSettingsState>(
    DEFAULT_SETTINGS_STATE
  );
  const settingsRef = useRef<DaoewoSettingsState>(DEFAULT_SETTINGS_STATE);
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());
  const settingsOperationQueue = useRef<Promise<void>>(Promise.resolve());
  const notificationOperationQueue = useRef<Promise<void>>(Promise.resolve());
  const syncQueue = useRef<Promise<void>>(Promise.resolve());
  const accountTransitionInProgress = useRef(false);
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
    setCatalogStatus("loading");
    setSelectedDeck(null);
    setDeckStatus("loading");
    setSessionWindow(null);
    setSessionStatus("loading");
    setActiveGoalKey(undefined);
    setGoalBusy(false);
    setGoalError(null);
    setSyncNotice(null);
    setReviewCards([]);
    setSessionAnswers({});
    learningStateRef.current = EMPTY_LEARNING_STATE;
    setLearningState(EMPTY_LEARNING_STATE);
    settingsRef.current = DEFAULT_SETTINGS_STATE;
    setSettings(DEFAULT_SETTINGS_STATE);
    progress.current.clear();
    progressCommitContext.current = null;
    sessionStartedAt.current = null;
    initialSessionRequested.current = false;
    setPaywallReturn("home");
  }, []);

  const enqueueNotificationOperation = useCallback(
    <Result,>(operation: () => Promise<Result>): Promise<Result> => {
      const result = notificationOperationQueue.current
        .catch(() => undefined)
        .then(operation);
      notificationOperationQueue.current = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
    []
  );

  const applyNotificationPreferences = useCallback(
    (nextSettings: DaoewoSettingsState, nextLearning: DaoewoLearningState) =>
      enqueueNotificationOperation(() =>
        runtime.notifications.applyPreferences(
          notificationPreferences(nextSettings, nextLearning)
        )
      ),
    [enqueueNotificationOperation, runtime.notifications]
  );

  const clearNativeNotifications = useCallback(
    () => enqueueNotificationOperation(() => runtime.notifications.clear()),
    [enqueueNotificationOperation, runtime.notifications]
  );

  const hydrateAccount = useCallback(
    async (
      nextUser: DaoewoUser | null,
      preloadedLearning?: DaoewoLearningState,
      preloadedSettings?: DaoewoSettingsState
    ): Promise<boolean> => {
      const transition = accountEpoch.current + 1;
      accountEpoch.current = transition;
      clearAccountMemory();

      // 이전 계정의 queued operation이 새 계정 상태 뒤에 실행되지 않게 먼저 drain한다.
      await settingsOperationQueue.current.catch(() => undefined);
      await persistenceQueue.current.catch(() => undefined);
      await notificationOperationQueue.current.catch(() => undefined);
      let legacyCleanupFailed = false;
      try {
        await Promise.all([
          runtime.storage.removeItem(DAOEWO_LEGACY_LEARNING_STATE_STORAGE_KEY),
          runtime.storage.removeItem(DAOEWO_LEGACY_SETTINGS_STORAGE_KEY),
        ]);
      } catch {
        legacyCleanupFailed = true;
      }

      if (accountEpoch.current !== transition) {
        return false;
      }
      if (nextUser === null) {
        await runtime.deckReadyNotifications.clear().catch(() => undefined);
        if (accountEpoch.current !== transition) {
          return false;
        }
        if (legacyCleanupFailed) {
          setSyncNotice("이전 형식의 로컬 학습 기록을 정리하지 못했어요.");
        }
        return true;
      }

      const ownerId = nextUser.id.trim();
      if (ownerId.length === 0) {
        throw new Error("INVALID_ACCOUNT_OWNER");
      }

      let storedLearning = preloadedLearning ?? EMPTY_LEARNING_STATE;
      let storedSettings = preloadedSettings ?? DEFAULT_SETTINGS_STATE;
      let loadFailed = false;
      const [learningResult, settingsResult] = await Promise.allSettled([
        preloadedLearning === undefined
          ? loadLearningState(runtime.storage, ownerId)
          : Promise.resolve(preloadedLearning),
        preloadedSettings === undefined
          ? loadSettingsState(runtime.storage, ownerId)
          : Promise.resolve(preloadedSettings),
      ]);
      if (learningResult.status === "fulfilled") {
        storedLearning = learningResult.value;
      } else {
        loadFailed = true;
      }
      if (settingsResult.status === "fulfilled") {
        storedSettings = settingsResult.value;
      } else {
        loadFailed = true;
      }

      const resetUnsupportedReminders =
        runtime.notifications.availability !== "available" &&
        (storedSettings.dailyReminder || storedSettings.reviewReminder);
      const resetUnsupportedDeckReadyNotification =
        runtime.deckReadyNotifications.availability === "unsupported" &&
        storedSettings.deckReadyNotification;
      const resetUnavailableTts =
        runtime.tts.availability !== "available" && storedSettings.ttsEnabled;
      if (runtime.notifications.availability !== "available") {
        storedSettings = {
          ...storedSettings,
          dailyReminder: false,
          reviewReminder: false,
        };
      }
      if (runtime.deckReadyNotifications.availability === "unsupported") {
        storedSettings = { ...storedSettings, deckReadyNotification: false };
      }
      if (runtime.tts.availability !== "available") {
        storedSettings = { ...storedSettings, ttsEnabled: false };
      }
      if (accountEpoch.current !== transition) {
        return false;
      }
      if (
        resetUnsupportedReminders ||
        resetUnsupportedDeckReadyNotification ||
        resetUnavailableTts
      ) {
        try {
          await saveSettingsState(runtime.storage, ownerId, storedSettings);
        } catch {
          loadFailed = true;
        }
        if (accountEpoch.current !== transition) {
          return false;
        }
      }
      if (runtime.notifications.availability === "available") {
        try {
          await applyNotificationPreferences(storedSettings, storedLearning);
        } catch {
          storedSettings = {
            ...storedSettings,
            dailyReminder: false,
            reviewReminder: false,
          };
          await clearNativeNotifications().catch(() => undefined);
          try {
            await saveSettingsState(runtime.storage, ownerId, storedSettings);
          } catch {
            loadFailed = true;
          }
        }
        if (accountEpoch.current !== transition) {
          return false;
        }
      }
      const deckReadyAvailability = runtime.deckReadyNotifications.availability;
      if (
        (deckReadyAvailability === "available" ||
          deckReadyAvailability === "resolving") &&
        storedSettings.deckReadyNotification
      ) {
        try {
          await runtime.deckReadyNotifications.setEnabled(true);
        } catch {
          await runtime.deckReadyNotifications
            .setEnabled(false)
            .catch(() => undefined);
          // RC가 false/default로 확정된 경우에는 transport만 정리하고
          // 사용자의 opt-in을 보존해 다음 운영 활성화 때 다시 적용한다.
          if (runtime.deckReadyNotifications.availability === "available") {
            storedSettings = {
              ...storedSettings,
              deckReadyNotification: false,
            };
            try {
              await saveSettingsState(runtime.storage, ownerId, storedSettings);
            } catch {
              loadFailed = true;
            }
          }
        }
        if (accountEpoch.current !== transition) {
          await runtime.deckReadyNotifications
            .setEnabled(false)
            .catch(() => undefined);
          return false;
        }
      } else {
        // 저장된 OFF, kill-switch, 미지원 환경 모두 stale installation 정리를 시도한다.
        await runtime.deckReadyNotifications
          .setEnabled(false)
          .catch(() => undefined);
        if (accountEpoch.current !== transition) {
          return false;
        }
      }

      activeOwnerId.current = ownerId;
      learningStateRef.current = storedLearning;
      setLearningState(storedLearning);
      settingsRef.current = storedSettings;
      setSettings(storedSettings);
      progress.current = new Map(
        storedLearning.progresses.map((item) => [
          `${item.deckId}:${item.cardId}`,
          item,
        ])
      );
      setUser(nextUser);
      if (loadFailed) {
        setSyncNotice(
          "이 계정의 로컬 학습 기록 또는 설정을 불러오지 못했어요."
        );
      } else if (legacyCleanupFailed) {
        setSyncNotice("이전 형식의 로컬 학습 기록을 정리하지 못했어요.");
      }
      return true;
    },
    [
      clearAccountMemory,
      applyNotificationPreferences,
      clearNativeNotifications,
      runtime.deckReadyNotifications,
      runtime.notifications,
      runtime.storage,
      runtime.tts,
    ]
  );

  const applySyncEnvelope = useCallback(
    async (
      ownerId: string,
      epoch: number,
      envelope: SyncEnvelope<LearningSyncSnapshot>
    ): Promise<DaoewoLearningState | null> => {
      const freeCards = envelope.snapshot.backup.freeDecks.flatMap((deck) =>
        deck.progresses.map((progress) => ({
          deckId: progress.state.deckId,
          cardId: progress.state.cardId,
        }))
      );
      const snapshots = await runtime.sync.resolveFreeCardSnapshots(freeCards);
      if (accountEpoch.current !== epoch || activeOwnerId.current !== ownerId) {
        return null;
      }
      await persistenceQueue.current.catch(() => undefined);
      if (accountEpoch.current !== epoch || activeOwnerId.current !== ownerId) {
        return null;
      }
      const next = mergeLearningStateFromSync(
        learningStateRef.current,
        envelope.snapshot,
        snapshots
      );
      const save = persistenceQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (
            accountEpoch.current !== epoch ||
            activeOwnerId.current !== ownerId
          ) {
            return;
          }
          await saveLearningState(runtime.storage, ownerId, next);
        });
      persistenceQueue.current = save;
      await save;
      if (accountEpoch.current !== epoch || activeOwnerId.current !== ownerId) {
        return null;
      }
      learningStateRef.current = next;
      setLearningState(next);
      progress.current = new Map(
        next.progresses.map((item) => [`${item.deckId}:${item.cardId}`, item])
      );
      const scheduledSettings = settingsRef.current;
      if (
        scheduledSettings.reviewReminder &&
        runtime.notifications.availability === "available"
      ) {
        try {
          await applyNotificationPreferences(scheduledSettings, next);
        } catch {
          const disabled = { ...scheduledSettings, reviewReminder: false };
          await applyNotificationPreferences(disabled, next).catch(() =>
            clearNativeNotifications().catch(() => undefined)
          );
          await saveSettingsState(runtime.storage, ownerId, disabled).catch(
            () => undefined
          );
          if (
            accountEpoch.current === epoch &&
            activeOwnerId.current === ownerId &&
            settingsRef.current === scheduledSettings
          ) {
            settingsRef.current = disabled;
            setSettings(disabled);
            setSyncNotice(
              "동기화된 복습 일정의 알림을 예약하지 못해 복습 알림을 껐어요."
            );
          }
        }
      }
      return next;
    },
    [
      applyNotificationPreferences,
      clearNativeNotifications,
      runtime.notifications,
      runtime.storage,
      runtime.sync,
    ]
  );

  const synchronizeAccount = useCallback(
    async (ownerId: string, epoch: number): Promise<void> => {
      await persistenceQueue.current.catch(() => undefined);
      if (accountEpoch.current !== epoch || activeOwnerId.current !== ownerId) {
        return;
      }
      let pulled: SyncEnvelope<LearningSyncSnapshot> | null;
      try {
        pulled = await runtime.sync.pull(ownerId);
      } catch {
        if (
          accountEpoch.current === epoch &&
          activeOwnerId.current === ownerId
        ) {
          setSyncNotice(
            "클라우드 학습 기록을 확인하지 못했어요. 이 기기의 기록은 그대로 유지됩니다."
          );
        }
        return;
      }
      if (pulled === null) {
        return;
      }
      const merged = await applySyncEnvelope(ownerId, epoch, pulled);
      if (merged === null) {
        return;
      }
      const outbound: SyncEnvelope<LearningSyncSnapshot> = {
        revision: pulled.revision,
        updatedAt: pulled.updatedAt,
        snapshot: {
          ...pulled.snapshot,
          backup: {
            ...pulled.snapshot.backup,
            sessions: merged.sessions,
          },
        },
      };
      let pushed: SyncEnvelope<LearningSyncSnapshot>;
      try {
        pushed = await runtime.sync.push(ownerId, outbound);
      } catch {
        if (
          accountEpoch.current === epoch &&
          activeOwnerId.current === ownerId
        ) {
          setSyncNotice(
            "학습 기록 백업을 완료하지 못했어요. 이 기기에 저장하고 다음에 다시 시도합니다."
          );
        }
        return;
      }
      if ((await applySyncEnvelope(ownerId, epoch, pushed)) !== null) {
        setSyncNotice(null);
      }
    },
    [applySyncEnvelope, runtime.sync]
  );

  const scheduleAccountSync = useCallback(
    (ownerId: string): Promise<void> => {
      const epoch = accountEpoch.current;
      const scheduled = syncQueue.current
        .catch(() => undefined)
        .then(() => synchronizeAccount(ownerId, epoch));
      syncQueue.current = scheduled.catch(() => undefined);
      return scheduled;
    },
    [synchronizeAccount]
  );

  useEffect(() => {
    let active = true;

    void (async () => {
      const [userResult, entitlementResult] = await Promise.allSettled([
        runtime.auth.getCurrentUser(),
        runtime.purchase.getEntitlement(),
      ]);
      if (!active) return;
      if (userResult.status === "rejected") {
        accountEpoch.current += 1;
        clearAccountMemory();
        setAuthError(
          "계정 상태를 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요."
        );
        setInitialized(true);
        return;
      }
      const currentUser = userResult.value;
      const hydrated = await hydrateAccount(currentUser);
      if (!active || !hydrated) return;
      if (entitlementResult.status === "fulfilled") {
        setEntitlement(entitlementResult.value);
      } else {
        setEntitlement(FREE_ENTITLEMENT);
        setSyncNotice(
          "구독 상태를 확인하지 못했어요. 이 기기의 Free 기록은 그대로 사용할 수 있어요."
        );
      }
      if (initialScreen === undefined && currentUser !== null) {
        setScreen("home");
      }
      setInitialized(true);
      if (currentUser !== null) {
        void scheduleAccountSync(currentUser.id);
      }
    })();

    return () => {
      active = false;
      accountEpoch.current += 1;
    };
  }, [
    clearAccountMemory,
    hydrateAccount,
    initialScreen,
    runtime,
    scheduleAccountSync,
  ]);

  const applyLearningState = useCallback(
    (next: DaoewoLearningState): Promise<void> => {
      const ownerId = activeOwnerId.current;
      const epoch = accountEpoch.current;
      if (ownerId === null) {
        setSyncNotice("계정을 확인할 수 없어 학습 기록을 저장하지 않았어요.");
        return Promise.reject(new Error("MISSING_ACCOUNT_OWNER"));
      }
      learningStateRef.current = next;
      setLearningState(next);
      const save = persistenceQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (
            accountEpoch.current !== epoch ||
            activeOwnerId.current !== ownerId
          ) {
            return;
          }
          await saveLearningState(runtime.storage, ownerId, next);
          const scheduledSettings = settingsRef.current;
          if (
            scheduledSettings.reviewReminder &&
            runtime.notifications.availability === "available"
          ) {
            try {
              await applyNotificationPreferences(scheduledSettings, next);
            } catch {
              const disabled = {
                ...scheduledSettings,
                reviewReminder: false,
              };
              await applyNotificationPreferences(disabled, next).catch(() =>
                clearNativeNotifications().catch(() => undefined)
              );
              await saveSettingsState(runtime.storage, ownerId, disabled).catch(
                () => undefined
              );
              if (
                accountEpoch.current === epoch &&
                activeOwnerId.current === ownerId &&
                settingsRef.current === scheduledSettings
              ) {
                settingsRef.current = disabled;
                setSettings(disabled);
                setSyncNotice(
                  "복습 알림 예약을 갱신하지 못해 알림 설정을 껐어요."
                );
              }
            }
          }
        });
      persistenceQueue.current = save;
      void save.catch(() => {
        if (
          accountEpoch.current === epoch &&
          activeOwnerId.current === ownerId
        ) {
          setSyncNotice(
            "이 계정의 학습 기록을 저장하지 못했어요. 저장 공간을 확인해 주세요."
          );
        }
      });
      return save;
    },
    [
      applyNotificationPreferences,
      clearNativeNotifications,
      runtime.notifications,
      runtime.storage,
    ]
  );

  const applySettingUpdate = useCallback(
    async (key: keyof DaoewoSettingsState, value: boolean): Promise<void> => {
      const ownerId = activeOwnerId.current;
      const epoch = accountEpoch.current;
      if (ownerId === null) {
        throw new Error("MISSING_ACCOUNT_OWNER");
      }

      const previous = settingsRef.current;
      const next = { ...previous, [key]: value };
      if (key === "deckReadyNotification") {
        if (runtime.deckReadyNotifications.availability !== "available") {
          throw new Error("DECK_READY_NOTIFICATIONS_UNAVAILABLE");
        }

        if (value) {
          try {
            await runtime.deckReadyNotifications.setEnabled(true);
          } catch (error) {
            await runtime.deckReadyNotifications
              .setEnabled(false)
              .catch(() => undefined);
            throw error;
          }
          if (
            accountEpoch.current !== epoch ||
            activeOwnerId.current !== ownerId
          ) {
            await runtime.deckReadyNotifications
              .setEnabled(false)
              .catch(() => undefined);
            throw new Error("ACCOUNT_CHANGED");
          }
          try {
            await saveSettingsState(runtime.storage, ownerId, next);
          } catch (error) {
            await runtime.deckReadyNotifications
              .setEnabled(false)
              .catch(() => undefined);
            throw error;
          }
          if (
            accountEpoch.current !== epoch ||
            activeOwnerId.current !== ownerId
          ) {
            await Promise.allSettled([
              saveSettingsState(runtime.storage, ownerId, previous),
              runtime.deckReadyNotifications.setEnabled(false),
            ]);
            throw new Error("ACCOUNT_CHANGED");
          }
          settingsRef.current = next;
          setSettings(next);
          return;
        }

        // OFF는 저장을 먼저 확정하고, server installation 해제는 best-effort로 처리한다.
        await saveSettingsState(runtime.storage, ownerId, next);
        if (
          accountEpoch.current === epoch &&
          activeOwnerId.current === ownerId
        ) {
          settingsRef.current = next;
          setSettings(next);
        }
        await runtime.deckReadyNotifications
          .setEnabled(false)
          .catch(() => undefined);
        return;
      }
      const notificationSetting =
        key === "dailyReminder" || key === "reviewReminder";
      if (
        key === "ttsEnabled" &&
        value &&
        runtime.tts.availability !== "available"
      ) {
        throw new Error("TTS_UNSUPPORTED");
      }
      if (
        notificationSetting &&
        runtime.notifications.availability !== "available"
      ) {
        throw new Error("NOTIFICATIONS_UNSUPPORTED");
      }

      if (notificationSetting && value) {
        try {
          await applyNotificationPreferences(next, learningStateRef.current);
        } catch (error) {
          try {
            await applyNotificationPreferences(
              previous,
              learningStateRef.current
            );
          } catch {
            const disabled = {
              ...previous,
              dailyReminder: false,
              reviewReminder: false,
            };
            await saveSettingsState(runtime.storage, ownerId, disabled).catch(
              () => undefined
            );
            if (
              accountEpoch.current === epoch &&
              activeOwnerId.current === ownerId
            ) {
              settingsRef.current = disabled;
              setSettings(disabled);
            }
          }
          throw error;
        }
      }

      try {
        await saveSettingsState(runtime.storage, ownerId, next);
      } catch (error) {
        if (notificationSetting && value) {
          await applyNotificationPreferences(
            previous,
            learningStateRef.current
          ).catch(() => undefined);
        }
        throw error;
      }

      if (accountEpoch.current !== epoch || activeOwnerId.current !== ownerId) {
        return;
      }
      settingsRef.current = next;
      setSettings(next);

      if (notificationSetting && !value) {
        // OFF는 저장을 먼저 확정한다. native cancel 실패로 다시 true로 롤백하지 않는다.
        await applyNotificationPreferences(
          next,
          learningStateRef.current
        ).catch(() => undefined);
      }
      if (key === "ttsEnabled" && !value) {
        await runtime.tts.stop().catch(() => undefined);
      }
    },
    [
      applyNotificationPreferences,
      runtime.deckReadyNotifications,
      runtime.notifications,
      runtime.storage,
      runtime.tts,
    ]
  );

  const updateSetting = useCallback(
    (key: keyof DaoewoSettingsState, value: boolean): Promise<void> => {
      if (accountTransitionInProgress.current) {
        return Promise.reject(new Error("ACCOUNT_TRANSITION_IN_PROGRESS"));
      }
      const operation = settingsOperationQueue.current
        .catch(() => undefined)
        .then(() => applySettingUpdate(key, value));
      settingsOperationQueue.current = operation.catch(() => undefined);
      return operation;
    },
    [applySettingUpdate]
  );

  useEffect(() => {
    const subscribe = runtime.deckReadyNotifications.subscribeTransportDisabled;
    if (subscribe === undefined) {
      return;
    }
    return subscribe(() => {
      const ownerId = activeOwnerId.current;
      const epoch = accountEpoch.current;
      if (ownerId === null) {
        return;
      }
      const operation = settingsOperationQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (
            accountEpoch.current !== epoch ||
            activeOwnerId.current !== ownerId ||
            !settingsRef.current.deckReadyNotification
          ) {
            return;
          }
          const disabled = {
            ...settingsRef.current,
            deckReadyNotification: false,
          };
          let saveFailed = false;
          try {
            await saveSettingsState(runtime.storage, ownerId, disabled);
          } catch {
            saveFailed = true;
          }
          if (
            accountEpoch.current !== epoch ||
            activeOwnerId.current !== ownerId
          ) {
            return;
          }
          settingsRef.current = disabled;
          setSettings(disabled);
          setSyncNotice(
            saveFailed
              ? "알림 연결이 끊겼고 설정 저장도 완료하지 못했어요."
              : "알림 연결이 반복해서 실패해 신규·요청 덱 알림을 껐어요."
          );
        });
      settingsOperationQueue.current = operation.catch(() => undefined);
    });
  }, [runtime.deckReadyNotifications, runtime.storage]);

  useEffect(() => {
    const subscribe =
      runtime.deckReadyNotifications.subscribeAvailabilityChanged;
    if (subscribe === undefined) {
      return;
    }
    return subscribe(() => {
      refreshDeckReadyAvailability((revision) => revision + 1);
    });
  }, [runtime.deckReadyNotifications]);

  const exportLearningData = useCallback(async (): Promise<void> => {
    if (runtime.sharing.availability !== "available") {
      throw new Error("SHARING_UNSUPPORTED");
    }
    const value = createLearningDataExport(
      learningStateRef.current,
      runtime.now()
    );
    await runtime.sharing.shareText({
      title: "다외워 학습 데이터",
      message: serializeLearningDataExport(value),
    });
  }, [runtime]);

  const loadCatalog = useCallback(async () => {
    const requestEpoch = accountEpoch.current;
    setCatalogStatus("loading");
    try {
      const decks = await runtime.content.listCatalog();
      if (accountEpoch.current !== requestEpoch) {
        return;
      }
      if (decks.length === 0) {
        setCatalogDecks([]);
        setSelectedDeck(null);
        setCatalogStatus("empty");
        setDeckStatus("empty");
        return;
      }

      setCatalogDecks(decks);
      setSelectedDeck(
        (current) =>
          decks.find((deck) => deck.id === current?.id) ??
          decks.find((deck) => deck.progress !== undefined) ??
          decks[0] ??
          null
      );
      setCatalogStatus("ready");
      setDeckStatus("ready");
    } catch {
      if (accountEpoch.current !== requestEpoch) {
        return;
      }
      setCatalogDecks([]);
      setSelectedDeck(null);
      setCatalogStatus("error");
      setDeckStatus("error");
    }
  }, [runtime]);

  useEffect(() => {
    if (initialized && (user !== null || initialScreen !== undefined)) {
      void loadCatalog();
    }
  }, [initialized, initialScreen, loadCatalog, user]);

  const openPaywall = useCallback(
    (trigger: DaoewoPaywallTrigger) => {
      setPaywallReturn(screen === "paywall" ? "home" : screen);
      setScreen("paywall");
      safelyTrack(runtime, "memo_paywall_view", { trigger });
    },
    [runtime, screen]
  );

  const navigate = useCallback(
    (next: DaoewoScreen) => {
      if (next === "paywall") {
        openPaywall(paywallTriggerForScreen(screen));
        return;
      }
      setScreen(next);
    },
    [openPaywall, screen]
  );

  const authenticate = async (
    provider: DaoewoAuthProvider,
    destination: DaoewoScreen = "home"
  ) => {
    if (accountTransitionInProgress.current) {
      return;
    }
    accountTransitionInProgress.current = true;
    const sourceUser = user;
    const sourceOwnerId = activeOwnerId.current;
    let sourceLearning = learningStateRef.current;
    let sourceSettings = settingsRef.current;
    let authenticatedTarget: DaoewoUser | null = null;
    setBusyProvider(provider);
    setAuthError(null);
    try {
      // 계정 연결 중 이전 owner의 sync/settings/notification 응답이 source key나
      // native binding을 다시 쓰지 않게 모든 계정 경계 큐를 비운 뒤 상태를 확정한다.
      await syncQueue.current.catch(() => undefined);
      await settingsOperationQueue.current.catch(() => undefined);
      if (sourceUser?.isGuest === true && sourceOwnerId === sourceUser.id) {
        // 로그인 전에 마지막 guest save까지 끝내 source state를 확정한다.
        await persistenceQueue.current;
      } else {
        await persistenceQueue.current.catch(() => undefined);
      }
      await notificationOperationQueue.current.catch(() => undefined);
      sourceLearning = learningStateRef.current;
      sourceSettings = settingsRef.current;
      const nextUser = await runtime.auth.signIn(provider);
      authenticatedTarget = nextUser;
      let nextEntitlement = FREE_ENTITLEMENT;
      let entitlementFailed = false;
      try {
        nextEntitlement = await runtime.purchase.getEntitlement();
      } catch {
        entitlementFailed = true;
      }
      let hydrated = true;
      let migrationPending = nextUser.accountMergeStatus === "pending";
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
          let targetLearning = EMPTY_LEARNING_STATE;
          let targetLoadFailed = false;
          try {
            targetLearning = await loadLearningState(
              runtime.storage,
              nextUser.id
            );
          } catch {
            targetLoadFailed = true;
            migrationPending = true;
          }
          const mergedLearning = mergeLearningStates(
            sourceLearning,
            targetLearning
          );
          // Firebase Auth target을 먼저 UI의 authoritative owner로 확정한다.
          hydrated = await hydrateAccount(
            nextUser,
            mergedLearning,
            sourceSettings
          );
          if (hydrated && !targetLoadFailed) {
            try {
              // target save가 모두 성공하기 전에는 source key를 지우지 않는다.
              await Promise.all([
                saveLearningState(
                  runtime.storage,
                  nextUser.id,
                  learningStateRef.current
                ),
                saveSettingsState(
                  runtime.storage,
                  nextUser.id,
                  settingsRef.current
                ),
              ]);
              try {
                await Promise.all([
                  removeLearningState(runtime.storage, sourceOwnerId),
                  removeSettingsState(runtime.storage, sourceOwnerId),
                ]);
              } catch {
                migrationPending = true;
              }
            } catch {
              migrationPending = true;
            }
          }
        }
      } else {
        hydrated = await hydrateAccount(nextUser);
      }
      if (!hydrated) {
        return;
      }
      setEntitlement(nextEntitlement);
      if (migrationPending) {
        setSyncNotice(
          "계정은 연결됐지만 일부 게스트 기록 병합은 다음 동기화에서 다시 확인해요."
        );
      } else if (entitlementFailed) {
        setSyncNotice(
          "구독 상태를 확인하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요."
        );
      }
      const syncEpoch = accountEpoch.current;
      void scheduleAccountSync(nextUser.id).finally(() => {
        if (
          migrationPending &&
          accountEpoch.current === syncEpoch &&
          activeOwnerId.current === nextUser.id
        ) {
          setSyncNotice(
            "계정은 연결됐지만 일부 게스트 기록 병합은 다음 동기화에서 다시 확인해요."
          );
        }
      });
      navigate(destination);
    } catch {
      let authoritativeTarget = authenticatedTarget;
      if (authoritativeTarget === null) {
        try {
          const currentUser = await runtime.auth.getCurrentUser();
          if (
            currentUser !== null &&
            currentUser.isGuest === false &&
            (sourceUser?.isGuest === true || currentUser.id !== sourceOwnerId)
          ) {
            authoritativeTarget = currentUser;
          }
        } catch {
          // 재조회 실패만으로 source credential 복구를 시도하지 않는다.
        }
      }
      if (authoritativeTarget === null) {
        // target Auth가 확정되기 전 실패만 로그인 실패로 취급한다.
        setAuthError("로그인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.");
      } else {
        // target Auth 이후에는 source credential로 임의 복구하지 않는다.
        // source key는 보존하고 target을 authoritative UI owner로 유지한다.
        const fallbackLearning =
          sourceUser?.isGuest === true ? sourceLearning : EMPTY_LEARNING_STATE;
        const fallbackSettings =
          sourceUser?.isGuest === true
            ? sourceSettings
            : DEFAULT_SETTINGS_STATE;
        try {
          await hydrateAccount(
            authoritativeTarget,
            fallbackLearning,
            fallbackSettings
          );
        } catch {
          clearAccountMemory();
          activeOwnerId.current = authoritativeTarget.id;
          learningStateRef.current = fallbackLearning;
          setLearningState(fallbackLearning);
          settingsRef.current = fallbackSettings;
          setSettings(fallbackSettings);
          progress.current = new Map(
            fallbackLearning.progresses.map((item) => [
              `${item.deckId}:${item.cardId}`,
              item,
            ])
          );
          setUser(authoritativeTarget);
        }
        setEntitlement(FREE_ENTITLEMENT);
        setSyncNotice(
          "계정은 연결됐지만 게스트 기록 병합을 완료하지 못했어요. 기록은 이 기기에 보존했어요."
        );
        void scheduleAccountSync(authoritativeTarget.id);
        navigate(destination);
      }
    } finally {
      accountTransitionInProgress.current = false;
      setBusyProvider(null);
    }
  };

  const continueAsGuest = async () => {
    setBusyProvider("guest");
    setAuthError(null);
    try {
      const nextUser = await runtime.auth.continueAsGuest();
      const hydrated = await hydrateAccount(nextUser);
      if (!hydrated) {
        return;
      }
      setEntitlement(FREE_ENTITLEMENT);
      void scheduleAccountSync(nextUser.id);
      navigate("home");
    } catch {
      accountEpoch.current += 1;
      clearAccountMemory();
      setAuthError(
        "게스트 시작을 완료하지 못했어요. 잠시 후 다시 시도해 주세요."
      );
    } finally {
      setBusyProvider(null);
    }
  };

  const isPro = hasActiveProEntitlement(entitlement, runtime.now());
  const activeDecks = catalogDecks.filter(
    (deck) =>
      deck.availability === "published" &&
      deck.progress !== undefined &&
      (deck.tier === "free" || isPro)
  );
  const visibleActiveDecks = isPro ? activeDecks : activeDecks.slice(0, 1);
  const studyAvailable = catalogDecks.some(
    (deck) => deck.availability === "published" && deck.cardCount !== null
  );

  const loadSession = useCallback(
    async (deck: DaoewoDeckView, goalKey?: string) => {
      const requestEpoch = accountEpoch.current;
      setSelectedDeck(deck);
      setSessionAnswers({});
      progressCommitContext.current = null;
      if (deck.availability !== "published" || deck.cardCount === null) {
        setSessionWindow(null);
        setSessionStatus("empty");
        setScreen("study");
        return;
      }
      setSessionStatus("loading");
      setSessionWindow(null);
      setScreen("study");
      try {
        const window = await runtime.content.getCardWindow({
          deckId: deck.id,
          ...(goalKey ? { goalKey } : {}),
        });
        if (accountEpoch.current !== requestEpoch) {
          return;
        }
        if (window.cards.length === 0) {
          setSessionStatus("empty");
          return;
        }
        setSessionWindow(window);
        setSessionStatus("ready");
        progressCommitContext.current = {
          deckId: window.deckId,
          windowId: window.id,
          cardIds: window.cards.map((card) => card.id),
          ...(window.goalKey ?? goalKey
            ? { goalKey: window.goalKey ?? goalKey }
            : {}),
        };
        sessionStartedAt.current = runtime.now().getTime();
        safelyTrack(runtime, "memo_session_start", {
          deck_id: deck.id,
          target_count: window.targetCount,
        });
      } catch {
        if (accountEpoch.current !== requestEpoch) {
          return;
        }
        setSessionStatus("error");
      }
    },
    [runtime]
  );

  useEffect(() => {
    if (
      initialScreen === "study" &&
      catalogStatus === "ready" &&
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
    if (deck.availability === "published") {
      const decision = canActivateDeck(
        deck,
        visibleActiveDecks.map((item) => item.id),
        entitlement,
        runtime.now()
      );
      if (!decision.allowed && decision.reason === "pro-required") {
        safelyTrack(runtime, "memo_premium_deck_tap", {
          deck_id: deck.id,
        });
        openPaywall("premium-deck");
        return;
      }
    }
    setDeckStatus("loading");
    setScreen("deck-detail");
    try {
      const detail = await runtime.content.getDeck(deck.id);
      if (accountEpoch.current !== requestEpoch) {
        return;
      }
      if (detail === null) {
        setDeckStatus("empty");
        return;
      }
      if (detail.availability === "published") {
        const refreshedDecision = canActivateDeck(
          detail,
          visibleActiveDecks.map((item) => item.id),
          entitlement,
          runtime.now()
        );
        if (
          !refreshedDecision.allowed &&
          refreshedDecision.reason === "pro-required"
        ) {
          safelyTrack(runtime, "memo_premium_deck_tap", { deck_id: detail.id });
          openPaywall("premium-deck");
          return;
        }
      }
      setSelectedDeck(detail);
      setDeckStatus("ready");
      safelyTrack(runtime, "memo_deck_open", {
        deck_id: detail.id,
        tier: detail.tier,
        source: detail.source,
      });
    } catch {
      if (accountEpoch.current !== requestEpoch) {
        return;
      }
      setDeckStatus("error");
    }
  };

  const startGoal = async (mode: GoalMode, value: number) => {
    if (selectedDeck === null || goalBusy) {
      return;
    }
    if (
      selectedDeck.availability !== "published" ||
      selectedDeck.cardCount === null
    ) {
      setGoalError("카드 승인이 끝난 뒤 목표를 설정할 수 있어요.");
      return;
    }
    const decision = canActivateDeck(
      selectedDeck,
      visibleActiveDecks.map((deck) => deck.id),
      entitlement,
      runtime.now()
    );
    if (!decision.allowed) {
      if (decision.reason === "pro-required") {
        safelyTrack(runtime, "memo_premium_deck_tap", {
          deck_id: selectedDeck.id,
        });
      }
      openPaywall(
        decision.reason === "pro-required"
          ? "premium-deck"
          : "active-deck-limit"
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
      safelyTrack(runtime, "memo_goal_set", {
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
        "목표를 만들지 못했어요. 연결을 확인하고 다시 시도해 주세요."
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
      (selectedDeck?.availability === "published" ? selectedDeck : undefined) ??
      catalogDecks.find((item) => item.availability === "published");
    if (deck === undefined || deck === null) {
      setSyncNotice(
        "현재 학습 가능한 덱이 없어요. 준비 중인 덱을 확인해 주세요."
      );
      navigate("catalog");
      return;
    }
    const decision = canActivateDeck(
      deck,
      visibleActiveDecks.map((item) => item.id),
      entitlement,
      runtime.now()
    );
    if (!decision.allowed) {
      if (decision.reason === "pro-required") {
        safelyTrack(runtime, "memo_premium_deck_tap", { deck_id: deck.id });
      }
      openPaywall(
        decision.reason === "pro-required"
          ? "premium-deck"
          : "active-deck-limit"
      );
      return;
    }
    void loadSession(deck, activeGoalKey);
  };

  const sessionCards = sessionWindow?.cards ?? [];

  const announceVoiceGuide = useCallback((message: string) => {
    if (settingsRef.current.voiceGuide) {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, []);

  const answerStudyCard = (card: DaoewoCardView, outcome: SwipeOutcome) => {
    const next = classifyDemoCard(
      card,
      outcome,
      runtime.now(),
      progress.current.get(progressKey(card))
    );
    progress.current.set(progressKey(card), next);
    setSessionAnswers((current) => ({
      ...current,
      [progressKey(card)]: outcome,
    }));
    const persistCardBody =
      catalogDecks.find((deck) => deck.id === card.deckId)?.tier === "free";
    void applyLearningState(
      withProgressSnapshot(
        learningStateRef.current,
        next,
        card,
        persistCardBody
      )
    ).catch(() => {
      // applyLearningState가 사용자용 저장 오류 안내를 설정한다.
    });
    announceVoiceGuide(
      outcome === "known" ? "안다로 분류했어요." : "모르겠다로 분류했어요."
    );
  };

  const commitCurrentProgress = async (): Promise<void> => {
    const context = progressCommitContext.current;
    if (context === null) {
      return;
    }
    const allowedCardIds = new Set(context.cardIds);
    const progresses = [...progress.current.values()].filter(
      (item) =>
        item.deckId === context.deckId && allowedCardIds.has(item.cardId)
    );
    if (progresses.length === 0) {
      return;
    }
    const requestEpoch = accountEpoch.current;
    try {
      await runtime.content.commitProgressBatch({
        deckId: context.deckId,
        ...(context.goalKey ? { goalKey: context.goalKey } : {}),
        windowId: context.windowId,
        progresses,
      });
      if (accountEpoch.current === requestEpoch) {
        setSyncNotice(null);
        const ownerId = activeOwnerId.current;
        if (ownerId !== null) {
          void scheduleAccountSync(ownerId);
        }
      }
    } catch {
      if (accountEpoch.current === requestEpoch) {
        setSyncNotice(
          "학습 기록을 동기화하지 못했어요. 연결되면 다시 시도해 주세요."
        );
      }
    }
  };

  const releaseWindowBodies = () => {
    setSessionWindow(null);
    setSessionStatus("loading");
    setSessionAnswers({});
    sessionStartedAt.current = null;
  };

  const closeStudy = async () => {
    await runtime.tts.stop().catch(() => undefined);
    releaseWindowBodies();
    setReviewCards([]);
    navigate("home");
    await commitCurrentProgress();
    progressCommitContext.current = null;
  };

  const closeReview = async () => {
    await runtime.tts.stop().catch(() => undefined);
    releaseWindowBodies();
    setReviewCards([]);
    navigate("mistakes");
    await commitCurrentProgress();
    progressCommitContext.current = null;
  };

  const completeStudy = async (unknownCards: readonly DaoewoCardView[]) => {
    await runtime.tts.stop().catch(() => undefined);
    const completedAt = runtime.now().getTime();
    const elapsedMs = Math.max(
      0,
      completedAt - (sessionStartedAt.current ?? completedAt)
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
    safelyTrack(runtime, "memo_session_complete", {
      known: Math.max(0, sessionCards.length - unknownCards.length),
      unknown: unknownCards.length,
      elapsed_ms: elapsedMs,
    });
    const completedSummary = deriveDashboardSummary(
      learningStateRef.current,
      catalogDecks,
      runtime.now()
    );
    if (completedSummary.streak.current > 0) {
      safelyTrack(runtime, "memo_streak_extend", {
        streak_days: completedSummary.streak.current,
      });
    }
    if (unknownCards.length === 0) {
      announceVoiceGuide("오늘 학습을 완료했어요. 복습할 카드가 없어요.");
      setReviewCards([]);
      progressCommitContext.current = null;
      navigate("home");
      return;
    }
    announceVoiceGuide(
      `오늘 학습을 완료했어요. 바로 복습할 카드 ${unknownCards.length}장이 있어요.`
    );
    setReviewCards(unknownCards);
    navigate("quick-review");
  };

  const rateReview = (card: DaoewoCardView, rating: ReviewRating) => {
    const next = reviewDemoCard(
      card,
      rating,
      runtime.now(),
      progress.current.get(progressKey(card))
    );
    progress.current.set(progressKey(card), next);
    const persistCardBody =
      catalogDecks.find((deck) => deck.id === card.deckId)?.tier === "free";
    void applyLearningState(
      withProgressSnapshot(
        learningStateRef.current,
        next,
        card,
        persistCardBody
      )
    ).catch(() => {
      // applyLearningState가 사용자용 저장 오류 안내를 설정한다.
    });
    safelyTrack(runtime, "memo_review_outcome", {
      outcome: rating,
    });
    announceVoiceGuide(
      rating === "easy"
        ? "맞췄다로 기록했어요."
        : rating === "confused"
        ? "헷갈린다로 기록했어요."
        : "몰랐다로 기록했어요."
    );
  };

  const speak = (card: DaoewoCardView) => {
    if (
      runtime.tts.availability !== "available" ||
      !settingsRef.current.ttsEnabled
    ) {
      return;
    }
    void runtime.tts.speak(card.front, card.locale).catch(() => {
      // TTS 미지원 환경에서도 카드 학습은 계속 가능하다.
    });
  };

  const submitDeckRequest = async (draft: DeckRequestDraft) => {
    await runtime.content.submitDeckRequest({
      topic: draft.topic,
      category: draft.category,
      locale: deckRequestLocaleCode(draft.locale),
      ...(draft.note ? { note: draft.note } : {}),
    });
    safelyTrack(runtime, "memo_deck_request", {
      category: draft.category,
      locale: deckRequestLocaleCode(draft.locale),
    });
  };

  const purchase = async (plan: SubscriptionPlan, trial: boolean) => {
    if (user?.isGuest !== false) {
      throw new Error("ACCOUNT_LINK_REQUIRED");
    }
    const next = await runtime.purchase.purchase(plan);
    setEntitlement(next);
    safelyTrack(runtime, "memo_subscribe", {
      plan,
      trial,
    });
  };

  const restore = async () => {
    if (user?.isGuest !== false) {
      throw new Error("ACCOUNT_LINK_REQUIRED");
    }
    const next = await runtime.purchase.restore();
    setEntitlement(next);
  };

  const browseCatalog = useCallback(
    (category: string) => {
      safelyTrack(runtime, "memo_catalog_browse", { category });
    },
    [runtime]
  );

  const shareProgress = useCallback(async (): Promise<void> => {
    if (runtime.sharing.availability !== "available") {
      throw new Error("SHARING_UNSUPPORTED");
    }
    const summary = deriveDashboardSummary(
      learningStateRef.current,
      catalogDecks,
      runtime.now()
    );
    await runtime.sharing.shareText({
      title: "다외워 이번 주 학습 기록",
      message: [
        "다외워 이번 주 학습 기록",
        `현재 스트릭 ${summary.streak.current}일`,
        `오늘 ${summary.todayCompleted}/${summary.todayTarget}장`,
        `전체 암기율 ${summary.memorizationRate}%`,
      ].join("\n"),
    });
    safelyTrack(runtime, "memo_share", {
      type: "weekly-progress",
    });
  }, [catalogDecks, runtime]);

  const completeReview = async () => {
    await runtime.tts.stop().catch(() => undefined);
    releaseWindowBodies();
    setReviewCards([]);
    navigate("home");
    await commitCurrentProgress();
    progressCommitContext.current = null;
  };

  const removeCurrentAccountState = async (prepared?: {
    readonly ownerId: string | null;
    readonly transition: number;
    readonly deckReadyCleared: boolean;
  }) => {
    const ownerId = prepared?.ownerId ?? activeOwnerId.current;
    const transition = prepared?.transition ?? accountEpoch.current + 1;
    if (prepared === undefined) {
      accountEpoch.current = transition;
      activeOwnerId.current = null;
    }
    await settingsOperationQueue.current.catch(() => undefined);
    await persistenceQueue.current.catch(() => undefined);
    await syncQueue.current.catch(() => undefined);
    if (accountEpoch.current !== transition) {
      return;
    }
    try {
      await runtime.tts.stop().catch(() => undefined);
      await clearNativeNotifications().catch(() => undefined);
      if (!prepared?.deckReadyCleared) {
        await runtime.deckReadyNotifications.clear().catch(() => undefined);
      }
      await Promise.all([
        runtime.storage.removeItem(DAOEWO_LEGACY_LEARNING_STATE_STORAGE_KEY),
        runtime.storage.removeItem(DAOEWO_LEGACY_SETTINGS_STORAGE_KEY),
      ]);
      if (ownerId !== null) {
        await Promise.all([
          removeLearningState(runtime.storage, ownerId),
          removeSettingsState(runtime.storage, ownerId),
        ]);
      }
    } catch (error) {
      if (prepared === undefined && accountEpoch.current === transition) {
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
    navigate("onboarding");
  };

  const deleteAccount = async () => {
    const ownerId = activeOwnerId.current;
    const transition = accountEpoch.current + 1;
    accountEpoch.current = transition;
    activeOwnerId.current = null;
    await settingsOperationQueue.current.catch(() => undefined);
    await persistenceQueue.current.catch(() => undefined);
    await syncQueue.current.catch(() => undefined);
    if (accountEpoch.current !== transition) {
      throw new Error("ACCOUNT_CHANGED");
    }
    // callable unregister가 인증을 사용할 수 있도록 계정 삭제 전에 먼저 정리한다.
    await runtime.deckReadyNotifications.clear().catch(() => undefined);
    try {
      await runtime.auth.deleteAccount();
    } catch (error) {
      if (accountEpoch.current === transition) {
        activeOwnerId.current = ownerId;
        if (
          settingsRef.current.deckReadyNotification &&
          runtime.deckReadyNotifications.availability === "available"
        ) {
          try {
            await runtime.deckReadyNotifications.setEnabled(true);
          } catch {
            const disabled = {
              ...settingsRef.current,
              deckReadyNotification: false,
            };
            if (ownerId !== null) {
              await saveSettingsState(runtime.storage, ownerId, disabled).catch(
                () => undefined
              );
            }
            settingsRef.current = disabled;
            setSettings(disabled);
          }
        }
      }
      throw error;
    }
    await removeCurrentAccountState({
      ownerId,
      transition,
      deckReadyCleared: true,
    });
    navigate("onboarding");
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
    sessionStatus === "ready" && sessionWindow !== null
      ? {
          target: sessionWindow.targetCount,
          answered: Object.keys(sessionAnswers).length,
        }
      : undefined;
  const dashboardSummary = deriveDashboardSummary(
    learningState,
    catalogDecks,
    runtime.now(),
    currentSessionSummary
  );
  const mistakeItems = selectMistakeItems(learningState, runtime.now());
  const dueReviewCards = mistakeItems
    .filter((item) => item.isDue)
    .map((item) => item.card);

  switch (screen) {
    case "onboarding":
      return (
        <OnboardingScreen
          authOptions={authOptions}
          error={authError}
          busyProvider={busyProvider}
          onContinueAsGuest={continueAsGuest}
          onSignIn={authenticate}
        />
      );
    case "home":
      if (catalogStatus !== "ready") {
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
          onSelectDeck={(deck) => void openDeck(deck)}
          studyAvailable={studyAvailable}
          summary={dashboardSummary}
          user={effectiveUser}
        />
      );
    case "deck-detail":
      if (deckStatus !== "ready" || selectedDeck === null) {
        return (
          <ContentStateScreen
            title="덱 상세"
            status={deckStatus === "ready" ? "empty" : deckStatus}
            onBack={() => navigate("catalog")}
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
          onBack={() => navigate("catalog")}
          onRequestDeck={() => navigate("deck-request")}
          onStart={startGoal}
        />
      );
    case "study":
      if (sessionStatus !== "ready") {
        return (
          <ContentStateScreen
            title="오늘 학습"
            status={sessionStatus}
            onBack={() => navigate("home")}
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
          ttsEnabled={
            runtime.tts.availability === "available" && settings.ttsEnabled
          }
        />
      );
    case "quick-review":
      return (
        <QuickReviewScreen
          cards={reviewCards}
          onClose={() => void closeReview()}
          onComplete={completeReview}
          onRate={rateReview}
          onSpeak={speak}
          ttsEnabled={
            runtime.tts.availability === "available" && settings.ttsEnabled
          }
        />
      );
    case "mistakes":
      return (
        <MistakesScreen
          items={mistakeItems}
          isPro={isPro}
          now={runtime.now()}
          onBack={() => navigate("home")}
          onOpenPaywall={() => navigate("paywall")}
          onStartReview={() => {
            setReviewCards(dueReviewCards);
            navigate("quick-review");
          }}
          weaknessTags={dashboardSummary.weaknessTags}
        />
      );
    case "catalog":
      if (catalogStatus !== "ready") {
        return (
          <ContentStateScreen
            title="덱 카탈로그"
            status={catalogStatus}
            onBack={() => navigate("home")}
            onRetry={() => void loadCatalog()}
          />
        );
      }
      return (
        <CatalogScreen
          decks={catalogDecks}
          entitlement={entitlement}
          now={runtime.now()}
          onBack={() => navigate("home")}
          onBrowseCategory={browseCatalog}
          onRequestDeck={() => navigate("deck-request")}
          onSelectDeck={(deck) => void openDeck(deck)}
        />
      );
    case "deck-request":
      return (
        <DeckRequestScreen
          isPro={isPro}
          willNotifyWhenReady={
            runtime.deckReadyNotifications.availability === "available" &&
            settings.deckReadyNotification
          }
          onBack={() => navigate("catalog")}
          onSubmit={submitDeckRequest}
        />
      );
    case "statistics":
      return (
        <StatisticsScreen
          isPro={isPro}
          navigate={navigate}
          onContinueStudy={startTodayStudy}
          onShare={shareProgress}
          sharingAvailability={runtime.sharing.availability}
          summary={dashboardSummary}
        />
      );
    case "paywall":
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
          onSignIn={(provider) => authenticate(provider, "paywall")}
          onPurchase={purchase}
          onRestore={restore}
        />
      );
    case "settings":
      return (
        <SettingsScreen
          authError={authError}
          authOptions={authOptions}
          busyProvider={busyProvider}
          entitlement={entitlement}
          isPro={isPro}
          navigate={navigate}
          deckReadyNotificationAvailability={
            runtime.deckReadyNotifications.availability
          }
          notificationAvailability={runtime.notifications.availability}
          onDeleteAccount={deleteAccount}
          onExportData={exportLearningData}
          onSignIn={(provider) => authenticate(provider, "settings")}
          onSignOut={signOut}
          onUpdateSetting={updateSetting}
          settings={settings}
          sharingAvailability={runtime.sharing.availability}
          syncAvailability={runtime.sync.availability}
          ttsAvailability={runtime.tts.availability}
          user={effectiveUser}
        />
      );
  }
}

export default DaoewoApp;

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 22 },
  loadingTitle: { fontSize: 29, lineHeight: 38, fontWeight: "800" },
  stateBack: { paddingTop: 8, alignItems: "flex-start" },
  stateContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "stretch",
    gap: 18,
    paddingBottom: 40,
  },
  stateTitle: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "700",
    textAlign: "center",
  },
});
