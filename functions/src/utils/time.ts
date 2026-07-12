import { BackendError, assertBackend } from "../errors.js";

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function localDateKey(date: Date, timezone: string): string {
  assertValidTimezone(timezone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function assertLocalDate(value: string, name: string): void {
  assertBackend(
    LOCAL_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
    "invalid-argument",
    `${name} must be a valid YYYY-MM-DD date.`,
  );
}

export function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new BackendError("invalid-argument", "timezone must be a valid IANA timezone.");
  }
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1_000);
}
