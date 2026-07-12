import {
  addDaysToDateKey,
  buildDueReviewQueue,
  calculateStudyStatistics,
  calculateStudyStreak,
  isDateKey,
  mergeCardProgresses,
  toDateKey,
  type CalendarDayState,
  type CardProgress,
  type LearningSessionSnapshot,
  type LearningSyncSnapshot,
  type LocalDateKey,
  type StudyStreak,
} from '@daoewo/product-core';

import type {DaoewoCardView, DaoewoDeckView} from './demo-data';
import type {DaoewoStorage} from './runtime';

/** v1은 계정 구분이 없어 다른 사용자의 상태를 읽을 수 있으므로 마이그레이션하지 않고 폐기한다. */
export const DAOEWO_LEGACY_LEARNING_STATE_STORAGE_KEY =
  'daoewo:learning-state:v1';
const DAOEWO_LEARNING_STATE_STORAGE_PREFIX = 'daoewo:learning-state:v2';
/** v1은 계정 구분이 없어 다른 사용자의 설정을 읽을 수 있으므로 마이그레이션하지 않는다. */
export const DAOEWO_LEGACY_SETTINGS_STORAGE_KEY = 'daoewo:settings:v1';
const DAOEWO_SETTINGS_STORAGE_PREFIX = 'daoewo:settings:v2';

export type DaoewoSessionHistory = LearningSessionSnapshot;

export interface DaoewoLearningState {
  readonly version: 1;
  readonly progresses: readonly CardProgress[];
  readonly cardSnapshots: readonly DaoewoCardView[];
  readonly sessions: readonly DaoewoSessionHistory[];
}

export interface DaoewoSettingsState {
  readonly dailyReminder: boolean;
  readonly reviewReminder: boolean;
  readonly deckReadyNotification: boolean;
  readonly ttsEnabled: boolean;
  readonly voiceGuide: boolean;
}

export interface DaoewoLearningDataExport {
  readonly schema: 'daoewo-learning-data';
  readonly version: 1;
  readonly exportedAt: string;
  /** 카드 본문·계정 식별자 없이 학습 판정과 SRS 상태만 포함한다. */
  readonly progresses: readonly CardProgress[];
  readonly sessions: readonly DaoewoSessionHistory[];
}

export const EMPTY_LEARNING_STATE: DaoewoLearningState = Object.freeze({
  version: 1,
  progresses: [],
  cardSnapshots: [],
  sessions: [],
});

/** 알림 adapter가 없는 공통 UI에서는 알림 계열을 false로 fail-closed한다. */
export const DEFAULT_SETTINGS_STATE: DaoewoSettingsState = Object.freeze({
  dailyReminder: false,
  reviewReminder: false,
  deckReadyNotification: false,
  ttsEnabled: true,
  voiceGuide: false,
});

export interface DaoewoWeekDaySummary {
  readonly date: LocalDateKey;
  readonly label: string;
  readonly complete: boolean;
}

export interface DaoewoWeaknessTag {
  readonly label: string;
  readonly rate: number;
}

export interface DaoewoDashboardSummary {
  readonly streak: StudyStreak;
  readonly todayCompleted: number;
  readonly todayTarget: number;
  readonly dueCount: number;
  readonly memorizedCount: number;
  readonly learningCount: number;
  readonly memorizationRate: number;
  readonly week: readonly DaoewoWeekDaySummary[];
  readonly estimatedCompletionDate: LocalDateKey | null;
  readonly weaknessTags: readonly DaoewoWeaknessTag[];
}

export interface DaoewoCurrentSessionSummary {
  readonly target: number;
  readonly answered: number;
}

export interface DaoewoMistakeItem {
  readonly card: DaoewoCardView;
  readonly progress: CardProgress;
  readonly dueAt: string | null;
  readonly isDue: boolean;
}

export async function loadLearningState(
  storage: DaoewoStorage,
  ownerId: string,
): Promise<DaoewoLearningState> {
  const stored = await storage.getItem<unknown>(
    learningStateStorageKey(ownerId),
  );
  return parseLearningState(stored);
}

export async function saveLearningState(
  storage: DaoewoStorage,
  ownerId: string,
  state: DaoewoLearningState,
): Promise<void> {
  await storage.setItem(learningStateStorageKey(ownerId), state);
}

export async function removeLearningState(
  storage: DaoewoStorage,
  ownerId: string,
): Promise<void> {
  await storage.removeItem(learningStateStorageKey(ownerId));
}

export async function loadSettingsState(
  storage: DaoewoStorage,
  ownerId: string,
): Promise<DaoewoSettingsState> {
  return parseSettingsState(
    await storage.getItem<unknown>(settingsStorageKey(ownerId)),
  );
}

export async function saveSettingsState(
  storage: DaoewoStorage,
  ownerId: string,
  settings: DaoewoSettingsState,
): Promise<void> {
  await storage.setItem(settingsStorageKey(ownerId), settings);
}

export async function removeSettingsState(
  storage: DaoewoStorage,
  ownerId: string,
): Promise<void> {
  await storage.removeItem(settingsStorageKey(ownerId));
}

export function learningStateStorageKey(ownerId: string): string {
  const normalized = ownerId.trim();
  if (normalized.length === 0) {
    throw new Error('학습 기록 소유자 식별자가 필요해요.');
  }
  return `${DAOEWO_LEARNING_STATE_STORAGE_PREFIX}:${encodeURIComponent(normalized)}`;
}

export function settingsStorageKey(ownerId: string): string {
  const normalized = ownerId.trim();
  if (normalized.length === 0) {
    throw new Error('설정 소유자 식별자가 필요해요.');
  }
  return `${DAOEWO_SETTINGS_STORAGE_PREFIX}:${encodeURIComponent(normalized)}`;
}

export function createLearningDataExport(
  state: DaoewoLearningState,
  exportedAt: Date,
): DaoewoLearningDataExport {
  if (!Number.isFinite(exportedAt.getTime())) {
    throw new Error('내보내기 시각이 올바르지 않아요.');
  }

  return {
    schema: 'daoewo-learning-data',
    version: 1,
    exportedAt: exportedAt.toISOString(),
    progresses: [...state.progresses]
      .sort((left, right) =>
        cardKey(left.deckId, left.cardId).localeCompare(
          cardKey(right.deckId, right.cardId),
        ),
      )
      .map(progress => ({...progress})),
    sessions: [...state.sessions]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(session => ({...session})),
  };
}

export function serializeLearningDataExport(
  value: DaoewoLearningDataExport,
): string {
  return JSON.stringify(value, null, 2);
}

export function withProgressSnapshot(
  state: DaoewoLearningState,
  progress: CardProgress,
  card: DaoewoCardView,
  persistCardBody = true,
): DaoewoLearningState {
  const progressId = cardKey(progress.deckId, progress.cardId);
  const nextProgresses = state.progresses.filter(
    item => cardKey(item.deckId, item.cardId) !== progressId,
  );
  const nextSnapshots = state.cardSnapshots.filter(
    item => cardKey(item.deckId, item.id) !== progressId,
  );

  return {
    version: 1,
    progresses: [...nextProgresses, progress],
    cardSnapshots: persistCardBody
      ? [...nextSnapshots, {...card, tags: [...card.tags]}]
      : nextSnapshots,
    sessions: state.sessions,
  };
}

export function withCompletedSession(
  state: DaoewoLearningState,
  session: DaoewoSessionHistory,
): DaoewoLearningState {
  return {
    ...state,
    sessions: [
      ...state.sessions.filter(item => item.id !== session.id),
      session,
    ],
  };
}

/**
 * 게스트 상태를 기존 계정 상태와 합칠 때 사용하는 idempotent merge다.
 * 같은 항목은 더 최근 값을 선택하고 timestamp까지 같으면 canonical JSON 순서로
 * 결정하므로 입력 순서와 재시도 횟수에 관계없이 같은 결과를 만든다.
 */
export function mergeLearningStates(
  first: DaoewoLearningState,
  second: DaoewoLearningState,
): DaoewoLearningState {
  return {
    version: 1,
    progresses: mergeStateItems(
      first.progresses,
      second.progresses,
      item => cardKey(item.deckId, item.cardId),
      item => parseTimestamp(item.updatedAt) ?? Number.NEGATIVE_INFINITY,
    ),
    cardSnapshots: mergeStateItems(
      first.cardSnapshots,
      second.cardSnapshots,
      item => cardKey(item.deckId, item.id),
      () => 0,
    ).map(card => ({...card, tags: [...card.tags]})),
    sessions: mergeStateItems(
      first.sessions,
      second.sessions,
      item => item.id,
      item => parseTimestamp(item.completedAt) ?? Number.NEGATIVE_INFINITY,
    ),
  };
}

/** cloud payload에는 카드 본문이 없으며 Free 본문만 target adapter가 로컬에서 복원한다. */
export function mergeLearningStateFromSync(
  local: DaoewoLearningState,
  sync: LearningSyncSnapshot,
  freeCardSnapshots: readonly DaoewoCardView[],
): DaoewoLearningState {
  const freeDeckIds = new Set(
    sync.backup.freeDecks.map(deck => deck.deckId),
  );
  const freeProgresses = sync.backup.freeDecks.flatMap(deck =>
    deck.progresses.map(progress => progress.state),
  );
  const remoteProgresses = mergeCardProgresses(
    freeProgresses,
    sync.authoritativeProgresses,
  );
  const merged = mergeLearningStates(local, {
    version: 1,
    progresses: remoteProgresses,
    cardSnapshots: freeCardSnapshots,
    sessions: sync.backup.sessions,
  });
  const authoritativePro = new Map(
    sync.authoritativeProgresses
      .filter(progress => !freeDeckIds.has(progress.deckId))
      .map(progress => [cardKey(progress.deckId, progress.cardId), progress]),
  );
  const progresses = merged.progresses.map(progress =>
    authoritativePro.get(cardKey(progress.deckId, progress.cardId)) ?? progress,
  );
  for (const [key, progress] of authoritativePro) {
    if (!progresses.some(item => cardKey(item.deckId, item.cardId) === key)) {
      progresses.push(progress);
    }
  }
  const progressKeys = new Set(
    progresses.map(progress => cardKey(progress.deckId, progress.cardId)),
  );
  const snapshots = new Map(
    [...local.cardSnapshots, ...freeCardSnapshots]
      .filter(card => freeDeckIds.has(card.deckId))
      .filter(card => progressKeys.has(cardKey(card.deckId, card.id)))
      .map(card => [cardKey(card.deckId, card.id), card]),
  );

  return {
    version: 1,
    progresses,
    cardSnapshots: [...snapshots.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, card]) => ({...card, tags: [...card.tags]})),
    sessions: merged.sessions,
  };
}

export function deriveDashboardSummary(
  state: DaoewoLearningState,
  catalog: readonly DaoewoDeckView[],
  now: Date,
  currentSession?: DaoewoCurrentSessionSummary,
): DaoewoDashboardSummary {
  const today = toDateKey(now);
  const dayStates = buildHistoryDayStates(state.sessions);
  const completedDates = dayStates
    .filter(day => day.status === 'completed')
    .map(day => day.date);
  const streak = calculateStudyStreak(completedDates, today);
  const todayHistory = dayStates.find(day => day.date === today);
  const progressStatistics = calculateProgressStatistics(state.progresses, today);
  const dueCount = selectMistakeItems(state, now).filter(
    item => item.isDue,
  ).length;
  const memorizedCount = state.progresses.filter(
    progress => progress.status === 'known',
  ).length;
  const learningCount = state.progresses.filter(
    progress =>
      progress.status !== 'known' && progress.status !== 'suspended',
  ).length;

  return {
    streak,
    todayCompleted:
      (todayHistory?.completed ?? 0) + (currentSession?.answered ?? 0),
    todayTarget: (todayHistory?.target ?? 0) + (currentSession?.target ?? 0),
    dueCount,
    memorizedCount,
    learningCount,
    memorizationRate: progressStatistics.memorizationRate,
    week: buildWeekSummary(completedDates, today),
    estimatedCompletionDate: estimateCompletionDate(
      state,
      catalog,
      today,
    ),
    weaknessTags: calculateWeaknessTags(state),
  };
}

export function selectMistakeItems(
  state: DaoewoLearningState,
  now: Date,
): readonly DaoewoMistakeItem[] {
  const dueKeys = new Set(
    buildDueReviewQueue(state.progresses, now).map(item =>
      cardKey(item.deckId, item.cardId),
    ),
  );
  const snapshots = new Map(
    state.cardSnapshots.map(card => [cardKey(card.deckId, card.id), card]),
  );
  const nowMs = now.getTime();

  return state.progresses
    .flatMap(progress => {
      const key = cardKey(progress.deckId, progress.cardId);
      const card = snapshots.get(key);
      const isDue = dueKeys.has(key);
      const isMistake =
        progress.lastOutcome === 'unknown' || progress.lastOutcome === 'missed';
      if (card === undefined || (!isDue && !isMistake)) {
        return [];
      }
      return [{card, progress, dueAt: progress.nextReviewAt, isDue}];
    })
    .sort((left, right) => {
      if (left.isDue !== right.isDue) {
        return left.isDue ? -1 : 1;
      }
      const leftDue = parseTimestamp(left.dueAt) ?? Number.POSITIVE_INFINITY;
      const rightDue = parseTimestamp(right.dueAt) ?? Number.POSITIVE_INFINITY;
      if (leftDue !== rightDue) {
        return leftDue - rightDue;
      }
      return (
        (parseTimestamp(right.progress.updatedAt) ?? nowMs) -
        (parseTimestamp(left.progress.updatedAt) ?? nowMs)
      );
    });
}

export function parseSettingsState(value: unknown): DaoewoSettingsState {
  if (!isRecord(value)) {
    return DEFAULT_SETTINGS_STATE;
  }
  return {
    dailyReminder: booleanOrDefault(
      value.dailyReminder,
      DEFAULT_SETTINGS_STATE.dailyReminder,
    ),
    reviewReminder: booleanOrDefault(
      value.reviewReminder,
      DEFAULT_SETTINGS_STATE.reviewReminder,
    ),
    deckReadyNotification: booleanOrDefault(
      value.deckReadyNotification,
      DEFAULT_SETTINGS_STATE.deckReadyNotification,
    ),
    ttsEnabled: booleanOrDefault(
      value.ttsEnabled,
      DEFAULT_SETTINGS_STATE.ttsEnabled,
    ),
    voiceGuide: booleanOrDefault(
      value.voiceGuide,
      DEFAULT_SETTINGS_STATE.voiceGuide,
    ),
  };
}

function parseLearningState(value: unknown): DaoewoLearningState {
  if (!isRecord(value) || value.version !== 1) {
    return EMPTY_LEARNING_STATE;
  }

  const progresses = Array.isArray(value.progresses)
    ? value.progresses.filter(isCardProgress)
    : [];
  const cardSnapshots = Array.isArray(value.cardSnapshots)
    ? value.cardSnapshots.filter(isCardSnapshot)
    : [];
  const sessions = Array.isArray(value.sessions)
    ? value.sessions.filter(isSessionHistory)
    : [];

  return {version: 1, progresses, cardSnapshots, sessions};
}

function buildHistoryDayStates(
  sessions: readonly DaoewoSessionHistory[],
): CalendarDayState[] {
  const byDate = new Map<LocalDateKey, DaoewoSessionHistory[]>();
  for (const session of sessions) {
    const items = byDate.get(session.date) ?? [];
    byDate.set(session.date, [...items, session]);
  }

  return [...byDate.entries()].map(([date, items]) => {
    const totals = items.reduce(
      (result, session) => ({
        target: result.target + session.target,
        completed: result.completed + session.completed,
        known: result.known + session.known,
        unknown: result.unknown + session.unknown,
        reviewCount: result.reviewCount + session.reviewCount,
        elapsed: result.elapsed + session.elapsedMs,
      }),
      {target: 0, completed: 0, known: 0, unknown: 0, reviewCount: 0, elapsed: 0},
    );
    const classified = totals.known + totals.unknown;
    return {
      date,
      status:
        totals.target > 0 && totals.completed >= totals.target
          ? 'completed'
          : totals.completed > 0
            ? 'in-progress'
            : 'scheduled',
      ...totals,
      memorizationRate:
        classified === 0 ? 0 : Math.round((totals.known / classified) * 100),
    } satisfies CalendarDayState;
  });
}

function calculateProgressStatistics(
  progresses: readonly CardProgress[],
  today: LocalDateKey,
) {
  const known = progresses.reduce(
    (total, progress) => total + progress.knownCount,
    0,
  );
  const unknown = progresses.reduce(
    (total, progress) => total + progress.unknownCount,
    0,
  );
  const reviewCount = progresses.reduce(
    (total, progress) => total + progress.reviewCount,
    0,
  );
  const completed = known + unknown;
  return calculateStudyStatistics([
    {
      date: today,
      status: completed > 0 ? 'completed' : 'scheduled',
      target: completed,
      completed,
      memorizationRate: 0,
      elapsed: 0,
      known,
      unknown,
      reviewCount,
    },
  ]);
}

function buildWeekSummary(
  completedDates: readonly LocalDateKey[],
  today: LocalDateKey,
): DaoewoWeekDaySummary[] {
  const completed = new Set(completedDates);
  return Array.from({length: 7}, (_, index) => {
    const date = addDaysToDateKey(today, index - 6);
    return {
      date,
      label: koreanWeekday(date),
      complete: completed.has(date),
    };
  });
}

function estimateCompletionDate(
  state: DaoewoLearningState,
  catalog: readonly DaoewoDeckView[],
  today: LocalDateKey,
): LocalDateKey | null {
  const activeDecks = catalog.filter(
    deck =>
      deck.availability === 'published' &&
      deck.progress !== undefined &&
      deck.cardCount !== null,
  );
  const remainingCards = activeDecks.reduce((total, deck) => {
    if (deck.progress === undefined || deck.cardCount === null) {
      return total;
    }
    const progress = Math.max(0, Math.min(1, deck.progress));
    return total + Math.ceil(deck.cardCount * (1 - progress));
  }, 0);
  const completedByDate = new Map<LocalDateKey, number>();
  for (const session of state.sessions) {
    completedByDate.set(
      session.date,
      (completedByDate.get(session.date) ?? 0) + session.completed,
    );
  }
  const activeDays = [...completedByDate.values()].filter(count => count > 0);
  if (activeDecks.length === 0 || activeDays.length === 0) {
    return null;
  }
  const averageDaily =
    activeDays.reduce((total, count) => total + count, 0) / activeDays.length;
  return addDaysToDateKey(today, Math.ceil(remainingCards / averageDaily));
}

function calculateWeaknessTags(
  state: DaoewoLearningState,
): DaoewoWeaknessTag[] {
  const snapshots = new Map(
    state.cardSnapshots.map(card => [cardKey(card.deckId, card.id), card]),
  );
  const totals = new Map<string, {mistakes: number; attempts: number}>();

  for (const progress of state.progresses) {
    const card = snapshots.get(cardKey(progress.deckId, progress.cardId));
    if (card === undefined) {
      continue;
    }
    const mistakes =
      progress.unknownCount +
      (progress.lastOutcome === 'missed' ? 1 : 0) +
      (progress.lastOutcome === 'confused' ? 1 : 0);
    const attempts = Math.max(
      1,
      progress.knownCount + progress.unknownCount + progress.reviewCount,
    );
    if (mistakes === 0) {
      continue;
    }
    for (const tag of card.tags) {
      const current = totals.get(tag) ?? {mistakes: 0, attempts: 0};
      totals.set(tag, {
        mistakes: current.mistakes + mistakes,
        attempts: current.attempts + attempts,
      });
    }
  }

  return [...totals.entries()]
    .map(([label, value]) => ({
      label,
      rate: Math.min(100, Math.round((value.mistakes / value.attempts) * 100)),
    }))
    .sort((left, right) => right.rate - left.rate || left.label.localeCompare(right.label))
    .slice(0, 3);
}

function koreanWeekday(dateKey: LocalDateKey): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  return ['일', '월', '화', '수', '목', '금', '토'][date.getUTCDay()] ?? '';
}

function cardKey(deckId: string, cardId: string): string {
  return `${deckId}:${cardId}`;
}

function parseTimestamp(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeStateItems<T>(
  first: readonly T[],
  second: readonly T[],
  keyOf: (item: T) => string,
  rankOf: (item: T) => number,
): T[] {
  const merged = new Map<string, T>();
  for (const item of [...first, ...second]) {
    const key = keyOf(item);
    const current = merged.get(key);
    if (current === undefined || compareStateItems(current, item, rankOf) < 0) {
      merged.set(key, item);
    }
  }
  return [...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, item]) => item);
}

function compareStateItems<T>(
  left: T,
  right: T,
  rankOf: (item: T) => number,
): number {
  const rankDifference = rankOf(left) - rankOf(right);
  if (rankDifference !== 0) {
    return rankDifference;
  }
  return stableStringify(left).localeCompare(stableStringify(right));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCardProgress(value: unknown): value is CardProgress {
  return (
    isRecord(value) &&
    typeof value.cardId === 'string' &&
    typeof value.deckId === 'string' &&
    typeof value.status === 'string' &&
    typeof value.knownCount === 'number' &&
    typeof value.unknownCount === 'number' &&
    typeof value.reviewCount === 'number' &&
    typeof value.streak === 'number' &&
    (value.nextReviewAt === null || typeof value.nextReviewAt === 'string') &&
    typeof value.updatedAt === 'string'
  );
}

function isCardSnapshot(value: unknown): value is DaoewoCardView {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.deckId === 'string' &&
    typeof value.front === 'string' &&
    typeof value.back === 'string' &&
    typeof value.locale === 'string' &&
    Array.isArray(value.tags) &&
    value.tags.every(tag => typeof tag === 'string')
  );
}

function isSessionHistory(value: unknown): value is DaoewoSessionHistory {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.deckId === 'string' &&
    typeof value.date === 'string' &&
    isDateKey(value.date) &&
    isNonNegativeNumber(value.target) &&
    isNonNegativeNumber(value.completed) &&
    isNonNegativeNumber(value.known) &&
    isNonNegativeNumber(value.unknown) &&
    isNonNegativeNumber(value.reviewCount) &&
    isNonNegativeNumber(value.elapsedMs) &&
    typeof value.completedAt === 'string'
  );
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
