import type { Messaging } from '@react-native-firebase/messaging';

import {
  createDeckReadyMessagingAdapter,
  DeckReadyMessagingError,
  normalizeRegistrationMetadata,
  type FirebaseMessagingSdk,
  type MessagingAccountContext,
  type NotificationInstallationRegistration,
  type NotificationInstallationTransport,
} from '../src/adapters/firebase-messaging';

jest.mock('@react-native-firebase/messaging', () => ({
  deleteToken: jest.fn(),
  getMessaging: jest.fn(),
  getToken: jest.fn(),
  onMessage: jest.fn(),
  onTokenRefresh: jest.fn(),
  registerDeviceForRemoteMessages: jest.fn(),
  requestPermission: jest.fn(),
  setAutoInitEnabled: jest.fn(),
}));

const DEVICE_ID = 'device_installation_1234';
const INITIAL_TOKEN = 'fcm-token-initial-1234567890';
const REFRESHED_TOKEN = 'fcm-token-refreshed-1234567890';

interface Harness {
  readonly adapter: ReturnType<typeof createDeckReadyMessagingAdapter>;
  readonly sdk: jest.Mocked<FirebaseMessagingSdk>;
  readonly transport: jest.Mocked<NotificationInstallationTransport>;
  readonly order: string[];
  readonly unsubscribe: jest.Mock;
  readonly showForegroundNotification: jest.Mock;
  getAccount(): MessagingAccountContext | null;
  setAccount(account: MessagingAccountContext | null): void;
  setRemoteEnabled(enabled: boolean): void;
  latestRefreshListener(): ((token: string) => void) | null;
  latestForegroundListener():
    | ((message: { readonly data?: Readonly<Record<string, string>> }) => void)
    | null;
}

function createHarness(input?: {
  readonly tokenRefreshRetryDelaysMs?: readonly number[];
  readonly waitForTokenRefreshRetry?: (delayMs: number) => Promise<void>;
  readonly onTokenRefreshRetriesExhausted?: () => void | Promise<void>;
}): Harness {
  const messaging = {} as Messaging;
  const order: string[] = [];
  let account: MessagingAccountContext | null = { uid: 'user-a', epoch: 1 };
  let remoteEnabled = true;
  let refreshListener: ((token: string) => void) | null = null;
  let foregroundListener:
    | ((message: { readonly data?: Readonly<Record<string, string>> }) => void)
    | null = null;
  const showForegroundNotification = jest.fn();
  const unsubscribe = jest.fn(() => {
    order.push('listener-unsubscribe');
    refreshListener = null;
  });
  const unsubscribeForeground = jest.fn(() => {
    order.push('foreground-unsubscribe');
    foregroundListener = null;
  });
  const sdk: jest.Mocked<FirebaseMessagingSdk> = {
    getMessaging: jest.fn(() => messaging),
    requestPermission: jest.fn(async (_target: Messaging) => {
      order.push('permission');
      return 1;
    }),
    setAutoInitEnabled: jest.fn(async (_target, enabled) => {
      order.push(`auto-init:${enabled}`);
    }),
    registerDeviceForRemoteMessages: jest.fn(async (_target: Messaging) => {
      order.push('device-register');
    }),
    getToken: jest.fn(async (_target: Messaging) => {
      order.push('get-token');
      return INITIAL_TOKEN;
    }),
    onMessage: jest.fn((_target, listener) => {
      order.push('foreground-subscribe');
      foregroundListener = listener;
      return unsubscribeForeground;
    }),
    onTokenRefresh: jest.fn((_target, listener) => {
      order.push('listener-subscribe');
      refreshListener = listener;
      return unsubscribe;
    }),
    deleteToken: jest.fn(async (_target: Messaging) => {
      order.push('delete-token');
    }),
  };
  const transport: jest.Mocked<NotificationInstallationTransport> = {
    registerNotificationInstallation: jest.fn(
      async (_input: NotificationInstallationRegistration) => {
        order.push('server-register');
        return { registered: true as const };
      },
    ),
    unregisterNotificationInstallation: jest.fn(
      async (_input: { readonly deviceId: string }) => {
        order.push('server-unregister');
        return { unregistered: true as const };
      },
    ),
  };
  const adapter = createDeckReadyMessagingAdapter({
    sdk,
    transport,
    getCurrentAccount: () => account,
    getDeviceId: async () => DEVICE_ID,
    getRemoteConfigSnapshot: () => ({
      mobile_deck_updates_push_enabled: remoteEnabled,
    }),
    metadata: {
      platform: 'android',
      locale: 'ko_kr',
      appVersion: '0.1.0',
      buildNumber: '17',
    },
    showForegroundNotification,
    ...(input?.tokenRefreshRetryDelaysMs === undefined
      ? {}
      : { tokenRefreshRetryDelaysMs: input.tokenRefreshRetryDelaysMs }),
    ...(input?.waitForTokenRefreshRetry === undefined
      ? {}
      : { waitForTokenRefreshRetry: input.waitForTokenRefreshRetry }),
    ...(input?.onTokenRefreshRetriesExhausted === undefined
      ? {}
      : {
          onTokenRefreshRetriesExhausted: input.onTokenRefreshRetriesExhausted,
        }),
  });
  return {
    adapter,
    sdk,
    transport,
    order,
    unsubscribe,
    showForegroundNotification,
    getAccount: () => account,
    setAccount(next) {
      account = next;
    },
    setRemoteEnabled(enabled) {
      remoteEnabled = enabled;
    },
    latestRefreshListener: () => refreshListener,
    latestForegroundListener: () => foregroundListener,
  };
}

describe('deck-ready Firebase Messaging adapter', () => {
  it('initialize는 messaging auto-init을 명시적으로 false로 고정한다', async () => {
    const harness = createHarness();

    await expect(harness.adapter.initialize()).resolves.toBeUndefined();
    await expect(harness.adapter.initialize()).resolves.toBeUndefined();

    expect(harness.sdk.setAutoInitEnabled).toHaveBeenCalledTimes(1);
    expect(harness.sdk.setAutoInitEnabled).toHaveBeenCalledWith(
      expect.anything(),
      false,
    );
    expect(harness.adapter.getState()).toBe('disabled');
  });

  it('cold start의 저장된 OFF도 과거 server binding과 token을 정리한다', async () => {
    const harness = createHarness();
    await harness.adapter.initialize();
    harness.order.splice(0);

    await expect(harness.adapter.disable()).resolves.toEqual({
      disabled: true,
    });

    expect(harness.order).toEqual([
      'server-unregister',
      'delete-token',
      'auto-init:false',
    ]);
    expect(
      harness.transport.unregisterNotificationInstallation,
    ).toHaveBeenCalledWith({ deviceId: DEVICE_ID });
  });

  it('권한→auto-init→token→server 순서와 allowlisted callable 계약으로 등록한다', async () => {
    const harness = createHarness();

    await expect(harness.adapter.enable()).resolves.toEqual({ enabled: true });

    expect(harness.order).toEqual([
      'auto-init:false',
      'permission',
      'auto-init:true',
      'device-register',
      'get-token',
      'server-register',
      'foreground-subscribe',
      'listener-subscribe',
    ]);
    expect(
      harness.transport.registerNotificationInstallation,
    ).toHaveBeenCalledWith({
      deviceId: DEVICE_ID,
      fcmToken: INITIAL_TOKEN,
      platform: 'android',
      locale: 'ko-KR',
      appVersion: '0.1.0',
      buildNumber: '17',
    });
    expect(await harness.adapter.enable()).toEqual({ enabled: true });
    expect(
      harness.transport.registerNotificationInstallation,
    ).toHaveBeenCalledTimes(1);
    expect(harness.adapter.getState()).toBe('enabled');
  });

  it('Remote Config false는 enable을 거부하고 기존 opt-in도 cleanup한다', async () => {
    const harness = createHarness();
    await harness.adapter.enable();
    harness.setRemoteEnabled(false);

    await expect(harness.adapter.enable()).rejects.toMatchObject({
      code: 'remote-config-disabled',
    });

    expect(
      harness.transport.unregisterNotificationInstallation,
    ).toHaveBeenCalledWith({ deviceId: DEVICE_ID });
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.sdk.deleteToken).toHaveBeenCalledTimes(1);
    expect(harness.sdk.setAutoInitEnabled).toHaveBeenLastCalledWith(
      expect.anything(),
      false,
    );
    expect(harness.adapter.getState()).toBe('disabled');
  });

  it('permission denied는 token/server 호출 없이 disabled로 rollback한다', async () => {
    const harness = createHarness();
    harness.sdk.requestPermission.mockResolvedValueOnce(0);

    await expect(harness.adapter.enable()).rejects.toMatchObject({
      code: 'permission-denied',
    });

    expect(harness.sdk.getToken).not.toHaveBeenCalled();
    expect(
      harness.transport.registerNotificationInstallation,
    ).not.toHaveBeenCalled();
    expect(harness.sdk.deleteToken).toHaveBeenCalledTimes(1);
    expect(harness.sdk.setAutoInitEnabled).toHaveBeenLastCalledWith(
      expect.anything(),
      false,
    );
    expect(harness.adapter.getState()).toBe('disabled');
  });

  it('app-local 권한 requester가 있으면 Android 13 권한 경계를 우선 사용한다', async () => {
    const harness = createHarness();
    const requestNotificationPermission = jest.fn(async () => true);
    const adapter = createDeckReadyMessagingAdapter({
      sdk: harness.sdk,
      transport: harness.transport,
      getCurrentAccount: harness.getAccount,
      getDeviceId: async () => DEVICE_ID,
      getRemoteConfigSnapshot: () => ({
        mobile_deck_updates_push_enabled: true,
      }),
      metadata: {
        platform: 'android',
        locale: 'ko-KR',
        appVersion: '0.1.0',
        buildNumber: '1000',
      },
      requestNotificationPermission,
    });

    await expect(adapter.enable()).resolves.toEqual({ enabled: true });

    expect(requestNotificationPermission).toHaveBeenCalledTimes(1);
    expect(harness.sdk.requestPermission).not.toHaveBeenCalled();
  });

  it('server 등록 실패는 원본 UID/token을 노출하지 않고 전체 rollback한다', async () => {
    const harness = createHarness();
    harness.transport.registerNotificationInstallation.mockRejectedValueOnce(
      new Error(`uid=user-a token=${INITIAL_TOKEN}`),
    );

    let failure: unknown;
    try {
      await harness.adapter.enable();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(DeckReadyMessagingError);
    expect(failure).toMatchObject({ code: 'enable-failed' });
    expect(JSON.stringify(failure)).not.toMatch(/user-a|fcm-token/i);
    expect(
      harness.transport.unregisterNotificationInstallation,
    ).toHaveBeenCalledWith({ deviceId: DEVICE_ID });
    expect(harness.sdk.deleteToken).toHaveBeenCalledTimes(1);
    expect(harness.sdk.setAutoInitEnabled).toHaveBeenLastCalledWith(
      expect.anything(),
      false,
    );
    expect(harness.adapter.getState()).toBe('disabled');
  });

  it('foreground listener 등록 실패도 server installation과 token을 전체 rollback한다', async () => {
    const harness = createHarness();
    harness.sdk.onMessage.mockImplementationOnce(() => {
      throw new Error('listener unavailable');
    });

    await expect(harness.adapter.enable()).rejects.toMatchObject({
      code: 'enable-failed',
    });

    expect(
      harness.transport.unregisterNotificationInstallation,
    ).toHaveBeenCalledWith({ deviceId: DEVICE_ID });
    expect(harness.sdk.deleteToken).toHaveBeenCalledTimes(1);
    expect(harness.adapter.getState()).toBe('disabled');
  });

  it('token refresh는 같은 UID/epoch에서만 새 token을 재등록한다', async () => {
    const harness = createHarness();
    await harness.adapter.enable();
    const listener = harness.latestRefreshListener();
    expect(listener).not.toBeNull();
    harness.transport.registerNotificationInstallation.mockClear();

    listener!(REFRESHED_TOKEN);
    await harness.adapter.enable();

    expect(
      harness.transport.registerNotificationInstallation,
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.transport.registerNotificationInstallation,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: DEVICE_ID,
        fcmToken: REFRESHED_TOKEN,
      }),
    );
  });

  it('token refresh의 일시적 전송 실패를 bounded delay로 재시도한다', async () => {
    const waited: number[] = [];
    const harness = createHarness({
      tokenRefreshRetryDelaysMs: [10, 20, 30],
      async waitForTokenRefreshRetry(delayMs) {
        waited.push(delayMs);
      },
    });
    await harness.adapter.enable();
    const listener = harness.latestRefreshListener();
    harness.transport.registerNotificationInstallation.mockClear();
    let attempt = 0;
    harness.transport.registerNotificationInstallation.mockImplementation(
      async () => {
        attempt += 1;
        if (attempt < 3) {
          throw new Error('temporary network failure');
        }
        return { registered: true as const };
      },
    );

    listener!(REFRESHED_TOKEN);
    await harness.adapter.enable();

    expect(
      harness.transport.registerNotificationInstallation,
    ).toHaveBeenCalledTimes(3);
    expect(waited).toEqual([10, 20]);
    expect(harness.adapter.getState()).toBe('enabled');
    expect(harness.sdk.deleteToken).not.toHaveBeenCalled();
  });

  it('token refresh retry 대기 중 disable은 추가 등록 없이 즉시 취소한다', async () => {
    let finishUnderlyingWait: (() => void) | undefined;
    let markRetryStarted: (() => void) | undefined;
    const retryStarted = new Promise<void>(resolve => {
      markRetryStarted = resolve;
    });
    const harness = createHarness({
      tokenRefreshRetryDelaysMs: [30_000, 30_000],
      waitForTokenRefreshRetry: async () => {
        markRetryStarted?.();
        await new Promise<void>(resolve => {
          finishUnderlyingWait = resolve;
        });
      },
    });
    await harness.adapter.enable();
    const listener = harness.latestRefreshListener();
    harness.transport.registerNotificationInstallation.mockClear();
    harness.transport.registerNotificationInstallation.mockRejectedValue(
      new Error('offline'),
    );

    listener!(REFRESHED_TOKEN);
    await retryStarted;
    await expect(harness.adapter.disable()).resolves.toEqual({
      disabled: true,
    });
    finishUnderlyingWait?.();
    await Promise.resolve();

    expect(
      harness.transport.registerNotificationInstallation,
    ).toHaveBeenCalledTimes(1);
    expect(harness.adapter.getState()).toBe('disabled');
  });

  it('token refresh는 설정된 재시도 횟수를 넘으면 fail-closed cleanup한다', async () => {
    const onTokenRefreshRetriesExhausted = jest.fn();
    let markCleanupStarted: (() => void) | undefined;
    const cleanupStarted = new Promise<void>(resolve => {
      markCleanupStarted = resolve;
    });
    const harness = createHarness({
      tokenRefreshRetryDelaysMs: [0, 0],
      waitForTokenRefreshRetry: async () => undefined,
      onTokenRefreshRetriesExhausted,
    });
    await harness.adapter.enable();
    const listener = harness.latestRefreshListener();
    harness.transport.registerNotificationInstallation.mockClear();
    harness.transport.registerNotificationInstallation.mockRejectedValue(
      new Error('offline'),
    );
    harness.transport.unregisterNotificationInstallation.mockImplementationOnce(
      async () => {
        markCleanupStarted?.();
        return { unregistered: true as const };
      },
    );

    listener!(REFRESHED_TOKEN);
    await cleanupStarted;
    await harness.adapter.disable();

    expect(
      harness.transport.registerNotificationInstallation,
    ).toHaveBeenCalledTimes(3);
    expect(harness.adapter.getState()).toBe('disabled');
    expect(harness.sdk.deleteToken).toHaveBeenCalledTimes(1);
    expect(onTokenRefreshRetriesExhausted).toHaveBeenCalledTimes(1);
  });

  it('foreground에서는 allowlisted kind만 고정 UI callback으로 전달한다', async () => {
    const harness = createHarness();
    await harness.adapter.enable();
    const listener = harness.latestForegroundListener();
    expect(listener).not.toBeNull();

    listener!({ data: { kind: 'deck-ready', uid: 'must-not-forward' } });
    listener!({ data: { kind: 'catalog-published', deckId: 'private' } });
    listener!({ data: { kind: 'unknown', token: INITIAL_TOKEN } });

    expect(harness.showForegroundNotification.mock.calls).toEqual([
      ['deck-ready'],
      ['catalog-published'],
    ]);
    expect(
      JSON.stringify(harness.showForegroundNotification.mock.calls),
    ).not.toMatch(/uid|deckId|token|private|fcm/i);
  });

  it.each([
    { uid: 'user-a', epoch: 2 },
    { uid: 'user-b', epoch: 1 },
  ])(
    'UID/epoch $uid/$epoch 이후 도착한 late token callback을 차단한다',
    async nextAccount => {
      const harness = createHarness();
      await harness.adapter.enable();
      const lateListener = harness.latestRefreshListener();
      harness.transport.registerNotificationInstallation.mockClear();
      harness.setAccount(nextAccount);

      lateListener!(REFRESHED_TOKEN);
      await harness.adapter.disable();

      expect(
        harness.transport.registerNotificationInstallation,
      ).not.toHaveBeenCalled();
    },
  );

  it('실패한 cleanup은 재시도하고 성공 뒤 반복 disable은 멱등 보장한다', async () => {
    const harness = createHarness();
    await harness.adapter.enable();
    harness.order.splice(0);
    harness.transport.unregisterNotificationInstallation.mockImplementationOnce(
      async () => {
        harness.order.push('server-unregister');
        throw new Error('offline');
      },
    );
    harness.sdk.deleteToken.mockImplementationOnce(async () => {
      harness.order.push('delete-token');
      throw new Error('offline');
    });

    await expect(harness.adapter.disable()).resolves.toEqual({
      disabled: true,
    });
    await expect(harness.adapter.disable()).resolves.toEqual({
      disabled: true,
    });
    await expect(harness.adapter.disable()).resolves.toEqual({
      disabled: true,
    });

    expect(harness.order).toEqual([
      'server-unregister',
      'listener-unsubscribe',
      'foreground-unsubscribe',
      'delete-token',
      'auto-init:false',
      'server-unregister',
      'delete-token',
      'auto-init:false',
    ]);
    expect(
      harness.transport.unregisterNotificationInstallation,
    ).toHaveBeenCalledTimes(2);
    expect(harness.sdk.deleteToken).toHaveBeenCalledTimes(2);
    expect(harness.sdk.setAutoInitEnabled).toHaveBeenLastCalledWith(
      expect.anything(),
      false,
    );
  });

  it('registration metadata는 platform/locale/version/build allowlist로 제한한다', () => {
    expect(
      normalizeRegistrationMetadata({
        platform: 'ios',
        locale: 'en_us',
        appVersion: '1.2.3-beta.1',
        buildNumber: '42',
      }),
    ).toEqual({
      platform: 'ios',
      locale: 'en-US',
      appVersion: '1.2.3-beta.1',
      buildNumber: '42',
    });
    expect(
      normalizeRegistrationMetadata({
        platform: 'android',
        locale: 'user@example.com',
        appVersion: 'token=secret',
        buildNumber: 'uid-1234',
      }),
    ).toBeNull();
  });
});
