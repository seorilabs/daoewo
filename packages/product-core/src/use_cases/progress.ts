import type { CardProgress, SwipeDirection } from '../domain/entities.js';

export function createInitialCardProgress(cardId: string, deckId: string, now: Date): CardProgress {
  const timestamp = toTimestamp(now);

  if (cardId.trim().length === 0 || deckId.trim().length === 0) {
    throw new RangeError('cardId and deckId are required');
  }

  return {
    cardId,
    deckId,
    status: 'new',
    knownCount: 0,
    unknownCount: 0,
    reviewCount: 0,
    streak: 0,
    nextReviewAt: null,
    lastOutcome: null,
    firstSeenAt: null,
    lastSeenAt: null,
    updatedAt: timestamp,
  };
}

/** 스와이프 결과를 immutable progress로 분류한다. */
export function classifySwipe(
  progress: CardProgress,
  direction: SwipeDirection,
  now: Date,
): CardProgress {
  const timestamp = toTimestamp(now);

  if (direction === 'known') {
    return {
      ...progress,
      status: 'known',
      knownCount: progress.knownCount + 1,
      streak: progress.streak + 1,
      nextReviewAt: null,
      lastOutcome: direction,
      firstSeenAt: progress.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
      updatedAt: timestamp,
    };
  }

  if (direction === 'unknown') {
    return {
      ...progress,
      status: 'learning',
      unknownCount: progress.unknownCount + 1,
      streak: 0,
      // 모르는 카드의 1차 복습은 현재 세션의 복습 큐에 즉시 들어간다.
      nextReviewAt: timestamp,
      lastOutcome: direction,
      firstSeenAt: progress.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
      updatedAt: timestamp,
    };
  }

  return assertNever(direction);
}

export const applySwipeToProgress = classifySwipe;

function toTimestamp(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Invalid date');
  }

  return date.toISOString();
}

function assertNever(value: never): never {
  throw new RangeError(`Unsupported swipe direction: ${String(value)}`);
}
