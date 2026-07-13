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

const SAFE_ERROR_CODE_CLASSIFICATIONS: Readonly<
  Record<string, CrashReportErrorCode>
> = Object.freeze({
  canceled: 'cancelled',
  cancelled: 'cancelled',
  'user-canceled': 'cancelled',
  'user-cancelled': 'cancelled',
  'e-user-cancelled': 'cancelled',
  'permission-denied': 'permission-denied',
  'not-authorized': 'permission-denied',
  unauthorized: 'permission-denied',
  network: 'network',
  'network-error': 'network',
  'network-request-failed': 'network',
  offline: 'network',
  connection: 'network',
  'connection-error': 'network',
  'connection-failed': 'network',
  timeout: 'timeout',
  'deadline-exceeded': 'timeout',
  unavailable: 'unavailable',
  'service-unavailable': 'unavailable',
  invalid: 'invalid-state',
  'invalid-argument': 'invalid-state',
  'failed-precondition': 'invalid-state',
  'already-exists': 'invalid-state',
  'not-found': 'invalid-state',
  configuration: 'configuration',
  'configuration-error': 'configuration',
  'invalid-configuration': 'configuration',
});

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
  if (ownDataValue(error, 'name') === 'AbortError') {
    return 'cancelled';
  }
  const codeToken = safeErrorCodeToken(error);
  return codeToken === null
    ? 'unknown'
    : SAFE_ERROR_CODE_CLASSIFICATIONS[codeToken] ?? 'unknown';
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

  const platform = allowedValue(ownDataValue(input, 'platform'), [
    'android',
    'ios',
    'unknown',
  ] as const);
  const build = allowedValue(ownDataValue(input, 'build'), [
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

      const attributes = {
        operation: allowedValue(
          ownDataValue(report, 'operation'),
          CRASH_REPORT_OPERATIONS,
        ),
        surface: allowedValue(
          ownDataValue(report, 'surface'),
          CRASH_REPORT_SURFACES,
        ),
        error_code: allowedValue(
          ownDataValue(report, 'errorCode'),
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

function safeErrorCodeToken(error: unknown): string | null {
  const code = ownDataValue(error, 'code');
  if (typeof code !== 'string' || code.length > 100) {
    return null;
  }
  const normalized = code.trim().toLowerCase().replaceAll('_', '-');
  if (!/^[a-z0-9./-]+$/.test(normalized)) {
    return null;
  }
  return normalized.split('/').at(-1) ?? null;
}

/** getter/prototype/Proxy에 숨은 자유 입력은 읽지 않고 own data property만 허용한다. */
function ownDataValue(input: unknown, key: string): unknown {
  if (
    input === null ||
    (typeof input !== 'object' && typeof input !== 'function')
  ) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor !== undefined && 'value' in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}
