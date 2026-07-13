import {
  ensureInitialized,
  fetchAndActivate,
  getRemoteConfig,
  getValue,
  type RemoteConfig,
  type Value,
} from '@react-native-firebase/remote-config';

import {
  createMobileRemoteConfigAdapter,
  MOBILE_REMOTE_CONFIG_DEFAULTS,
  MOBILE_REMOTE_CONFIG_FETCH_TIMEOUT_MS,
  MOBILE_REMOTE_CONFIG_KEYS,
  MOBILE_REMOTE_CONFIG_MINIMUM_FETCH_INTERVAL_MS,
} from '../src/adapters/remote-config';

jest.mock('@react-native-firebase/remote-config', () => ({
  ensureInitialized: jest.fn(),
  fetchAndActivate: jest.fn(),
  getRemoteConfig: jest.fn(),
  getValue: jest.fn(),
}));

const mockedEnsureInitialized = jest.mocked(ensureInitialized);
const mockedFetchAndActivate = jest.mocked(fetchAndActivate);
const mockedGetRemoteConfig = jest.mocked(getRemoteConfig);
const mockedGetValue = jest.mocked(getValue);

function remoteConfig(): RemoteConfig {
  return {
    defaultConfig: {},
    settings: { fetchTimeoutMillis: 0, minimumFetchIntervalMillis: 0 },
  } as RemoteConfig;
}

function remoteValue(
  raw: string,
  source: ReturnType<Value['getSource']> = 'remote',
): Value {
  return {
    getSource: () => source,
    asBoolean: () => raw.trim().toLowerCase() === 'true',
    asNumber: () => Number(raw),
    asString: () => raw,
  };
}

function values(input: Partial<Record<string, Value>> = {}) {
  mockedGetValue.mockImplementation((_instance, key) => {
    return input[key] ?? remoteValue('', 'static');
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetRemoteConfig.mockReturnValue(remoteConfig());
  mockedEnsureInitialized.mockResolvedValue(undefined);
  mockedFetchAndActivate.mockResolvedValue(false);
  values();
});

describe('mobile Remote Config adapter', () => {
  it('local defaults와 fetch 설정을 SDK에 먼저 고정한다', async () => {
    const instance = remoteConfig();
    mockedGetRemoteConfig.mockReturnValue(instance);

    const adapter = createMobileRemoteConfigAdapter();

    await expect(adapter.initialize()).resolves.toEqual(
      MOBILE_REMOTE_CONFIG_DEFAULTS,
    );
    expect(instance.defaultConfig).toEqual(MOBILE_REMOTE_CONFIG_DEFAULTS);
    expect(instance.settings).toEqual({
      fetchTimeoutMillis: MOBILE_REMOTE_CONFIG_FETCH_TIMEOUT_MS,
      minimumFetchIntervalMillis:
        MOBILE_REMOTE_CONFIG_MINIMUM_FETCH_INTERVAL_MS,
    });
  });

  it('allowlist의 유효한 remote 값만 typed snapshot으로 반영한다', async () => {
    values({
      mobile_catalog_cache_ttl_minutes: remoteValue('120'),
      mobile_deck_updates_push_enabled: remoteValue('true'),
    });

    const adapter = createMobileRemoteConfigAdapter();

    await expect(adapter.initialize()).resolves.toEqual({
      mobile_catalog_cache_ttl_minutes: 120,
      mobile_deck_updates_push_enabled: true,
    });
    expect(mockedGetValue.mock.calls.map(([, key]) => key)).toEqual(
      MOBILE_REMOTE_CONFIG_KEYS,
    );
  });

  it.each(['0', '4', '1441', '1.5', 'NaN'])(
    'catalog cache TTL %s는 범위 검증 실패 시 local default를 사용한다',
    async candidate => {
      values({ mobile_catalog_cache_ttl_minutes: remoteValue(candidate) });

      const snapshot = await createMobileRemoteConfigAdapter().initialize();

      expect(snapshot.mobile_catalog_cache_ttl_minutes).toBe(
        MOBILE_REMOTE_CONFIG_DEFAULTS.mobile_catalog_cache_ttl_minutes,
      );
    },
  );

  it('boolean의 임의 문자열을 허용하지 않는다', async () => {
    values({
      mobile_deck_updates_push_enabled: remoteValue('enabled'),
    });

    await expect(
      createMobileRemoteConfigAdapter().initialize(),
    ).resolves.toEqual(MOBILE_REMOTE_CONFIG_DEFAULTS);
  });

  it('fetch 실패 시 마지막 검증 snapshot을 유지하고 초기화 실패는 defaults로 닫는다', async () => {
    values({ mobile_catalog_cache_ttl_minutes: remoteValue('90') });
    const adapter = createMobileRemoteConfigAdapter();
    await adapter.initialize();
    mockedFetchAndActivate.mockRejectedValueOnce(new Error('offline'));

    await expect(adapter.refresh()).resolves.toMatchObject({
      mobile_catalog_cache_ttl_minutes: 90,
    });

    mockedGetRemoteConfig.mockImplementation(() => {
      throw new Error('Firebase app missing');
    });
    await expect(createMobileRemoteConfigAdapter().refresh()).resolves.toEqual(
      MOBILE_REMOTE_CONFIG_DEFAULTS,
    );
  });

  it('allowlist에 entitlement·Free/Pro·security 권위 key가 없다', () => {
    for (const key of MOBILE_REMOTE_CONFIG_KEYS) {
      expect(key).not.toMatch(
        /(?:^|_)(?:entitlement|free|pro|receipt|billing|security|app_?check)(?:_|$)/i,
      );
    }
  });
});
