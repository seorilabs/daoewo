export type BackendErrorCode =
  | "invalid-argument"
  | "unauthenticated"
  | "permission-denied"
  | "not-found"
  | "already-exists"
  | "failed-precondition"
  | "aborted"
  | "resource-exhausted"
  | "internal";

export class BackendError extends Error {
  constructor(
    readonly code: BackendErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

export function assertBackend(
  condition: unknown,
  code: BackendErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): asserts condition {
  if (!condition) {
    throw new BackendError(code, message, details);
  }
}

export function asRecord(value: unknown, name = "data"): Record<string, unknown> {
  assertBackend(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "invalid-argument",
    `${name} must be an object.`,
  );
  return value as Record<string, unknown>;
}

export function requiredString(
  value: unknown,
  name: string,
  options: { min?: number; max?: number; pattern?: RegExp } = {},
): string {
  const min = options.min ?? 1;
  const max = options.max ?? 200;
  assertBackend(typeof value === "string", "invalid-argument", `${name} must be a string.`);
  const normalized = value.trim();
  assertBackend(
    normalized.length >= min && normalized.length <= max,
    "invalid-argument",
    `${name} must be between ${min} and ${max} characters.`,
  );
  if (options.pattern !== undefined) {
    assertBackend(
      options.pattern.test(normalized),
      "invalid-argument",
      `${name} has an invalid format.`,
    );
  }
  return normalized;
}

export function optionalString(
  value: unknown,
  name: string,
  max: number,
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return requiredString(value, name, { max });
}

export function requiredInteger(
  value: unknown,
  name: string,
  options: { min?: number; max?: number } = {},
): number {
  assertBackend(
    typeof value === "number" && Number.isSafeInteger(value),
    "invalid-argument",
    `${name} must be an integer.`,
  );
  if (options.min !== undefined) {
    assertBackend(value >= options.min, "invalid-argument", `${name} is too small.`);
  }
  if (options.max !== undefined) {
    assertBackend(value <= options.max, "invalid-argument", `${name} is too large.`);
  }
  return value;
}
