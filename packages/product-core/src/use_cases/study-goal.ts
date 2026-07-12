import type { StudyGoal, StudyGoalMode } from '../domain/entities.js';
import {
  addDaysToDateKey,
  assertDateKey,
  daysBetweenDateKeys,
  type LocalDateKey,
} from '../domain/date-key.js';

export interface StudyGoalAllocation {
  readonly totalCount: number;
  readonly days: number;
  readonly dailyCount: number;
  readonly assignments: Readonly<Record<LocalDateKey, readonly string[]>>;
}

export interface AllocateCardsByGoalInput {
  readonly cardIds: readonly string[];
  readonly startDate: LocalDateKey;
  readonly mode: StudyGoalMode;
  /** mode=days이면 날짜 수, daily-count이면 하루 카드 수다. */
  readonly value: number;
}

export function allocateCardsByGoal(input: AllocateCardsByGoalInput): StudyGoalAllocation {
  const { cardIds, startDate, mode } = input;
  assertDateKey(startDate);
  assertCardIds(cardIds);
  const value = toPositiveInteger(input.value, 'value');
  const totalCount = cardIds.length;

  if (totalCount === 0) {
    throw new RangeError('cardIds must contain at least one card');
  }

  if (mode === 'days') {
    const assignments: Record<LocalDateKey, readonly string[]> = {};
    const baseCount = Math.floor(totalCount / value);
    const remainder = totalCount % value;
    let cursor = 0;

    for (let dayIndex = 0; dayIndex < value; dayIndex += 1) {
      const count = baseCount + (dayIndex < remainder ? 1 : 0);
      const date = addDaysToDateKey(startDate, dayIndex);
      assignments[date] = cardIds.slice(cursor, cursor + count);
      cursor += count;
    }

    return {
      totalCount,
      days: value,
      dailyCount: Math.ceil(totalCount / value),
      assignments,
    };
  }

  if (mode === 'daily-count') {
    const days = Math.ceil(totalCount / value);
    const assignments: Record<LocalDateKey, readonly string[]> = {};

    for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
      const start = dayIndex * value;
      assignments[addDaysToDateKey(startDate, dayIndex)] = cardIds.slice(start, start + value);
    }

    return {
      totalCount,
      days,
      dailyCount: value,
      assignments,
    };
  }

  return assertNever(mode);
}

export interface CreateStudyGoalInput extends AllocateCardsByGoalInput {
  readonly key?: string;
  readonly deckId: string;
}

export function createStudyGoal(input: CreateStudyGoalInput): StudyGoal {
  const deckId = input.deckId.trim();

  if (deckId.length === 0) {
    throw new RangeError('deckId is required');
  }

  const allocation = allocateCardsByGoal(input);
  const key = input.key?.trim() || deckId;

  return {
    key,
    deckId,
    mode: input.mode,
    startDate: input.startDate,
    ...allocation,
  };
}

export function getStudyGoalEndDate(goal: StudyGoal): LocalDateKey {
  return addDaysToDateKey(goal.startDate, goal.days - 1);
}

export function getAssignedCardIds(goal: StudyGoal, date: LocalDateKey): readonly string[] {
  assertDateKey(date);
  return goal.assignments[date] ?? [];
}

export interface BuildDailyAssignmentInput {
  readonly startDate: LocalDateKey;
  readonly cardIds?: readonly string[];
  readonly cardCount?: number;
  /** startDate와 endDate를 모두 포함해 균등 배분한다. */
  readonly endDate?: LocalDateKey;
  /** endDate 대신 지정하면 마지막 날을 제외하고 이 수량을 유지한다. */
  readonly dailyTarget?: number;
}

/**
 * 서버가 deck metadata의 cardCount만 아는 경우에도 index 문자열을 안정적으로 배분한다.
 * endDate와 dailyTarget 중 정확히 하나를 지정해야 한다.
 */
export function buildDailyAssignment(
  input: BuildDailyAssignmentInput,
): Readonly<Record<LocalDateKey, readonly string[]>> {
  const hasEndDate = input.endDate != null;
  const hasDailyTarget = input.dailyTarget != null;

  if (hasEndDate === hasDailyTarget) {
    throw new RangeError('Exactly one of endDate or dailyTarget is required');
  }

  const cardIds = resolveCardIds(input.cardIds, input.cardCount);

  if (input.endDate != null) {
    assertDateKey(input.endDate);
    const days = daysBetweenDateKeys(input.startDate, input.endDate) + 1;

    if (days <= 0) {
      throw new RangeError('endDate must be on or after startDate');
    }

    return allocateCardsByGoal({
      cardIds,
      startDate: input.startDate,
      mode: 'days',
      value: days,
    }).assignments;
  }

  return allocateCardsByGoal({
    cardIds,
    startDate: input.startDate,
    mode: 'daily-count',
    value: input.dailyTarget ?? 0,
  }).assignments;
}

function resolveCardIds(cardIds: readonly string[] | undefined, cardCount: number | undefined): readonly string[] {
  if (cardIds != null) {
    if (cardCount != null && cardCount !== cardIds.length) {
      throw new RangeError('cardCount must match cardIds.length');
    }

    return cardIds;
  }

  const count = toPositiveInteger(cardCount ?? 0, 'cardCount');
  return Array.from({ length: count }, (_, index) => String(index));
}

function assertCardIds(cardIds: readonly string[]): void {
  if (cardIds.some((cardId) => cardId.trim().length === 0)) {
    throw new RangeError('cardIds cannot contain an empty id');
  }

  if (new Set(cardIds).size !== cardIds.length) {
    throw new RangeError('cardIds must be unique');
  }
}

function toPositiveInteger(value: number, field: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer`);
  }

  return value;
}

function assertNever(value: never): never {
  throw new RangeError(`Unsupported study goal mode: ${String(value)}`);
}
