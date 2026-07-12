import type {
  CardProgress,
  DeckSource,
  DeckTier,
  Entitlement,
  LocalDateKey,
  StudyGoal,
  StudyGoalMode,
} from '@daoewo/product-core';
import {
  createStudyGoal,
  hasActiveProEntitlement,
  toDateKey,
} from '@daoewo/product-core';

import {
  DEMO_CARDS,
  DEMO_DECKS,
  type DaoewoCardView,
  type DaoewoDeckView,
} from './demo-data';
import type {SubscriptionPlan} from './navigation';

export type DaoewoAuthProvider = 'google' | 'apple' | 'toss';

export interface DaoewoAuthOption {
  readonly provider: DaoewoAuthProvider;
  readonly label: string;
}

export const MOBILE_AUTH_OPTIONS: readonly DaoewoAuthOption[] = [
  {provider: 'google', label: 'Google로 계속하기'},
  {provider: 'apple', label: 'Apple로 계속하기'},
] as const;

export const APPS_IN_TOSS_AUTH_OPTIONS: readonly DaoewoAuthOption[] = [
  {provider: 'toss', label: '토스로 계속하기'},
] as const;

export interface DaoewoUser {
  readonly id: string;
  readonly displayName: string;
  readonly email?: string;
  readonly isGuest: boolean;
}

export interface DaoewoEntitlementState extends Entitlement {
  readonly billingPlan?: SubscriptionPlan;
}

export type DaoewoAnalyticsValue = string | number | boolean | null;

export type DaoewoPaywallTrigger =
  | 'premium-deck'
  | 'active-deck-limit'
  | 'advanced-statistics'
  | 'weakness-review'
  | 'subscription-settings'
  | 'home-promo'
  | 'unknown';

export type DaoewoShareType = 'study-result' | 'weekly-progress';

export interface DaoewoAnalyticsEventMap {
  readonly memo_deck_open: {
    readonly deck_id: string;
    readonly tier: DeckTier;
    readonly source: DeckSource;
  };
  readonly memo_goal_set: {
    readonly mode: StudyGoalMode;
    readonly days: number;
    readonly daily_count: number;
  };
  readonly memo_session_start: {
    readonly deck_id: string;
    readonly target_count: number;
  };
  readonly memo_session_complete: {
    readonly known: number;
    readonly unknown: number;
    readonly elapsed_ms: number;
  };
  readonly memo_review_outcome: {
    readonly outcome: 'easy' | 'confused' | 'missed';
  };
  readonly memo_catalog_browse: {
    readonly category: string;
  };
  readonly memo_premium_deck_tap: {
    readonly deck_id: string;
  };
  readonly memo_deck_request: {
    readonly category: string;
    readonly locale: string;
  };
  readonly memo_paywall_view: {
    readonly trigger: DaoewoPaywallTrigger;
  };
  readonly memo_subscribe: {
    readonly plan: SubscriptionPlan;
    readonly trial: boolean;
  };
  readonly memo_streak_extend: {
    readonly streak_days: number;
  };
  readonly memo_share: {
    readonly type: DaoewoShareType;
  };
}

export type DaoewoAnalyticsEventName = keyof DaoewoAnalyticsEventMap;

export const DAOEWO_ANALYTICS_PARAMETER_KEYS = {
  memo_deck_open: ['deck_id', 'tier', 'source'],
  memo_goal_set: ['mode', 'days', 'daily_count'],
  memo_session_start: ['deck_id', 'target_count'],
  memo_session_complete: ['known', 'unknown', 'elapsed_ms'],
  memo_review_outcome: ['outcome'],
  memo_catalog_browse: ['category'],
  memo_premium_deck_tap: ['deck_id'],
  memo_deck_request: ['category', 'locale'],
  memo_paywall_view: ['trigger'],
  memo_subscribe: ['plan', 'trial'],
  memo_streak_extend: ['streak_days'],
  memo_share: ['type'],
} as const satisfies {
  readonly [Event in DaoewoAnalyticsEventName]: readonly (
    keyof DaoewoAnalyticsEventMap[Event]
  )[];
};

export interface DaoewoAnalytics {
  track<Event extends DaoewoAnalyticsEventName>(
    event: Event,
    properties: DaoewoAnalyticsEventMap[Event],
  ): Promise<void>;
}

/** 기획서에 없는 키(UID, topic, note 등)를 adapter로 전달하지 않는다. */
export async function trackDaoewoEvent<Event extends DaoewoAnalyticsEventName>(
  analytics: DaoewoAnalytics,
  event: Event,
  properties: DaoewoAnalyticsEventMap[Event],
): Promise<void> {
  const allowedKeys = DAOEWO_ANALYTICS_PARAMETER_KEYS[event] as readonly string[];
  const input = properties as Readonly<Record<string, DaoewoAnalyticsValue>>;
  const safeProperties: Record<string, DaoewoAnalyticsValue> = {};

  for (const key of allowedKeys) {
    const value = input[key];
    if (value !== undefined) {
      safeProperties[key] = value;
    }
  }

  await analytics.track(
    event,
    safeProperties as unknown as DaoewoAnalyticsEventMap[Event],
  );
}

export interface DaoewoStorage {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface DaoewoAuth {
  getCurrentUser(): Promise<DaoewoUser | null>;
  continueAsGuest(): Promise<DaoewoUser>;
  signIn(provider: DaoewoAuthProvider): Promise<DaoewoUser>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
}

export interface DaoewoPurchase {
  /** 스토어가 반환한 현지화 가격·체험 정보가 있을 때만 구매 UI에 노출한다. */
  getOffers?(): Promise<readonly DaoewoPurchaseOffer[]>;
  getEntitlement(): Promise<DaoewoEntitlementState>;
  purchase(plan: SubscriptionPlan): Promise<DaoewoEntitlementState>;
  restore(): Promise<DaoewoEntitlementState>;
}

export interface DaoewoPurchaseOffer {
  readonly plan: SubscriptionPlan;
  readonly displayPrice: string;
  readonly periodLabel: string;
  readonly description?: string;
  readonly trialDays?: number;
}

export interface DaoewoExternalLinks {
  readonly termsUrl?: string;
  readonly privacyUrl?: string;
  open(url: string): Promise<void>;
}

export interface DaoewoTts {
  speak(text: string, locale?: string): Promise<void>;
  stop(): Promise<void>;
}

export interface DaoewoCardWindow {
  readonly id: string;
  readonly deckId: string;
  readonly goalKey?: string;
  readonly cards: readonly DaoewoCardView[];
  readonly targetCount: number;
  readonly expiresAt?: string;
}

export interface DaoewoCreateGoalInput {
  readonly deckId: string;
  readonly mode: StudyGoalMode;
  readonly value: number;
  readonly startDate: LocalDateKey;
}

export interface DaoewoProgressBatch {
  readonly deckId: string;
  readonly goalKey?: string;
  readonly windowId: string;
  readonly progresses: readonly CardProgress[];
}

export interface DaoewoDeckRequestInput {
  readonly topic: string;
  readonly category: string;
  readonly locale: string;
  readonly note?: string;
}

/**
 * 카탈로그 메타와 카드 본문 전달을 분리한다. target adapter는 Pro 본문을 전체 fetch하지
 * 않고 서버가 승인한 오늘 window만 반환해야 한다.
 */
export interface DaoewoContentPort {
  listCatalog(): Promise<readonly DaoewoDeckView[]>;
  getDeck(deckId: string): Promise<DaoewoDeckView | null>;
  createGoal(input: DaoewoCreateGoalInput): Promise<StudyGoal>;
  getCardWindow(input: {
    readonly deckId: string;
    readonly goalKey?: string;
  }): Promise<DaoewoCardWindow>;
  commitProgressBatch(batch: DaoewoProgressBatch): Promise<void>;
  submitDeckRequest(request: DaoewoDeckRequestInput): Promise<void>;
}

export interface DaoewoRuntime {
  readonly analytics: DaoewoAnalytics;
  readonly storage: DaoewoStorage;
  readonly auth: DaoewoAuth;
  readonly purchase: DaoewoPurchase;
  readonly tts: DaoewoTts;
  readonly content: DaoewoContentPort;
  readonly externalLinks?: DaoewoExternalLinks;
  readonly now: () => Date;
}

export interface DemoRuntimeOptions {
  readonly initialUser?: DaoewoUser | null;
  readonly initialEntitlement?: DaoewoEntitlementState;
  readonly now?: () => Date;
}

const DEMO_GUEST: DaoewoUser = {
  id: 'demo-guest',
  displayName: '게스트',
  isGuest: true,
};

const DEMO_FREE: DaoewoEntitlementState = {
  plan: 'free',
  source: 'demo',
  validUntil: null,
};

/**
 * 네트워크, 결제 SDK, 기기 저장소를 호출하지 않는 안전한 메모리 런타임이다.
 * 제품 UI를 Storybook, 테스트, 초기 앱 조립에서 바로 확인할 때 사용한다.
 */
export function createDemoRuntime(
  options: DemoRuntimeOptions = {},
): DaoewoRuntime {
  const values = new Map<string, unknown>();
  let user = options.initialUser === undefined ? null : options.initialUser;
  let entitlement = options.initialEntitlement ?? DEMO_FREE;
  const clock = options.now ?? (() => new Date());

  return {
    analytics: {
      async track() {
        // Demo runtime intentionally keeps analytics local and silent.
      },
    },
    storage: {
      async getItem<T>(key: string) {
        return values.has(key) ? (values.get(key) as T) : null;
      },
      async setItem<T>(key: string, value: T) {
        values.set(key, value);
      },
      async removeItem(key: string) {
        values.delete(key);
      },
    },
    auth: {
      async getCurrentUser() {
        return user;
      },
      async continueAsGuest() {
        user = DEMO_GUEST;
        return user;
      },
      async signIn(provider: DaoewoAuthProvider) {
        user = {
          id: `demo-${provider}`,
          displayName: '다외워 사용자',
          email:
            provider === 'google'
              ? 'hello@example.com'
              : provider === 'apple'
                ? 'apple@example.com'
                : 'toss@example.com',
          isGuest: false,
        };
        return user;
      },
      async signOut() {
        user = null;
      },
      async deleteAccount() {
        user = null;
        entitlement = DEMO_FREE;
        values.clear();
      },
    },
    purchase: {
      async getEntitlement() {
        return entitlement;
      },
      async purchase(plan: SubscriptionPlan) {
        entitlement = {
          plan: 'pro',
          source: 'demo',
          billingPlan: plan,
          validUntil: '2099-12-31T23:59:59.000Z',
        };
        return entitlement;
      },
      async restore() {
        return entitlement;
      },
    },
    tts: {
      async speak() {
        // No-op by design. A target wrapper may inject a native TTS adapter.
      },
      async stop() {
        // No-op by design.
      },
    },
    content: {
      async listCatalog() {
        return DEMO_DECKS.map(deck => ({...deck, tags: [...deck.tags]}));
      },
      async getDeck(deckId: string) {
        const deck = DEMO_DECKS.find(item => item.id === deckId);
        return deck ? {...deck, tags: [...deck.tags]} : null;
      },
      async createGoal(input: DaoewoCreateGoalInput) {
        const deck = DEMO_DECKS.find(item => item.id === input.deckId);
        if (
          !deck ||
          deck.availability !== 'published' ||
          deck.cardCount === null
        ) {
          throw new Error('DEMO_CONTENT_NOT_FOUND');
        }
        return createStudyGoal({
          deckId: deck.id,
          cardIds: Array.from(
            {length: deck.cardCount},
            (_, index) => `${deck.id}-${index + 1}`,
          ),
          startDate: input.startDate,
          mode: input.mode,
          value: input.value,
        });
      },
      async getCardWindow(input: {
        readonly deckId: string;
        readonly goalKey?: string;
      }) {
        const deck = DEMO_DECKS.find(item => item.id === input.deckId);
        if (!deck || deck.availability !== 'published') {
          throw new Error('DEMO_CONTENT_NOT_FOUND');
        }
        if (
          deck.tier === 'pro' &&
          !hasActiveProEntitlement(entitlement, clock())
        ) {
          throw new Error('DEMO_CONTENT_LOCKED');
        }
        const cards = DEMO_CARDS.map(card => ({...card, deckId: deck.id}));
        return {
          id: `demo-window-${deck.id}-${toDateKey(clock())}`,
          deckId: deck.id,
          ...(input.goalKey ? {goalKey: input.goalKey} : {}),
          cards,
          targetCount: cards.length,
          expiresAt: new Date(clock().getTime() + 24 * 60 * 60 * 1_000).toISOString(),
        };
      },
      async commitProgressBatch(batch: DaoewoProgressBatch) {
        values.set(`progress-batch:${batch.deckId}`, batch);
      },
      async submitDeckRequest(request: DaoewoDeckRequestInput) {
        const existing =
          (values.get('deck-requests') as readonly DaoewoDeckRequestInput[] | undefined) ??
          [];
        values.set('deck-requests', [...existing, request]);
      },
    },
    now: clock,
  };
}
