import {
  getCrashlytics,
  recordError,
  setAttributes,
  setUserId,
  type Crashlytics,
} from '@react-native-firebase/crashlytics';

export const CRASH_REPORT_OPERATIONS = Object.freeze([
  'app-bootstrap',
  'authentication',
  'content-load',
  'learning-sync',
  'purchase',
  'remote-config',
  'notification',
  'account-deletion',
  'unknown',
] as const);

export const CRASH_REPORT_SURFACES = Object.freeze([
  'app',
  'onboarding',
  'home',
  'catalog',
  'study',
  'review',
  'settings',
  'paywall',
  'background',
  'unknown',
] as const);

export const CRASH_REPORT_ERROR_CODES = Object.freeze([
  'cancelled',
  'configuration',
  'invalid-state',
  'network',
  'permission-denied',
  'timeout',
  'unavailable',
  'unknown',
] as const);

export type CrashReportOperation = (typeof CRASH_REPORT_OPERATIONS)[number];
export type CrashReportSurface = (typeof CRASH_REPORT_SURFACES)[number];
export type CrashReportErrorCode = (typeof CRASH_REPORT_ERROR_CODES)[number];
export type CrashReportPlatform = 'android' | 'ios' | 'unknown';
export type CrashReportBuild = 'debug' | 'release' | 'unknown';

export interface SafeCrashReport {
  readonly operation: CrashReportOperation;
  readonly surface: CrashReportSurface;
  readonly errorCode: CrashReportErrorCode;
}

export interface SafeCrashReporter {
  /** raw Error나 자유 입력 문자열을 받지 않고 allowlist 값만 기록한다. */
  record(report: SafeCrashReport): Promise<void>;
  /** 사용자 식별자는 설정하지 않으며 빈 값으로 지우는 동작만 제공한다. */
  clearUserContext(): Promise<void>;
}

export async function observeSafeCrashFailure<Result>(input: {
  readonly reporter: SafeCrashReporter;
  readonly operation: CrashReportOperation;
  readonly surface: CrashReportSurface;
  readonly action: () => Promise<Result>;
}): Promise<Result> {
  try {
    return await input.action();
  } catch (error) {
    const errorCode = classifySafeCrashError(error);
    if (errorCode !== 'cancelled') {
      await input.reporter.record({
        operation: input.operation,
        surface: input.surface,
        errorCode,
      });
    }
    throw error;
  }
}

export function classifySafeCrashError(error: unknown): CrashReportErrorCode {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'cancelled';
  }
  const code = safeErrorCode(error);
  if (code === null) {
    return 'unknown';
  }
  if (/cancel(?:led|ed)|user-cancel/i.test(code)) {
    return 'cancelled';
  }
  if (/permission-denied|not-authorized|unauthorized/i.test(code)) {
    return 'permission-denied';
  }
  if (/network|offline|connection/i.test(code)) {
    return 'network';
  }
  if (/timeout|deadline-exceeded/i.test(code)) {
    return 'timeout';
  }
  if (/unavailable|service-unavailable/i.test(code)) {
    return 'unavailable';
  }
  if (/invalid|failed-precondition|already-exists|not-found/i.test(code)) {
    return 'invalid-state';
  }
  return 'unknown';
}

export function createSafeCrashReporter(input: {
  readonly platform: CrashReportPlatform;
  readonly build: CrashReportBuild;
}): SafeCrashReporter {
  let instance: Crashlytics | null = null;

  function crashlytics(): Crashlytics {
    instance ??= getCrashlytics();
    return instance;
  }

  const platform = allowedValue(input.platform, [
    'android',
    'ios',
    'unknown',
  ] as const);
  const build = allowedValue(input.build, [
    'debug',
    'release',
    'unknown',
  ] as const);

  return {
    async record(report) {
      let target: Crashlytics;
      try {
        target = crashlytics();
      } catch {
        return;
      }

      const candidate = report as Partial<SafeCrashReport> | null | undefined;
      const attributes = {
        operation: allowedValue(candidate?.operation, CRASH_REPORT_OPERATIONS),
        surface: allowedValue(candidate?.surface, CRASH_REPORT_SURFACES),
        error_code: allowedValue(
          candidate?.errorCode,
          CRASH_REPORT_ERROR_CODES,
        ),
        platform,
        build,
      };

      try {
        await setAttributes(target, attributes);
      } catch {
        // 진단 전송 실패가 제품 동작을 깨뜨리지 않게 한다.
      }

      try {
        const sanitizedError = new Error('daoewo_operational_error');
        sanitizedError.name = 'DaoewoOperationalError';
        recordError(target, sanitizedError, 'DaoewoOperationalError');
      } catch {
        // Crashlytics native module 부재도 제품 오류로 승격하지 않는다.
      }
    },
    async clearUserContext() {
      try {
        await setUserId(crashlytics(), '');
      } catch {
        // 사용자 context 정리 실패도 sign-out 같은 제품 흐름을 막지 않는다.
      }
    },
  };
}

function allowedValue<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
): Value {
  return typeof value === 'string' && allowed.includes(value as Value)
    ? (value as Value)
    : (allowed.at(-1) as Value);
}

function safeErrorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) {
    return null;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' && code.length <= 100 ? code : null;
}
