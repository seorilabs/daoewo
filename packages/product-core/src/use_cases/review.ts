import type {
  CardProgress,
  ReviewQueueItem,
  ReviewQueueSource,
  ReviewRating,
  StudyOutcome,
} from '../domain/entities.js';

export const SRS_INTERVAL_MS: Readonly<Record<ReviewRating, number>> = Object.freeze({
  easy: 24 * 60 * 60 * 1_000,
  confused: 60 * 60 * 1_000,
  missed: 10 * 60 * 1_000,
});

export const SRS_INTERVAL_LABEL: Readonly<Record<ReviewRating, string>> = Object.freeze({
  easy: '1일 후',
  confused: '1시간 후',
  missed: '10분 후',
});

const QUEUE_PRIORITY: Readonly<Record<ReviewQueueSource, number>> = Object.freeze({
  'review-missed': 0,
  'review-confused': 1,
  'swipe-unknown': 2,
  'review-easy': 3,
  manual: 4,
});

/** 기획서의 고정 SRS 간격을 적용한다. */
export function calculateNextReview(
  progress: CardProgress,
  rating: ReviewRating,
  now: Date,
): CardProgress {
  const reviewedAt = toTimestamp(now);
  const nextReviewAt = new Date(now.getTime() + SRS_INTERVAL_MS[rating]).toISOString();

  if (rating === 'easy') {
    return {
      ...progress,
      status: 'known',
      reviewCount: progress.reviewCount + 1,
      streak: progress.streak + 1,
      nextReviewAt,
      lastOutcome: rating,
      firstSeenAt: progress.firstSeenAt ?? reviewedAt,
      lastSeenAt: reviewedAt,
      updatedAt: reviewedAt,
    };
  }

  if (rating === 'confused') {
    return {
      ...progress,
      status: 'reviewing',
      reviewCount: progress.reviewCount + 1,
      streak: 0,
      nextReviewAt,
      lastOutcome: rating,
      firstSeenAt: progress.firstSeenAt ?? reviewedAt,
      lastSeenAt: reviewedAt,
      updatedAt: reviewedAt,
    };
  }

  if (rating === 'missed') {
    return {
      ...progress,
      status: 'learning',
      reviewCount: progress.reviewCount + 1,
      streak: 0,
      nextReviewAt,
      lastOutcome: rating,
      firstSeenAt: progress.firstSeenAt ?? reviewedAt,
      lastSeenAt: reviewedAt,
      updatedAt: reviewedAt,
    };
  }

  return assertNever(rating);
}

export const applyReviewRating = calculateNextReview;

export function buildDueReviewQueue(
  progresses: readonly CardProgress[],
  now: Date,
): ReviewQueueItem[] {
  const nowMs = toDateMilliseconds(now);

  return progresses
    .filter((progress) => progress.status !== 'suspended' && isDue(progress.nextReviewAt, nowMs))
    .map((progress) => progressToQueueItem(progress))
    .sort(
      (left, right) =>
        Date.parse(left.dueAt) - Date.parse(right.dueAt) ||
        left.priority - right.priority ||
        left.cardId.localeCompare(right.cardId),
    );
}

export function createManualReviewQueueItem(
  progress: CardProgress,
  dueAt: Date,
  createdAt: Date,
): ReviewQueueItem {
  return {
    cardId: progress.cardId,
    deckId: progress.deckId,
    dueAt: toTimestamp(dueAt),
    source: 'manual',
    priority: QUEUE_PRIORITY.manual,
    createdAt: toTimestamp(createdAt),
  };
}

function progressToQueueItem(progress: CardProgress): ReviewQueueItem {
  if (progress.nextReviewAt == null || !Number.isFinite(Date.parse(progress.nextReviewAt))) {
    throw new RangeError(`Invalid nextReviewAt for card ${progress.cardId}`);
  }

  const source = outcomeToQueueSource(progress.lastOutcome);

  return {
    cardId: progress.cardId,
    deckId: progress.deckId,
    dueAt: progress.nextReviewAt,
    source,
    priority: QUEUE_PRIORITY[source],
    createdAt: progress.updatedAt,
  };
}

function outcomeToQueueSource(outcome: StudyOutcome | null): ReviewQueueSource {
  if (outcome === 'unknown' || outcome === 'known' || outcome == null) {
    return 'swipe-unknown';
  }

  return `review-${outcome}`;
}

function isDue(nextReviewAt: string | null, nowMs: number): boolean {
  if (nextReviewAt == null) {
    return false;
  }

  const dueMs = Date.parse(nextReviewAt);
  return Number.isFinite(dueMs) && dueMs <= nowMs;
}

function toDateMilliseconds(date: Date): number {
  const milliseconds = date.getTime();

  if (Number.isNaN(milliseconds)) {
    throw new RangeError('Invalid date');
  }

  return milliseconds;
}

function toTimestamp(date: Date): string {
  return new Date(toDateMilliseconds(date)).toISOString();
}

function assertNever(value: never): never {
  throw new RangeError(`Unsupported review rating: ${String(value)}`);
}
