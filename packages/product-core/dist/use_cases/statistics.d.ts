import type { CalendarDayState, StudyGoal, StudyStatistics, StudyStreak } from '../domain/entities.js';
import { type LocalDateKey } from '../domain/date-key.js';
export interface StudyDayActivity {
    readonly date: LocalDateKey;
    readonly completed: number;
    readonly known: number;
    readonly unknown: number;
    readonly reviewCount: number;
    readonly elapsed: number;
}
export declare function buildCalendarDayStates(goal: StudyGoal, activities: readonly StudyDayActivity[], asOfDate: LocalDateKey): CalendarDayState[];
export declare function calculateStudyStatistics(days: readonly CalendarDayState[]): StudyStatistics;
/** 완료한 날짜가 오늘 또는 어제까지 이어질 때의 현재 스트릭이다. */
export declare function calculateCompletionStreak(completedDays: readonly LocalDateKey[] | readonly CalendarDayState[], asOfDate: LocalDateKey): number;
export declare function calculateLongestCompletionStreak(completedDays: readonly LocalDateKey[] | readonly CalendarDayState[]): number;
export declare function calculateStudyStreak(completedDays: readonly LocalDateKey[] | readonly CalendarDayState[], asOfDate: LocalDateKey): StudyStreak;
//# sourceMappingURL=statistics.d.ts.map