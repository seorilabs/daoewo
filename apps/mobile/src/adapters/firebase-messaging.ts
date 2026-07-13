import {
  deleteToken,
  getMessaging,
  getToken,
  onMessage,
  onTokenRefresh,
  registerDeviceForRemoteMessages,
  requestPermission,
  setAutoInitEnabled,
  type Messaging,
} from '@react-native-firebase/messaging';

export interface NotificationInstallationRegistration {
  readonly deviceId: string;
  readonly fcmToken: string;
  readonly platform: 'android' | 'ios';
  readonly locale: string;
  readonly appVersion: string;
  readonly buildNumber: string;
}

export interface NotificationInstallationTransport {
  registerNotificationInstallation(
    input: NotificationInstallationRegistration,
  ): Promise<{ readonly registered: true }>;
  unregisterNotificationInstallation(input: {
    readonly deviceId: string;
  }): Promise<{ readonly unregistered: true }>;
}

export interface MessagingAccountContext {
  readonly uid: string;
  readonly epoch: number;
}

export interface MessagingRegistrationMetadata {
  readonly platform: 'android' | 'ios';
  readonly locale: string;
  readonly appVersion: string;
  readonly buildNumber: string;
}

export interface FirebaseMessagingSdk {
  getMessaging(): Messaging;
  requestPermission(messaging: Messaging): Promise<number>;
  setAutoInitEnabled(messaging: Messaging, enabled: boolean): Promise<void>;
  registerDeviceForRemoteMessages(messaging: Messaging): Promise<void>;
  getToken(messaging: Messaging): Promise<string>;
  onMessage(
    messaging: Messaging,
    listener: (message: ForegroundMessagingMessage) => void,
  ): () => void;
  onTokenRefresh(
    messaging: Messaging,
    listener: (token: string) => void,
  ): () => void;
  deleteToken(messaging: Messaging): Promise<void>;
}

export type DeckReadyMessagingState = 'disabled' | 'enabled';
export type DeckUpdateMessageKind = 'deck-ready' | 'catalog-published';

export interface ForegroundMessagingMessage {
  readonly data?: { readonly kind?: string };
}

export interface DeckReadyMessagingAdapter {
  /** firebase.json과 별개로 auto-init=false를 한 번 더 보장한다. */
  initialize(): Promise<void>;
  enable(): Promise<{ readonly enabled: true }>;
  /** opt-out, logout, account switch가 공유하는 멱등 cleanup 경계다. */
  disable(): Promise<{ readonly disabled: true }>;
  getState(): DeckReadyMessagingState;
}

export type DeckReadyMessagingErrorCode =
  | 'remote-config-disabled'
  | 'account-unavailable'
  | 'account-changed'
  | 'permission-denied'
  | 'configuration-invalid'
  | 'enable-failed';

const ERROR_MESSAGES: Readonly<Record<DeckReadyMessagingErrorCode, string>> =
  Object.freeze({
    'remote-config-disabled': '덱 준비 알림을 현재 사용할 수 없어요.',
    'account-unavailable': '알림을 연결할 현재 계정을 확인할 수 없어요.',
    'account-changed': '계정이 변경되어 알림 연결을 중단했어요.',
    'permission-denied': '알림 권한이 허용되지 않았어요.',
    'configuration-invalid': '알림 앱 설정을 확인할 수 없어요.',
    'enable-failed': '알림 연결을 완료하지 못했어요.',
  });

export class DeckReadyMessagingError extends Error {
  constructor(readonly code: DeckReadyMessagingErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'DeckReadyMessagingError';
  }
}

const DEFAULT_FIREBASE_MESSAGING_SDK: FirebaseMessagingSdk = Object.freeze({
  getMessaging,
  requestPermission,
  setAutoInitEnabled,
  registerDeviceForRemoteMessages,
  getToken,
  onMessage: (
    messaging: Messaging,
    listener: (message: ForegroundMessagingMessage) => void,
  ) =>
    onMessage(messaging, message =>
      listener({
        data: {
          kind:
            typeof message.data?.kind === 'string'
              ? message.data.kind
              : undefined,
        },
      }),
    ),
  onTokenRefresh,
  deleteToken,
});

const MIN_DEVICE_ID_LENGTH = 16;
const MAX_DEVICE_ID_LENGTH = 256;
const MIN_FCM_TOKEN_LENGTH = 16;
const MAX_FCM_TOKEN_LENGTH = 4_096;
const GRANTED_PERMISSION_STATUSES: ReadonlySet<number> = new Set([1, 2, 3]);
const MAX_TOKEN_REFRESH_RETRY_DELAY_MS = 60_000;
const MAX_TOKEN_REFRESH_RETRY_COUNT = 5;

export const TOKEN_REFRESH_RETRY_DELAYS_MS = Object.freeze([
  1_000, 3_000, 10_000,
] as const);

export function createDeckReadyMessagingAdapter(input: {
  readonly transport: NotificationInstallationTransport;
  readonly getCurrentAccount: () => MessagingAccountContext | null;
  readonly getDeviceId: () => Promise<string>;
  readonly getRemoteConfigSnapshot: () => {
    readonly mobile_deck_updates_push_enabled: boolean;
  };
  readonly metadata: MessagingRegistrationMetadata;
  /** Android 13의 POST_NOTIFICATIONS까지 포함한 app-local 권한 경계다. */
  readonly requestNotificationPermission?: () => Promise<boolean>;
  /** raw RemoteMessage를 UI에 넘기지 않고 허용된 종류만 고정 문구로 표시한다. */
  readonly showForegroundNotification?: (kind: DeckUpdateMessageKind) => void;
  /** 테스트에서 timer를 기다리지 않고 bounded retry를 검증하기 위한 주입 경계다. */
  readonly tokenRefreshRetryDelaysMs?: readonly number[];
  readonly waitForTokenRefreshRetry?: (delayMs: number) => Promise<void>;
  /** token refresh 재시도를 모두 소진해 transport를 정리한 경우에만 호출한다. */
  readonly onTokenRefreshRetriesExhausted?: () => void | Promise<void>;
  readonly sdk?: FirebaseMessagingSdk;
}): DeckReadyMessagingAdapter {
  const sdk = input.sdk ?? DEFAULT_FIREBASE_MESSAGING_SDK;
  const metadata = normalizeRegistrationMetadata(input.metadata);
  const tokenRefreshRetryDelays = normalizeTokenRefreshRetryDelays(
    input.tokenRefreshRetryDelaysMs,
  );
  let messagingInstance: Messaging | null = null;
  let state: DeckReadyMessagingState = 'disabled';
  let activeAccount: MessagingAccountContext | null = null;
  let activeDeviceId: string | null = null;
  let unsubscribeTokenRefresh: (() => void) | null = null;
  let unsubscribeForegroundMessage: (() => void) | null = null;
  let activationEpoch = 0;
  let autoInitKnownDisabled = false;
  let cleanupCompleted = false;
  let operationQueue: Promise<void> = Promise.resolve();
  let retryCancellationEpoch = 0;
  const pendingRetryCancellations = new Set<() => void>();

  function messaging(): Messaging {
    messagingInstance ??= sdk.getMessaging();
    return messagingInstance;
  }

  function enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = operationQueue.then(operation);
    operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function ensureAutoInitDisabled(): Promise<void> {
    if (autoInitKnownDisabled || state === 'enabled') {
      return;
    }
    try {
      await sdk.setAutoInitEnabled(messaging(), false);
      autoInitKnownDisabled = true;
    } catch {
      throw new DeckReadyMessagingError('enable-failed');
    }
  }

  function cancelTokenRefreshRetries(): void {
    retryCancellationEpoch += 1;
    for (const cancel of [...pendingRetryCancellations]) {
      cancel();
    }
  }

  function waitForTokenRefreshRetry(
    delayMs: number,
    expectedCancellationEpoch: number,
  ): Promise<boolean> {
    if (retryCancellationEpoch !== expectedCancellationEpoch) {
      return Promise.resolve(false);
    }
    return new Promise(resolve => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (elapsed: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== null) {
          clearTimeout(timer);
        }
        pendingRetryCancellations.delete(cancel);
        resolve(elapsed);
      };
      const cancel = () => finish(false);
      pendingRetryCancellations.add(cancel);

      if (input.waitForTokenRefreshRetry === undefined) {
        timer = setTimeout(() => finish(true), delayMs);
        return;
      }
      Promise.resolve()
        .then(() => input.waitForTokenRefreshRetry!(delayMs))
        .then(
          () => finish(true),
          () => finish(true),
        );
    });
  }

  async function cleanup(): Promise<void> {
    cancelTokenRefreshRetries();
    let deviceId = activeDeviceId;
    if (deviceId === null) {
      try {
        const persistedDeviceId = await input.getDeviceId();
        if (validDeviceId(persistedDeviceId)) {
          deviceId = persistedDeviceId;
        }
      } catch {
        // persisted installation을 읽지 못해도 native token 정리는 계속한다.
      }
    }
    const unsubscribe = unsubscribeTokenRefresh;
    const unsubscribeForeground = unsubscribeForegroundMessage;
    let succeeded = true;
    activationEpoch += 1;
    state = 'disabled';
    activeAccount = null;
    activeDeviceId = null;
    unsubscribeTokenRefresh = null;
    unsubscribeForegroundMessage = null;

    // Auth/App Check가 아직 살아 있는 동안 server binding부터 제거한다.
    if (deviceId !== null) {
      try {
        await input.transport.unregisterNotificationInstallation({ deviceId });
      } catch {
        // logout/opt-out을 막지 않는다. token 삭제로 stale binding을 무효화한다.
        succeeded = false;
      }
    }

    if (unsubscribe !== null) {
      try {
        unsubscribe();
      } catch {
        // 이미 해제된 listener도 멱등 cleanup으로 취급한다.
        succeeded = false;
      }
    }

    if (unsubscribeForeground !== null) {
      try {
        unsubscribeForeground();
      } catch {
        succeeded = false;
      }
    }

    let target: Messaging | null = null;
    try {
      target = messaging();
    } catch {
      // Firebase app이 없으면 아래 native cleanup을 수행할 수 없다.
      succeeded = false;
    }

    if (target !== null) {
      try {
        await sdk.deleteToken(target);
      } catch {
        // server unregister와 별개로 best-effort 무효화를 시도한다.
        succeeded = false;
      }
      try {
        await sdk.setAutoInitEnabled(target, false);
        autoInitKnownDisabled = true;
      } catch {
        autoInitKnownDisabled = false;
        succeeded = false;
      }
    }
    cleanupCompleted = succeeded;
  }

  async function disableInternal(): Promise<{ readonly disabled: true }> {
    if (state === 'disabled' && cleanupCompleted) {
      return { disabled: true };
    }
    await cleanup();
    return { disabled: true };
  }

  function currentAccount(): MessagingAccountContext | null {
    try {
      const account = input.getCurrentAccount();
      if (
        account === null ||
        account.uid.trim().length === 0 ||
        !Number.isSafeInteger(account.epoch) ||
        account.epoch < 0
      ) {
        return null;
      }
      return account;
    } catch {
      return null;
    }
  }

  function accountMatches(expected: MessagingAccountContext): boolean {
    const current = currentAccount();
    return (
      current !== null &&
      current.uid === expected.uid &&
      current.epoch === expected.epoch
    );
  }

  function remoteConfigAllowsDeckReadyPush(): boolean {
    try {
      return (
        input.getRemoteConfigSnapshot().mobile_deck_updates_push_enabled ===
        true
      );
    } catch {
      return false;
    }
  }

  async function registerToken(
    account: MessagingAccountContext,
    deviceId: string,
    fcmToken: string,
    expectedActivationEpoch: number,
  ): Promise<void> {
    if (
      activationEpoch !== expectedActivationEpoch ||
      !accountMatches(account)
    ) {
      throw new DeckReadyMessagingError('account-changed');
    }
    if (!remoteConfigAllowsDeckReadyPush()) {
      throw new DeckReadyMessagingError('remote-config-disabled');
    }
    if (!validFcmToken(fcmToken)) {
      throw new DeckReadyMessagingError('enable-failed');
    }

    await input.transport.registerNotificationInstallation({
      deviceId,
      fcmToken,
      platform: metadata!.platform,
      locale: metadata!.locale,
      appVersion: metadata!.appVersion,
      buildNumber: metadata!.buildNumber,
    });

    if (
      activationEpoch !== expectedActivationEpoch ||
      !accountMatches(account)
    ) {
      throw new DeckReadyMessagingError('account-changed');
    }
  }

  async function handleTokenRefresh(
    fcmToken: string,
    account: MessagingAccountContext,
    expectedActivationEpoch: number,
    expectedCancellationEpoch: number,
  ): Promise<void> {
    const deviceId = activeDeviceId;
    if (deviceId === null) {
      return;
    }

    for (let attempt = 0; ; attempt += 1) {
      if (
        state !== 'enabled' ||
        activationEpoch !== expectedActivationEpoch ||
        retryCancellationEpoch !== expectedCancellationEpoch ||
        !accountMatches(account)
      ) {
        return;
      }
      try {
        await registerToken(
          account,
          deviceId,
          fcmToken,
          expectedActivationEpoch,
        );
        return;
      } catch (error) {
        if (
          error instanceof DeckReadyMessagingError ||
          retryCancellationEpoch !== expectedCancellationEpoch ||
          state !== 'enabled'
        ) {
          await cleanup();
          return;
        }
        const retryDelayMs = tokenRefreshRetryDelays[attempt];
        if (retryDelayMs === undefined) {
          await cleanup();
          try {
            await input.onTokenRefreshRetriesExhausted?.();
          } catch {
            // 제품 상태 수렴 callback 실패가 transport cleanup을 되돌리지 않게 한다.
          }
          return;
        }
        const elapsed = await waitForTokenRefreshRetry(
          retryDelayMs,
          expectedCancellationEpoch,
        );
        if (!elapsed) {
          return;
        }
      }
    }
  }

  function handleForegroundMessage(
    message: ForegroundMessagingMessage,
    account: MessagingAccountContext,
    expectedActivationEpoch: number,
  ): void {
    if (
      state !== 'enabled' ||
      activationEpoch !== expectedActivationEpoch ||
      !accountMatches(account)
    ) {
      return;
    }
    const kind = message.data?.kind;
    if (kind !== 'deck-ready' && kind !== 'catalog-published') {
      return;
    }
    try {
      input.showForegroundNotification?.(kind);
    } catch {
      // foreground 표시 실패가 token lifecycle을 끊지 않게 한다.
    }
  }

  async function enableInternal(): Promise<{ readonly enabled: true }> {
    if (!remoteConfigAllowsDeckReadyPush()) {
      await disableInternal();
      throw new DeckReadyMessagingError('remote-config-disabled');
    }

    const account = currentAccount();
    if (account === null) {
      await disableInternal();
      throw new DeckReadyMessagingError('account-unavailable');
    }
    if (
      state === 'enabled' &&
      activeAccount !== null &&
      accountMatches(activeAccount)
    ) {
      return { enabled: true };
    }
    if (metadata === null) {
      await disableInternal();
      throw new DeckReadyMessagingError('configuration-invalid');
    }
    if (state === 'enabled' || activeDeviceId !== null) {
      await disableInternal();
    }

    await ensureAutoInitDisabled();
    const target = messaging();
    const expectedActivationEpoch = ++activationEpoch;
    cleanupCompleted = false;
    try {
      const permissionGranted = input.requestNotificationPermission
        ? await input.requestNotificationPermission()
        : GRANTED_PERMISSION_STATUSES.has(await sdk.requestPermission(target));
      if (!permissionGranted) {
        throw new DeckReadyMessagingError('permission-denied');
      }
      if (!accountMatches(account)) {
        throw new DeckReadyMessagingError('account-changed');
      }

      const deviceId = await input.getDeviceId();
      if (!validDeviceId(deviceId)) {
        throw new DeckReadyMessagingError('configuration-invalid');
      }
      activeDeviceId = deviceId;

      await sdk.setAutoInitEnabled(target, true);
      autoInitKnownDisabled = false;
      await sdk.registerDeviceForRemoteMessages(target);
      if (!accountMatches(account)) {
        throw new DeckReadyMessagingError('account-changed');
      }

      const fcmToken = await sdk.getToken(target);
      await registerToken(account, deviceId, fcmToken, expectedActivationEpoch);

      activeAccount = account;
      state = 'enabled';
      unsubscribeForegroundMessage = sdk.onMessage(target, message =>
        handleForegroundMessage(message, account, expectedActivationEpoch),
      );
      unsubscribeTokenRefresh = sdk.onTokenRefresh(target, refreshedToken => {
        const expectedCancellationEpoch = retryCancellationEpoch;
        enqueue(() =>
          handleTokenRefresh(
            refreshedToken,
            account,
            expectedActivationEpoch,
            expectedCancellationEpoch,
          ),
        ).catch(() => undefined);
      });
      return { enabled: true };
    } catch (error) {
      await cleanup();
      if (error instanceof DeckReadyMessagingError) {
        throw error;
      }
      throw new DeckReadyMessagingError('enable-failed');
    }
  }

  return {
    initialize() {
      return enqueue(ensureAutoInitDisabled);
    },
    enable() {
      return enqueue(enableInternal);
    },
    disable() {
      cancelTokenRefreshRetries();
      return enqueue(disableInternal);
    },
    getState() {
      return state;
    },
  };
}

function normalizeTokenRefreshRetryDelays(
  values: readonly number[] | undefined,
): readonly number[] {
  if (values === undefined) {
    return TOKEN_REFRESH_RETRY_DELAYS_MS;
  }
  if (
    values.length > MAX_TOKEN_REFRESH_RETRY_COUNT ||
    values.some(
      value =>
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > MAX_TOKEN_REFRESH_RETRY_DELAY_MS,
    )
  ) {
    return TOKEN_REFRESH_RETRY_DELAYS_MS;
  }
  return Object.freeze([...values]);
}

export function normalizeRegistrationMetadata(
  value: MessagingRegistrationMetadata,
): MessagingRegistrationMetadata | null {
  if (value.platform !== 'android' && value.platform !== 'ios') {
    return null;
  }
  const locale = normalizeLocale(value.locale);
  const appVersion = value.appVersion.trim();
  const buildNumber = value.buildNumber.trim();
  if (
    locale === null ||
    !/^\d+(?:\.\d+){0,3}(?:-[A-Za-z0-9.-]+)?$/.test(appVersion) ||
    appVersion.length > 40 ||
    !/^\d+(?:\.\d+){0,2}$/.test(buildNumber) ||
    buildNumber.length > 18
  ) {
    return null;
  }
  return Object.freeze({
    platform: value.platform,
    locale,
    appVersion,
    buildNumber,
  });
}

function normalizeLocale(value: string): string | null {
  const candidate = value.trim().replace(/_/g, '-');
  if (
    candidate.length < 2 ||
    candidate.length > 35 ||
    !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(candidate)
  ) {
    return null;
  }
  return candidate
    .split('-')
    .map((part, index) => {
      if (index === 0) {
        return part.toLowerCase();
      }
      return part.length === 2 || /^\d{3}$/.test(part)
        ? part.toUpperCase()
        : part;
    })
    .join('-');
}

function validDeviceId(value: string): boolean {
  return (
    value.length >= MIN_DEVICE_ID_LENGTH &&
    value.length <= MAX_DEVICE_ID_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function validFcmToken(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length >= MIN_FCM_TOKEN_LENGTH &&
    value.length <= MAX_FCM_TOKEN_LENGTH
  );
}
