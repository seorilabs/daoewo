import type { StudyGoal, StudyGoalMode } from '../domain/entities.js';
import { type LocalDateKey } from '../domain/date-key.js';
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
export declare function allocateCardsByGoal(input: AllocateCardsByGoalInput): StudyGoalAllocation;
export interface CreateStudyGoalInput extends AllocateCardsByGoalInput {
    readonly key?: string;
    readonly deckId: string;
}
export declare function createStudyGoal(input: CreateStudyGoalInput): StudyGoal;
export declare function getStudyGoalEndDate(goal: StudyGoal): LocalDateKey;
export declare function getAssignedCardIds(goal: StudyGoal, date: LocalDateKey): readonly string[];
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
export declare function buildDailyAssignment(input: BuildDailyAssignmentInput): Readonly<Record<LocalDateKey, readonly string[]>>;
//# sourceMappingURL=study-goal.d.ts.map