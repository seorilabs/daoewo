import type { LocalDateKey } from './date-key.js';

export type DeckTier = 'free' | 'pro';
export type DeckSource = 'official' | 'ai-batch' | 'requested';
export type CardDifficulty = 1 | 2 | 3 | 4 | 5;
export type StudyGoalMode = 'days' | 'daily-count';
export type CardLearningStatus = 'new' | 'learning' | 'known' | 'reviewing' | 'suspended';
export type SwipeDirection = 'known' | 'unknown';
export type ReviewRating = 'easy' | 'confused' | 'missed';
export type StudyOutcome = SwipeDirection | ReviewRating;
export type ReviewQueueSource =
  | 'swipe-unknown'
  | 'review-easy'
  | 'review-confused'
  | 'review-missed'
  | 'manual';
export type CalendarDayStatus = 'scheduled' | 'in-progress' | 'completed' | 'missed';
export type EntitlementPlan = 'free' | 'pro';
export type DeckRequestStatus = 'queued' | 'generating' | 'published' | 'rejected';

/** 서버 카탈로그와 로컬 캐시가 공통으로 사용하는 덱 메타데이터다. */
export interface Deck {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly locale: string;
  readonly source: DeckSource;
  readonly tier: DeckTier;
  readonly license: string;
  readonly level: string;
  readonly cardCount: number;
  readonly tags: readonly string[];
  readonly version?: number;
  readonly chunkSize?: number;
  readonly publishedAt?: string;
}

/**
 * 카드 본문은 제품 종류와 무관하며, 이미지/오디오 같은 매체만 adapter가 정한 타입으로
 * 주입한다. 이 덕분에 core는 매체 저장소나 SDK를 알지 않는다.
 */
export interface Card<TMedia = unknown> {
  readonly id: string;
  readonly deckId: string;
  readonly front: string;
  readonly back: string;
  readonly hint?: string;
  readonly reading?: string;
  readonly example?: string;
  readonly exampleMeaning?: string;
  readonly media?: TMedia;
  readonly tags: readonly string[];
  readonly difficulty: CardDifficulty;
}

export interface StudyGoal {
  readonly key: string;
  readonly deckId: string;
  readonly mode: StudyGoalMode;
  readonly startDate: LocalDateKey;
  readonly totalCount: number;
  readonly days: number;
  readonly dailyCount: number;
  readonly assignments: Readonly<Record<LocalDateKey, readonly string[]>>;
}

export interface CardProgress {
  readonly cardId: string;
  readonly deckId: string;
  readonly status: CardLearningStatus;
  readonly knownCount: number;
  readonly unknownCount: number;
  readonly reviewCount: number;
  readonly streak: number;
  readonly nextReviewAt: string | null;
  readonly lastOutcome: StudyOutcome | null;
  readonly firstSeenAt: string | null;
  readonly lastSeenAt: string | null;
  readonly updatedAt: string;
}

export interface ReviewQueueItem {
  readonly cardId: string;
  readonly deckId: string;
  readonly dueAt: string;
  readonly source: ReviewQueueSource;
  /** 숫자가 작을수록 같은 dueAt에서 먼저 노출한다. */
  readonly priority: number;
  readonly createdAt: string;
}

export interface CalendarDayState {
  readonly date: LocalDateKey;
  readonly status: CalendarDayStatus;
  readonly target: number;
  readonly completed: number;
  /** 0~100 정수. 해당 날짜의 known / (known + unknown) 비율이다. */
  readonly memorizationRate: number;
  /** 밀리초 단위 학습 시간. */
  readonly elapsed: number;
  readonly known: number;
  readonly unknown: number;
  readonly reviewCount: number;
}

export interface Entitlement {
  readonly plan: EntitlementPlan;
  readonly source: string;
  /** null이면 만료되지 않는다. */
  readonly validUntil: string | null;
}

export interface DeckRequest {
  readonly id: string;
  readonly topic: string;
  readonly category: string;
  readonly locale: string;
  readonly note?: string;
  readonly status: DeckRequestStatus;
  readonly requesterId: string;
  readonly requestedAt: string;
}

export interface CatalogDeckMetadata extends Deck {
  /** 현재 entitlement에서 본문을 열 수 없는 경우 true다. 메타데이터 자체는 계속 노출한다. */
  readonly isLocked: boolean;
}

export interface StudyStatistics {
  readonly target: number;
  readonly completed: number;
  readonly completionRate: number;
  readonly memorizationRate: number;
  readonly elapsed: number;
  readonly known: number;
  readonly unknown: number;
  readonly reviewCount: number;
}

export interface StudyStreak {
  readonly current: number;
  readonly longest: number;
}
