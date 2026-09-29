import {createStudyGoal, toDateKey, type StudyGoal} from '@daoewo/product-core';
import {
  createDemoRuntime,
  createNoopDaoewoSyncPort,
  createUnsupportedDaoewoDeckReadyNotifications,
  createUnsupportedDaoewoNotifications,
  type DaoewoCardView,
  type DaoewoContentPort,
  type DaoewoDeckCategory,
  type DaoewoDeckView,
  type DaoewoEntitlementState,
  type DaoewoRuntime,
  type DaoewoUser,
} from '@daoewo/product-ui';

export interface MobileContentPreviewCard {
  readonly id: string;
  readonly deckId: string;
  readonly front: string;
  readonly back: string;
  readonly hint?: string;
  readonly reading?: string;
  readonly example?: string;
  readonly exampleMeaning?: string;
  readonly tags: readonly string[];
  readonly difficulty: number;
  readonly locale: string;
}

export interface MobileContentPreviewDeck {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category:
    | 'language'
    | 'certification'
    | 'career'
    | 'general-knowledge'
    | 'k12-secondary';
  readonly categoryLabel: DaoewoDeckCategory;
  readonly locale: string;
  readonly contentLanguage: 'ko' | 'en' | 'ja';
  readonly tier: 'free' | 'pro';
  readonly source: 'official' | 'ai-batch';
  readonly priority: 'P1' | 'P2' | 'P3';
  readonly version: number;
  readonly tags: readonly string[];
  readonly workflowState: 'awaiting-human-approval';
  readonly reviewStatus: 'pending';
  readonly cards: readonly MobileContentPreviewCard[];
}

export interface MobileContentPreviewArtifact {
  readonly schemaVersion: 1;
  readonly kind: 'daoewo-mobile-content-preview';
  readonly generatedAt: string;
  readonly notice: 'DEV · 미승인 콘텐츠 · 외부 전송 금지';
  readonly sourceRecords: readonly {
    readonly file: string;
    readonly digest: string;
  }[];
  readonly decks: readonly MobileContentPreviewDeck[];
}

const PREVIEW_USER: DaoewoUser = Object.freeze({
  id: 'dev-content-preview',
  displayName: 'DEV Preview',
  isGuest: false,
});

const PREVIEW_ENTITLEMENT: DaoewoEntitlementState = Object.freeze({
  plan: 'pro',
  source: 'dev-content-preview',
  validUntil: null,
});

const DISABLED_ERROR = 'DEV_CONTENT_PREVIEW_EXTERNAL_CAPABILITY_DISABLED';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function assertMobileContentPreviewArtifact(
  artifact: MobileContentPreviewArtifact,
): void {
  if (
    artifact?.schemaVersion !== 1 ||
    artifact.kind !== 'daoewo-mobile-content-preview' ||
    artifact.notice !== 'DEV · 미승인 콘텐츠 · 외부 전송 금지' ||
    !Number.isFinite(Date.parse(artifact.generatedAt)) ||
    !Array.isArray(artifact.decks) ||
    artifact.decks.length === 0
  ) {
    throw new Error('DEV_CONTENT_PREVIEW_ARTIFACT_INVALID');
  }

  const deckIds = new Set<string>();
  for (const deck of artifact.decks) {
    if (
      !isNonEmptyString(deck.id) ||
      deckIds.has(deck.id) ||
      deck.workflowState !== 'awaiting-human-approval' ||
      deck.reviewStatus !== 'pending' ||
      !['official', 'ai-batch'].includes(deck.source) ||
      !Array.isArray(deck.cards) ||
      deck.cards.length === 0
    ) {
      throw new Error('DEV_CONTENT_PREVIEW_DECK_INVALID');
    }
    deckIds.add(deck.id);

    const cardIds = new Set<string>();
    for (const card of deck.cards) {
      if (
        !isNonEmptyString(card.id) ||
        cardIds.has(card.id) ||
        card.deckId !== deck.id ||
        !isNonEmptyString(card.front) ||
        !isNonEmptyString(card.back) ||
        !Array.isArray(card.tags)
      ) {
        throw new Error('DEV_CONTENT_PREVIEW_CARD_INVALID');
      }
      cardIds.add(card.id);
    }
  }
}

function mapDeck(deck: MobileContentPreviewDeck): DaoewoDeckView {
  return {
    id: deck.id,
    title: deck.title,
    subtitle: deck.description,
    category: deck.categoryLabel,
    locale: deck.locale,
    tier: deck.tier,
    source: deck.source,
    // Preview 안에서만 선택 가능하게 표현하며 승인 상태는 상단 배너로 고정 표시한다.
    availability: 'published',
    cardCount: deck.cards.length,
    tags: [...deck.tags],
    isNew: deck.priority === 'P1',
  };
}

function mapCard(card: MobileContentPreviewCard): DaoewoCardView {
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
    tags: [...card.tags],
    locale: card.locale,
  };
}

function createPreviewContentPort(
  artifact: MobileContentPreviewArtifact,
  now: () => Date,
): DaoewoContentPort {
  const previewDecks = new Map(
    artifact.decks.map(deck => [deck.id, deck] as const),
  );
  const goalsByKey = new Map<string, StudyGoal>();
  const latestGoalByDeck = new Map<string, StudyGoal>();

  return {
    async listCatalog() {
      return artifact.decks.map(mapDeck);
    },
    async getDeck(deckId) {
      const deck = previewDecks.get(deckId);
      return deck === undefined ? null : mapDeck(deck);
    },
    async createGoal(input) {
      const deck = previewDecks.get(input.deckId);
      if (deck === undefined) {
        throw new Error('DEV_CONTENT_PREVIEW_DECK_NOT_FOUND');
      }
      const goal = createStudyGoal({
        ...input,
        key: `dev-preview:${deck.id}:${input.startDate}:${input.mode}:${input.value}`,
        cardIds: deck.cards.map(card => card.id),
      });
      goalsByKey.set(goal.key, goal);
      latestGoalByDeck.set(deck.id, goal);
      return goal;
    },
    async getCardWindow(input) {
      const deck = previewDecks.get(input.deckId);
      if (deck === undefined) {
        throw new Error('DEV_CONTENT_PREVIEW_DECK_NOT_FOUND');
      }
      const goal =
        input.goalKey === undefined
          ? latestGoalByDeck.get(input.deckId)
          : goalsByKey.get(input.goalKey);
      if (input.goalKey !== undefined && goal === undefined) {
        throw new Error('DEV_CONTENT_PREVIEW_GOAL_NOT_FOUND');
      }
      const assignedIds = goal?.assignments[toDateKey(now())] ?? [];
      const selectedIds =
        assignedIds.length === 0
          ? new Set(deck.cards.map(card => card.id))
          : new Set(assignedIds);
      const cards = deck.cards
        .filter(card => selectedIds.has(card.id))
        .map(mapCard);
      return {
        id: `dev-preview-window:${deck.id}:${toDateKey(now())}`,
        deckId: deck.id,
        ...(goal === undefined ? {} : {goalKey: goal.key}),
        cards,
        targetCount: cards.length,
      };
    },
    async commitProgressBatch() {
      // UI의 메모리 상태만 사용하며 서버나 .work 레코드를 변경하지 않는다.
    },
    async submitDeckRequest() {
      throw new Error(DISABLED_ERROR);
    },
  };
}

export function createMobileContentPreviewRuntime(
  artifact: MobileContentPreviewArtifact,
  options: {readonly now?: () => Date} = {},
): DaoewoRuntime {
  assertMobileContentPreviewArtifact(artifact);
  const now = options.now ?? (() => new Date());
  const base = createDemoRuntime({
    initialUser: PREVIEW_USER,
    initialEntitlement: PREVIEW_ENTITLEMENT,
    now,
  });

  return {
    ...base,
    analytics: {
      async track() {
        // DEV Preview에서 Analytics 외부 전송을 명시적으로 비활성화한다.
      },
    },
    auth: {
      async getCurrentUser() {
        return PREVIEW_USER;
      },
      async continueAsGuest() {
        throw new Error(DISABLED_ERROR);
      },
      async signIn() {
        throw new Error(DISABLED_ERROR);
      },
      async signOut() {
        throw new Error(DISABLED_ERROR);
      },
      async deleteAccount() {
        throw new Error(DISABLED_ERROR);
      },
    },
    purchase: {
      async getEntitlement() {
        return PREVIEW_ENTITLEMENT;
      },
      async purchase() {
        throw new Error(DISABLED_ERROR);
      },
      async restore() {
        throw new Error(DISABLED_ERROR);
      },
    },
    sharing: {
      availability: 'unsupported',
      async shareText() {
        throw new Error(DISABLED_ERROR);
      },
    },
    notifications: createUnsupportedDaoewoNotifications(),
    deckReadyNotifications: createUnsupportedDaoewoDeckReadyNotifications(),
    content: createPreviewContentPort(artifact, now),
    sync: createNoopDaoewoSyncPort(),
    now,
  };
}
