import { addDaysToDateKey, assertDateKey, dateKeyRange, daysBetweenDateKeys, } from '../domain/date-key.js';
export function buildCalendarDayStates(goal, activities, asOfDate) {
    assertDateKey(asOfDate);
    const activityByDate = new Map();
    for (const activity of activities) {
        assertDateKey(activity.date);
        validateActivity(activity);
        activityByDate.set(activity.date, activity);
    }
    return dateKeyRange(goal.startDate, goal.days).map((date) => {
        const target = goal.assignments[date]?.length ?? 0;
        const activity = activityByDate.get(date);
        const completed = activity?.completed ?? 0;
        const known = activity?.known ?? 0;
        const unknown = activity?.unknown ?? 0;
        const classified = known + unknown;
        return {
            date,
            status: resolveDayStatus(date, asOfDate, target, completed),
            target,
            completed,
            memorizationRate: percentage(known, classified),
            elapsed: activity?.elapsed ?? 0,
            known,
            unknown,
            reviewCount: activity?.reviewCount ?? 0,
        };
    });
}
export function calculateStudyStatistics(days) {
    const totals = days.reduce((result, day) => ({
        target: result.target + nonNegative(day.target, 'target'),
        completed: result.completed + nonNegative(day.completed, 'completed'),
        elapsed: result.elapsed + nonNegative(day.elapsed, 'elapsed'),
        known: result.known + nonNegative(day.known, 'known'),
        unknown: result.unknown + nonNegative(day.unknown, 'unknown'),
        reviewCount: result.reviewCount + nonNegative(day.reviewCount, 'reviewCount'),
    }), { target: 0, completed: 0, elapsed: 0, known: 0, unknown: 0, reviewCount: 0 });
    return {
        ...totals,
        completionRate: percentage(Math.min(totals.completed, totals.target), totals.target),
        memorizationRate: percentage(totals.known, totals.known + totals.unknown),
    };
}
/** 완료한 날짜가 오늘 또는 어제까지 이어질 때의 현재 스트릭이다. */
export function calculateCompletionStreak(completedDays, asOfDate) {
    assertDateKey(asOfDate);
    const dates = completedDateSet(completedDays);
    let cursor = dates.has(asOfDate) ? asOfDate : addDaysToDateKey(asOfDate, -1);
    let streak = 0;
    while (dates.has(cursor)) {
        streak += 1;
        cursor = addDaysToDateKey(cursor, -1);
    }
    return streak;
}
export function calculateLongestCompletionStreak(completedDays) {
    const dates = [...completedDateSet(completedDays)].sort();
    let longest = 0;
    let current = 0;
    let previous = null;
    for (const date of dates) {
        current = previous != null && daysBetweenDateKeys(previous, date) === 1 ? current + 1 : 1;
        longest = Math.max(longest, current);
        previous = date;
    }
    return longest;
}
export function calculateStudyStreak(completedDays, asOfDate) {
    return {
        current: calculateCompletionStreak(completedDays, asOfDate),
        longest: calculateLongestCompletionStreak(completedDays),
    };
}
function resolveDayStatus(date, asOfDate, target, completed) {
    if (target > 0 && completed >= target) {
        return 'completed';
    }
    if (completed > 0) {
        return 'in-progress';
    }
    return date < asOfDate ? 'missed' : 'scheduled';
}
function completedDateSet(completedDays) {
    const dates = new Set();
    for (const item of completedDays) {
        if (typeof item === 'string') {
            assertDateKey(item);
            dates.add(item);
        }
        else if (item.status === 'completed' && item.target > 0 && item.completed >= item.target) {
            assertDateKey(item.date);
            dates.add(item.date);
        }
    }
    return dates;
}
function validateActivity(activity) {
    nonNegative(activity.completed, 'completed');
    nonNegative(activity.known, 'known');
    nonNegative(activity.unknown, 'unknown');
    nonNegative(activity.reviewCount, 'reviewCount');
    nonNegative(activity.elapsed, 'elapsed');
}
function percentage(numerator, denominator) {
    return denominator <= 0 ? 0 : Math.round((numerator / denominator) * 100);
}
function nonNegative(value, field) {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${field} must be a non-negative number`);
    }
    return value;
}
//# sourceMappingURL=statistics.js.map