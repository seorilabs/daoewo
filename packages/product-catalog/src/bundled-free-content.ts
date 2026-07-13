import {
  buildDueReviewQueue,
  createStudyGoal,
  daysBetweenDateKeys,
  evaluateDeckActivation,
  getStudyGoalEndDate,
  isEntitled,
  mergeLearningBackupSnapshots,
  resolveDailyCardLimit,
  toDateKey,
  type CardProgress,
  type Entitlement,
  type FreeDeckLearningSnapshot,
  type LocalDateKey,
  type StudyGoal,
  type StudyGoalMode,
} from '@daoewo/product-core';

import { BUNDLED_FREE_DECK_CONTENT } from './bundled-free-content.generated.js';
import { PUBLIC_CATALOG } from './catalog.generated.js';
import type { PublishedCard, PublishedDeckContent } from './types.js';

const STORAGE_PREFIX = 'daoewo:bundled-free-content:v1';
const FREE_ENTITLEMENT: Entitlement = Object.freeze({
  plan: 'free',
  source: 'bundled-free-content',
  validUntil: null,
});

export { BUNDLED_FREE_DECK_CONTENT } from './bundled-free-content.generated.js';
export type {
  PublishedCard,
  PublishedCardMedia,
  PublishedDeckChunk,
  PublishedDeckContent,
} from './types.js';

export interface BundledFreeStorage {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface BundledFreeGoalInput {
  readonly deckId: string;
  readonly mode: StudyGoalMode;
  readonly value: number;
  readonly startDate: LocalDateKey;
}

export interface BundledFreeCardWindow {
  readonly id: string;
  readonly deckId: string;
  readonly goalKey: string;
  readonly cards: readonly PublishedCard[];
  readonly targetCount: number;
}

export interface BundledFreeProgressBatch {
  readonly deckId: string;
  readonly goalKey?: string;
  readonly windowId: string;
  readonly progresses: readonly CardProgress[];
}

export interface BundledFreeDeckSummary {
  readonly active: boolean;
  readonly progress: number;
  readonly daysLeft: number;
}

export interface BundledFreeContentAdapter {
  hasDeck(deckId: string): boolean;
  createGoal(input: BundledFreeGoalInput): Promise<StudyGoal>;
  getCardWindow(input: {
    readonly deckId: string;
    readonly goalKey?: string;
  }): Promise<BundledFreeCardWindow>;
  commitProgressBatch(batch: BundledFreeProgressBatch): Promise<void>;
  getDeckSummary(deckId: string): Promise<BundledFreeDeckSummary | null>;
  exportLearningBackup(
    ownerId?: string,
  ): Promise<readonly FreeDeckLearningSnapshot[]>;
  importLearningBackup(
    freeDecks: readonly FreeDeckLearningSnapshot[],
    ownerId?: string,
  ): Promise<void>;
  getCardsByIds(
    cards: readonly {readonly deckId: string; readonly cardId: string}[],
  ): Promise<readonly PublishedCard[]>;
  mergeOwnerState(sourceOwnerId: string, targetOwnerId: string): Promise<void>;
  removeOwnerState(ownerId: string): Promise<void>;
}

export interface CreateBundledFreeContentAdapterOptions {
  readonly storage: BundledFreeStorage;
  /** 매 호출 시 현재 계정을 다시 읽어 계정 전환 중 stale cache를 공유하지 않는다. */
  readonly getOwnerId: () => Promise<string | null>;
  readonly getEntitlement?: () => Promise<Entitlement>;
  readonly now?: () => Date;
  /** 테스트에서만 승인 완료 Free fixture를 주입한다. production 기본값은 generated bundle이다. */
  readonly content?: Readonly<Record<string, PublishedDeckContent>>;
}

interface StoredWindow {
  readonly id: string;
  readonly deckId: string;
  readonly goalKey: string;
  readonly date: LocalDateKey;
  readonly cardIds: readonly string[];
}

interface BundledFreeStateV1 {
  readonly version: 1;
  readonly activeDeckId: string | null;
  readonly goals: readonly StudyGoal[];
  readonly progresses: readonly CardProgress[];
  readonly windows: readonly StoredWindow[];
}

interface BundledFreeState {
  readonly version: 2;
  readonly activeDeckIds: readonly string[];
  readonly goals: readonly StudyGoal[];
  readonly progresses: readonly CardProgress[];
  readonly windows: readonly StoredWindow[];
}

const EMPTY_STATE: BundledFreeState = Object.freeze({
  version: 2,
  activeDeckIds: [],
  goals: [],
  progresses: [],
  windows: [],
});

/**
 * 앱에 번들된 Free 본문 전용 로컬 adapter다. Pro 본문/entitlement/server window는
 * 이 경계로 들어올 수 없다.
 */
export function createBundledFreeContentAdapter(
  options: CreateBundledFreeContentAdapterOptions,
): BundledFreeContentAdapter {
  const content = options.content ?? BUNDLED_FREE_DECK_CONTENT;
  const now = options.now ?? (() => new Date());
  const getEntitlement = options.getEntitlement ?? (async () => FREE_ENTITLEMENT);
  assertClientSafeContent(content);

  async function ownerContext(expectedOwnerId?: string): Promise<{
    readonly ownerId: string;
    readonly key: string;
    readonly state: BundledFreeState;
  }> {
    const ownerId = requireOwnerId(
      expectedOwnerId ?? await options.getOwnerId(),
    );
    const key = bundledFreeStorageKey(ownerId);
    const raw = await options.storage.getItem<unknown>(key);
    const state = parseState(raw);
    if (!isBundledFreeStateV2(raw)) {
      await options.storage.setItem(key, state);
    }
    return {
      ownerId,
      key,
      state,
    };
  }

  return {
    hasDeck(deckId) {
      return getContent(content, deckId) !== null;
    },
    async createGoal(input) {
      const deckContent = requireContent(content, input.deckId);
      assertPositiveInteger(input.value, 'value');
      const context = await ownerContext();
      const entitlement = await getEntitlement();
      const activation = evaluateDeckActivation({
        deck: {id: input.deckId, tier: 'free'},
        activeDeckIds: context.state.activeDeckIds,
        entitlement,
        now: now(),
      });
      if (!activation.allowed) {
        throw new Error('Free 플랜은 활성 덱을 1개만 사용할 수 있어요.');
      }

      const cardIds = flattenCards(deckContent).map(card => card.id);
      const dailyLimit = resolveDailyCardLimit(
        entitlement,
        cardIds.length,
        now(),
      );
      const value =
        input.mode === 'daily-count'
          ? Math.min(input.value, dailyLimit)
          : Math.max(input.value, Math.ceil(cardIds.length / dailyLimit));
      const goal = createStudyGoal({...input, cardIds, value});
      const nextState: BundledFreeState = {
        version: 2,
        activeDeckIds: isEntitled(entitlement, now())
          ? mergeUnique(context.state.activeDeckIds, [input.deckId])
          : [input.deckId],
        goals: [
          ...context.state.goals.filter(item => item.deckId !== input.deckId),
          goal,
        ],
        progresses: context.state.progresses,
        windows: context.state.windows.filter(
          item => item.deckId !== input.deckId,
        ),
      };
      await options.storage.setItem(context.key, nextState);
      return goal;
    },
    async getCardWindow(input) {
      const deckContent = requireContent(content, input.deckId);
      const context = await ownerContext();
      const goal = context.state.goals.find(
        item =>
          item.deckId === input.deckId &&
          (input.goalKey === undefined || item.key === input.goalKey),
      );
      if (
        goal === undefined ||
        !context.state.activeDeckIds.includes(input.deckId)
      ) {
        throw new Error('활성화된 Free 학습 목표를 찾을 수 없어요.');
      }

      const current = now();
      const entitlement = await getEntitlement();
      const date = toDateKey(current);
      const dueIds = buildDueReviewQueue(
        context.state.progresses.filter(item => item.deckId === input.deckId),
        current,
      ).map(item => item.cardId);
      const progressedIds = new Set(
        context.state.progresses
          .filter(item => item.deckId === input.deckId)
          .map(item => item.cardId),
      );
      // due 카드가 60장 한도를 차지해 당일 신규 카드가 밀려도 다음 날 backlog로 회수한다.
      const assignedIds = Object.entries(goal.assignments)
        .filter(([assignmentDate]) => assignmentDate <= date)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([, cardIds]) => cardIds)
        .filter(cardId => !progressedIds.has(cardId));
      const candidateIds = [...new Set([...dueIds, ...assignedIds])];
      const limit = resolveDailyCardLimit(
        entitlement,
        candidateIds.length,
        current,
      );
      const cardsById = new Map(
        flattenCards(deckContent).map(card => [card.id, card] as const),
      );
      const cards = candidateIds
        .slice(0, limit)
        .map(cardId => cardsById.get(cardId))
        .filter((card): card is PublishedCard => card !== undefined);
      const window: StoredWindow = {
        id: `bundled-free:${input.deckId}:${date}`,
        deckId: input.deckId,
        goalKey: goal.key,
        date,
        cardIds: cards.map(card => card.id),
      };
      await options.storage.setItem(context.key, {
        ...context.state,
        windows: [
          ...context.state.windows.filter(
            item => !(item.deckId === input.deckId && item.date === date),
          ),
          window,
        ],
      } satisfies BundledFreeState);
      return {...window, cards, targetCount: cards.length};
    },
    async commitProgressBatch(batch) {
      const deckContent = requireContent(content, batch.deckId);
      const context = await ownerContext();
      const window = context.state.windows.find(
        item => item.id === batch.windowId && item.deckId === batch.deckId,
      );
      if (window === undefined) {
        throw new Error('Free 학습 창을 찾을 수 없어요.');
      }
      if (batch.goalKey !== undefined && batch.goalKey !== window.goalKey) {
        throw new Error('Free 학습 목표와 학습 창이 일치하지 않아요.');
      }
      const knownCardIds = new Set(flattenCards(deckContent).map(card => card.id));
      const windowCardIds = new Set(window.cardIds);
      const progressIds = batch.progresses.map(progress => progress.cardId);
      if (
        batch.progresses.some(
          progress =>
            progress.deckId !== batch.deckId ||
            !knownCardIds.has(progress.cardId) ||
            !windowCardIds.has(progress.cardId),
        ) ||
        new Set(progressIds).size !== progressIds.length
      ) {
        throw new Error('Free 학습 창 밖의 진도는 저장할 수 없어요.');
      }
      const accepted = batch.progresses;
      const replacementKeys = new Set(
        accepted.map(progress => `${progress.deckId}:${progress.cardId}`),
      );
      const progresses = [
        ...context.state.progresses.filter(
          progress =>
            !replacementKeys.has(`${progress.deckId}:${progress.cardId}`),
        ),
        ...accepted,
      ];
      await options.storage.setItem(context.key, {
        ...context.state,
        progresses,
      } satisfies BundledFreeState);
    },
    async getDeckSummary(deckId) {
      requireContent(content, deckId);
      const context = await ownerContext();
      const goal = context.state.goals.find(item => item.deckId === deckId);
      if (goal === undefined) {
        return null;
      }
      const completed = new Set(
        context.state.progresses
          .filter(item => item.deckId === deckId && item.firstSeenAt !== null)
          .map(item => item.cardId),
      ).size;
      const endDate = getStudyGoalEndDate(goal);
      return {
        active: context.state.activeDeckIds.includes(deckId),
        progress:
          goal.totalCount === 0
            ? 0
            : Math.min(1, completed / goal.totalCount),
        daysLeft: Math.max(0, daysBetweenDateKeys(toDateKey(now()), endDate) + 1),
      };
    },
    async exportLearningBackup(ownerId) {
      const context = await ownerContext(ownerId);
      return stateToFreeDecks(context.state, content);
    },
    async importLearningBackup(freeDecks, ownerId) {
      const context = await ownerContext(ownerId);
      validateFreeDeckSnapshots(freeDecks, content);
      const entitlement = await getEntitlement();
      const merged = mergeLearningBackupSnapshots(
        {
          version: 1,
          freeDecks: stateToFreeDecks(context.state, content),
          sessions: [],
        },
        {version: 1, freeDecks, sessions: []},
        isEntitled(entitlement, now()),
      );
      await options.storage.setItem(
        context.key,
        freeDecksToState(merged.freeDecks, context.state.windows),
      );
    },
    async getCardsByIds(cards) {
      return cards.flatMap(({deckId, cardId}) => {
        const deck = getContent(content, deckId);
        if (deck === null) return [];
        const card = flattenCards(deck).find(item => item.id === cardId);
        return card === undefined ? [] : [card];
      });
    },
    async mergeOwnerState(sourceOwnerId, targetOwnerId) {
      const sourceKey = bundledFreeStorageKey(sourceOwnerId);
      const targetKey = bundledFreeStorageKey(targetOwnerId);
      if (sourceKey === targetKey) {
        return;
      }
      const [source, target] = await Promise.all([
        options.storage.getItem<unknown>(sourceKey).then(parseState),
        options.storage.getItem<unknown>(targetKey).then(parseState),
      ]);
      const entitlement = await getEntitlement();
      const mergedBackup = mergeLearningBackupSnapshots(
        {version: 1, freeDecks: stateToFreeDecks(source, content), sessions: []},
        {version: 1, freeDecks: stateToFreeDecks(target, content), sessions: []},
        isEntitled(entitlement, now()),
      );
      const merged = freeDecksToState(mergedBackup.freeDecks, target.windows);
      await options.storage.setItem(targetKey, merged);
      await options.storage.removeItem(sourceKey);
    },
    async removeOwnerState(ownerId) {
      await options.storage.removeItem(bundledFreeStorageKey(ownerId));
    },
  };
}

export function getBundledFreeDeckContent(
  deckId: string,
): PublishedDeckContent | null {
  return getContent(BUNDLED_FREE_DECK_CONTENT, deckId);
}

export function bundledFreeStorageKey(ownerId: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(requireOwnerId(ownerId))}`;
}

function requireOwnerId(ownerId: string | null): string {
  const normalized = ownerId?.trim() ?? '';
  if (normalized.length === 0) {
    throw new Error('Free 학습 기록 소유자 식별자가 필요해요.');
  }
  return normalized;
}

function getContent(
  content: Readonly<Record<string, PublishedDeckContent>>,
  deckId: string,
): PublishedDeckContent | null {
  const normalized = deckId.trim();
  return normalized.length === 0 ? null : content[normalized] ?? null;
}

function requireContent(
  content: Readonly<Record<string, PublishedDeckContent>>,
  deckId: string,
): PublishedDeckContent {
  const found = getContent(content, deckId);
  if (found === null) {
    throw new Error('승인된 Free 덱 본문이 아직 준비되지 않았어요.');
  }
  return found;
}

function flattenCards(content: PublishedDeckContent): readonly PublishedCard[] {
  return content.chunks.flatMap(chunk => chunk.cards);
}

function assertClientSafeContent(
  content: Readonly<Record<string, PublishedDeckContent>>,
): void {
  const tierByDeckId = new Map<string, 'free' | 'pro'>(
    PUBLIC_CATALOG.decks.map(deck => [deck.id, deck.tier] as const),
  );
  for (const [deckId, deckContent] of Object.entries(content)) {
    if (tierByDeckId.get(deckId) !== 'free') {
      throw new Error(`client-safe bundle에는 Free 덱만 포함할 수 있어요: ${deckId}`);
    }
    const cards = flattenCards(deckContent);
    if (
      deckContent.deckId !== deckId ||
      cards.length !== deckContent.cardCount ||
      cards.some(
        (card, index) => card.deckId !== deckId || card.index !== index,
      ) ||
      new Set(cards.map(card => card.id)).size !== cards.length
    ) {
      throw new Error(`client-safe Free 덱 본문이 검증 결과와 다릅니다: ${deckId}`);
    }
  }
}

function parseState(value: unknown): BundledFreeState {
  if (isBundledFreeStateV2(value)) {
    return value;
  }
  if (isBundledFreeStateV1(value)) {
    return {
      version: 2,
      activeDeckIds:
        value.activeDeckId === null ? [] : [value.activeDeckId],
      goals: value.goals,
      progresses: value.progresses,
      windows: value.windows,
    };
  }
  return EMPTY_STATE;
}

function isBundledFreeStateV1(value: unknown): value is BundledFreeStateV1 {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as {version?: unknown}).version !== 1 ||
    !Array.isArray((value as {goals?: unknown}).goals) ||
    !Array.isArray((value as {progresses?: unknown}).progresses) ||
    !Array.isArray((value as {windows?: unknown}).windows)
  ) {
    return false;
  }
  const state = value as BundledFreeStateV1;
  if (state.activeDeckId !== null && typeof state.activeDeckId !== 'string') {
    return false;
  }
  return true;
}

function isBundledFreeStateV2(value: unknown): value is BundledFreeState {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as {version?: unknown}).version === 2 &&
    Array.isArray((value as {activeDeckIds?: unknown}).activeDeckIds) &&
    (value as {activeDeckIds: unknown[]}).activeDeckIds.every(
      item => typeof item === 'string',
    ) &&
    Array.isArray((value as {goals?: unknown}).goals) &&
    Array.isArray((value as {progresses?: unknown}).progresses) &&
    Array.isArray((value as {windows?: unknown}).windows)
  );
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer`);
  }
}

function stateToFreeDecks(
  state: BundledFreeState,
  content: Readonly<Record<string, PublishedDeckContent>>,
): readonly FreeDeckLearningSnapshot[] {
  const deckIds = new Set([
    ...state.activeDeckIds,
    ...state.goals.map(goal => goal.deckId),
    ...state.progresses.map(progress => progress.deckId),
  ]);
  return [...deckIds]
    .sort()
    .flatMap(deckId => {
      const deck = getContent(content, deckId);
      if (deck === null) return [];
      const indexById = new Map(
        flattenCards(deck).map(card => [card.id, card.index] as const),
      );
      return [{
        deckId,
        deckVersion: deck.version,
        active: state.activeDeckIds.includes(deckId),
        goal: state.goals.find(goal => goal.deckId === deckId) ?? null,
        progresses: state.progresses
          .filter(progress => progress.deckId === deckId)
          .flatMap(progress => {
            const cardIndex = indexById.get(progress.cardId);
            return cardIndex === undefined ? [] : [{cardIndex, state: progress}];
          }),
      }];
    });
}

function freeDecksToState(
  freeDecks: readonly FreeDeckLearningSnapshot[],
  windows: readonly StoredWindow[],
): BundledFreeState {
  const goals = freeDecks.flatMap(deck =>
    deck.goal === null ? [] : [deck.goal],
  );
  const goalKeys = new Set(goals.map(goal => goal.key));
  return {
    version: 2,
    activeDeckIds: freeDecks
      .filter(deck => deck.active)
      .map(deck => deck.deckId),
    goals,
    progresses: freeDecks.flatMap(deck =>
      deck.progresses.map(progress => progress.state),
    ),
    windows: windows.filter(window => goalKeys.has(window.goalKey)),
  };
}

function validateFreeDeckSnapshots(
  freeDecks: readonly FreeDeckLearningSnapshot[],
  content: Readonly<Record<string, PublishedDeckContent>>,
): void {
  const seen = new Set<string>();
  for (const snapshot of freeDecks) {
    if (seen.has(snapshot.deckId)) {
      throw new Error('Free sync snapshot에 중복 덱이 있어요.');
    }
    seen.add(snapshot.deckId);
    const deck = requireContent(content, snapshot.deckId);
    if (deck.version !== snapshot.deckVersion) {
      throw new Error('Free sync snapshot의 덱 버전이 현재 bundle과 달라요.');
    }
    if (snapshot.goal !== null && snapshot.goal.deckId !== snapshot.deckId) {
      throw new Error('Free sync snapshot의 목표 덱이 일치하지 않아요.');
    }
    const cards = flattenCards(deck);
    for (const progress of snapshot.progresses) {
      const card = cards[progress.cardIndex];
      if (
        card === undefined ||
        card.id !== progress.state.cardId ||
        progress.state.deckId !== snapshot.deckId
      ) {
        throw new Error('Free sync snapshot의 카드 index와 진도가 일치하지 않아요.');
      }
    }
  }
}

function mergeUnique(
  first: readonly string[],
  second: readonly string[],
): readonly string[] {
  return [...new Set([...first, ...second])];
}
