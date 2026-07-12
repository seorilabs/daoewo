export type LocalDateKey = string;

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(value: string): value is LocalDateKey {
  const match = DATE_KEY_PATTERN.exec(value);

  if (match == null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function assertDateKey(value: string): asserts value is LocalDateKey {
  if (!isDateKey(value)) {
    throw new RangeError(`Invalid date key: ${value}`);
  }
}

/** Date의 절대 시각을 지정한 IANA timezone의 YYYY-MM-DD로 변환한다. */
export function toDateKey(date: Date, timeZone = 'Asia/Seoul'): LocalDateKey {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Invalid date');
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (year == null || month == null || day == null) {
    throw new RangeError(`Could not format date in timezone: ${timeZone}`);
  }

  return `${year}-${month}-${day}`;
}

/** timezone 영향을 받지 않는 달력 연산이다. */
export function addDaysToDateKey(dateKey: LocalDateKey, days: number): LocalDateKey {
  const date = parseDateKeyAsUtc(dateKey);
  date.setUTCDate(date.getUTCDate() + Math.trunc(days));
  return formatUtcDate(date);
}

export function daysBetweenDateKeys(from: LocalDateKey, to: LocalDateKey): number {
  const fromTime = parseDateKeyAsUtc(from).getTime();
  const toTime = parseDateKeyAsUtc(to).getTime();
  return Math.round((toTime - fromTime) / 86_400_000);
}

export function dateKeyRange(startDate: LocalDateKey, days: number): LocalDateKey[] {
  assertDateKey(startDate);

  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError('days must be a non-negative integer');
  }

  return Array.from({ length: days }, (_, index) => addDaysToDateKey(startDate, index));
}

function parseDateKeyAsUtc(dateKey: LocalDateKey): Date {
  assertDateKey(dateKey);
  const match = DATE_KEY_PATTERN.exec(dateKey);

  if (match == null) {
    throw new RangeError(`Invalid date key: ${dateKey}`);
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatUtcDate(date: Date): LocalDateKey {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
