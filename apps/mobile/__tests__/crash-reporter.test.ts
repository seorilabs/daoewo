import {
  getCrashlytics,
  recordError,
  setAttributes,
  setUserId,
  type Crashlytics,
} from '@react-native-firebase/crashlytics';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  classifySafeCrashError,
  createSafeCrashReporter,
  observeSafeCrashFailure,
} from '../src/adapters/crash-reporter';

jest.mock('@react-native-firebase/crashlytics', () => ({
  getCrashlytics: jest.fn(),
  recordError: jest.fn(),
  setAttributes: jest.fn(),
  setUserId: jest.fn(),
}));

const mockedGetCrashlytics = jest.mocked(getCrashlytics);
const mockedRecordError = jest.mocked(recordError);
const mockedSetAttributes = jest.mocked(setAttributes);
const mockedSetUserId = jest.mocked(setUserId);

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetCrashlytics.mockReturnValue({} as Crashlytics);
  mockedSetAttributes.mockResolvedValue(null);
  mockedSetUserId.mockResolvedValue(null);
});

describe('PII-safe Crashlytics adapter', () => {
  it('raw JS unhandled exception 자동 전송을 firebase.json에서 끈다', () => {
    const config = JSON.parse(
      readFileSync(join(__dirname, '..', 'firebase.json'), 'utf8'),
    ) as { readonly 'react-native'?: Readonly<Record<string, unknown>> };

    const reactNativeConfig = config['react-native'];
    expect(
      reactNativeConfig?.crashlytics_is_error_generation_on_js_crash_enabled,
    ).toBe(false);
  });

  it('고정된 다섯 attribute와 정제된 Error만 modular API에 전달한다', async () => {
    const reporter = createSafeCrashReporter({
      platform: 'android',
      build: 'release',
    });

    await reporter.record({
      operation: 'learning-sync',
      surface: 'study',
      errorCode: 'network',
    });

    expect(mockedSetAttributes).toHaveBeenCalledWith(expect.anything(), {
      operation: 'learning-sync',
      surface: 'study',
      error_code: 'network',
      platform: 'android',
      build: 'release',
    });
    expect(mockedRecordError).toHaveBeenCalledTimes(1);
    const [, error, jsErrorName] = mockedRecordError.mock.calls[0]!;
    expect(error).toMatchObject({
      name: 'DaoewoOperationalError',
      message: 'daoewo_operational_error',
    });
    expect(jsErrorName).toBe('DaoewoOperationalError');
    expect(mockedSetUserId).not.toHaveBeenCalled();
  });

  it('런타임의 임의 값과 raw PII 필드를 모두 unknown 또는 누락으로 정제한다', async () => {
    const reporter = createSafeCrashReporter({
      platform: 'uid-platform' as 'android',
      build: 'user@example.com' as 'debug',
    });
    const unsafeReport = {
      operation: 'token=secret-token',
      surface: 'card=private-card',
      errorCode: 'topic=private-topic',
      uid: 'uid-1234',
      email: 'user@example.com',
      note: 'private-note',
      error: new Error('secret-token'),
    } as unknown as Parameters<typeof reporter.record>[0];

    await reporter.record(unsafeReport);

    expect(mockedSetAttributes).toHaveBeenCalledWith(expect.anything(), {
      operation: 'unknown',
      surface: 'unknown',
      error_code: 'unknown',
      platform: 'unknown',
      build: 'unknown',
    });
    const serializedCalls = JSON.stringify([
      mockedSetAttributes.mock.calls,
      mockedRecordError.mock.calls.map(([, error, name]) => [
        error.message,
        error.name,
        name,
      ]),
    ]);
    expect(serializedCalls).not.toMatch(
      /secret-token|uid-1234|user@example\.com|private-card|private-topic|private-note/,
    );

    await expect(
      reporter.record(
        undefined as unknown as Parameters<typeof reporter.record>[0],
      ),
    ).resolves.toBeUndefined();

    const operationGetter = jest.fn(() => {
      throw new Error('getter-secret-token');
    });
    const accessorReport = Object.defineProperty({}, 'operation', {
      get: operationGetter,
    }) as Parameters<typeof reporter.record>[0];
    await expect(reporter.record(accessorReport)).resolves.toBeUndefined();
    expect(operationGetter).not.toHaveBeenCalled();
    expect(mockedSetAttributes).toHaveBeenLastCalledWith(expect.anything(), {
      operation: 'unknown',
      surface: 'unknown',
      error_code: 'unknown',
      platform: 'unknown',
      build: 'unknown',
    });
  });

  it('사용자 식별은 설정하지 않고 빈 값 clear만 제공한다', async () => {
    const reporter = createSafeCrashReporter({
      platform: 'ios',
      build: 'debug',
    });

    await reporter.clearUserContext();

    expect(mockedSetUserId).toHaveBeenCalledTimes(1);
    expect(mockedSetUserId).toHaveBeenCalledWith(expect.anything(), '');
  });

  it('Crashlytics module/API 실패가 제품 흐름으로 전파되지 않는다', async () => {
    const reporter = createSafeCrashReporter({
      platform: 'android',
      build: 'release',
    });
    mockedSetAttributes.mockRejectedValueOnce(new Error('native unavailable'));
    mockedRecordError.mockImplementationOnce(() => {
      throw new Error('native unavailable');
    });

    await expect(
      reporter.record({
        operation: 'remote-config',
        surface: 'background',
        errorCode: 'unavailable',
      }),
    ).resolves.toBeUndefined();

    mockedGetCrashlytics.mockImplementationOnce(() => {
      throw new Error('Firebase app missing');
    });
    const unavailableReporter = createSafeCrashReporter({
      platform: 'ios',
      build: 'debug',
    });
    await expect(
      unavailableReporter.clearUserContext(),
    ).resolves.toBeUndefined();
  });

  it('운영 실패를 allowlist code로만 분류하고 원본 오류를 다시 전달한다', async () => {
    const reporter = createSafeCrashReporter({
      platform: 'ios',
      build: 'release',
    });
    const rawFailure = Object.assign(new Error('token=secret-token'), {
      code: 'functions/network-request-failed',
    });

    await expect(
      observeSafeCrashFailure({
        reporter,
        operation: 'learning-sync',
        surface: 'background',
        action: async () => {
          throw rawFailure;
        },
      }),
    ).rejects.toBe(rawFailure);

    expect(mockedSetAttributes).toHaveBeenCalledWith(expect.anything(), {
      operation: 'learning-sync',
      surface: 'background',
      error_code: 'network',
      platform: 'ios',
      build: 'release',
    });
    expect(JSON.stringify(mockedSetAttributes.mock.calls)).not.toContain(
      'secret-token',
    );
  });

  it('사용자 취소는 운영 crash로 기록하지 않는다', async () => {
    const reporter = createSafeCrashReporter({
      platform: 'ios',
      build: 'release',
    });
    const cancelled = Object.assign(new Error('cancelled'), {
      code: 'auth/user-cancelled',
    });

    await expect(
      observeSafeCrashFailure({
        reporter,
        operation: 'authentication',
        surface: 'onboarding',
        action: async () => {
          throw cancelled;
        },
      }),
    ).rejects.toBe(cancelled);
    expect(mockedRecordError).not.toHaveBeenCalled();
    expect(
      classifySafeCrashError({ code: 'functions/deadline-exceeded' }),
    ).toBe('timeout');
    expect(classifySafeCrashError({ code: 'secret-token' })).toBe('unknown');
    expect(
      classifySafeCrashError({
        code: 'functions/network-request-failed/user@example.com',
      }),
    ).toBe('unknown');

    const abortError = new Error('cancelled');
    abortError.name = 'AbortError';
    expect(classifySafeCrashError(abortError)).toBe('cancelled');

    const nameGetter = jest.fn(() => {
      throw new Error('getter-secret-token');
    });
    const accessorError = Object.defineProperty({}, 'name', {
      get: nameGetter,
    });
    expect(classifySafeCrashError(accessorError)).toBe('unknown');
    expect(nameGetter).not.toHaveBeenCalled();

    const hostileProxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('prototype-secret-token');
        },
      },
    );
    expect(classifySafeCrashError(hostileProxy)).toBe('unknown');
  });
});
