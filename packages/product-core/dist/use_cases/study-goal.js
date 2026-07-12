import { addDaysToDateKey, assertDateKey, daysBetweenDateKeys, } from '../domain/date-key.js';
export function allocateCardsByGoal(input) {
    const { cardIds, startDate, mode } = input;
    assertDateKey(startDate);
    assertCardIds(cardIds);
    const value = toPositiveInteger(input.value, 'value');
    const totalCount = cardIds.length;
    if (totalCount === 0) {
        throw new RangeError('cardIds must contain at least one card');
    }
    if (mode === 'days') {
        const assignments = {};
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
        const assignments = {};
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
export function createStudyGoal(input) {
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
export function getStudyGoalEndDate(goal) {
    return addDaysToDateKey(goal.startDate, goal.days - 1);
}
export function getAssignedCardIds(goal, date) {
    assertDateKey(date);
    return goal.assignments[date] ?? [];
}
/**
 * 서버가 deck metadata의 cardCount만 아는 경우에도 index 문자열을 안정적으로 배분한다.
 * endDate와 dailyTarget 중 정확히 하나를 지정해야 한다.
 */
export function buildDailyAssignment(input) {
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
function resolveCardIds(cardIds, cardCount) {
    if (cardIds != null) {
        if (cardCount != null && cardCount !== cardIds.length) {
            throw new RangeError('cardCount must match cardIds.length');
        }
        return cardIds;
    }
    const count = toPositiveInteger(cardCount ?? 0, 'cardCount');
    return Array.from({ length: count }, (_, index) => String(index));
}
function assertCardIds(cardIds) {
    if (cardIds.some((cardId) => cardId.trim().length === 0)) {
        throw new RangeError('cardIds cannot contain an empty id');
    }
    if (new Set(cardIds).size !== cardIds.length) {
        throw new RangeError('cardIds must be unique');
    }
}
function toPositiveInteger(value, field) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
        throw new RangeError(`${field} must be a positive integer`);
    }
    return value;
}
function assertNever(value) {
    throw new RangeError(`Unsupported study goal mode: ${String(value)}`);
}
//# sourceMappingURL=study-goal.js.map