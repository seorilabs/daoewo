export type LocalDateKey = string;
export declare function isDateKey(value: string): value is LocalDateKey;
export declare function assertDateKey(value: string): asserts value is LocalDateKey;
/** Date의 절대 시각을 지정한 IANA timezone의 YYYY-MM-DD로 변환한다. */
export declare function toDateKey(date: Date, timeZone?: string): LocalDateKey;
/** timezone 영향을 받지 않는 달력 연산이다. */
export declare function addDaysToDateKey(dateKey: LocalDateKey, days: number): LocalDateKey;
export declare function daysBetweenDateKeys(from: LocalDateKey, to: LocalDateKey): number;
export declare function dateKeyRange(startDate: LocalDateKey, days: number): LocalDateKey[];
//# sourceMappingURL=date-key.d.ts.map