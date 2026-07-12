import type { CardProgress, ReviewQueueItem, ReviewRating } from '../domain/entities.js';
export declare const SRS_INTERVAL_MS: Readonly<Record<ReviewRating, number>>;
export declare const SRS_INTERVAL_LABEL: Readonly<Record<ReviewRating, string>>;
/** 기획서의 고정 SRS 간격을 적용한다. */
export declare function calculateNextReview(progress: CardProgress, rating: ReviewRating, now: Date): CardProgress;
export declare const applyReviewRating: typeof calculateNextReview;
export declare function buildDueReviewQueue(progresses: readonly CardProgress[], now: Date): ReviewQueueItem[];
export declare function createManualReviewQueueItem(progress: CardProgress, dueAt: Date, createdAt: Date): ReviewQueueItem;
//# sourceMappingURL=review.d.ts.map