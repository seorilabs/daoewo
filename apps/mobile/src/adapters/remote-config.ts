import {
  ensureInitialized,
  fetchAndActivate,
  getRemoteConfig,
  getValue,
  type RemoteConfig,
  type Value,
} from '@react-native-firebase/remote-config';

import remoteConfigDefaults from './remote-config-defaults.json';

export interface MobileRemoteConfigSnapshot {
  /** 클라이언트 카탈로그 캐시만 조정한다. 서버 전달 TTL이나 권한에는 사용하지 않는다. */
  readonly mobile_catalog_cache_ttl_minutes: number;
  /** 구현된 push 경로를 끌 수만 있는 client feature gate다. */
  readonly mobile_deck_updates_push_enabled: boolean;
}

/**
 * 이 allowlist에는 entitlement, Free/Pro 한도, receipt, App Check 같은 보안 권위 값을
 * 추가하지 않는다. 그런 값은 Functions와 store 검증 결과만 권위로 사용한다.
 */
export const MOBILE_REMOTE_CONFIG_DEFAULTS: Readonly<MobileRemoteConfigSnapshot> =
  Object.freeze({
    mobile_catalog_cache_ttl_minutes:
      remoteConfigDefaults.mobile_catalog_cache_ttl_minutes,
    mobile_deck_updates_push_enabled:
      remoteConfigDefaults.mobile_deck_updates_push_enabled,
  });

export const MOBILE_REMOTE_CONFIG_KEYS = Object.freeze([
  'mobile_catalog_cache_ttl_minutes',
  'mobile_deck_updates_push_enabled',
] as const);

export type MobileRemoteConfigKey = (typeof MOBILE_REMOTE_CONFIG_KEYS)[number];

export const MOBILE_REMOTE_CONFIG_FETCH_TIMEOUT_MS = 5_000;
export const MOBILE_REMOTE_CONFIG_MINIMUM_FETCH_INTERVAL_MS =
  12 * 60 * 60 * 1_000;

const MIN_CATALOG_CACHE_TTL_MINUTES = 5;
const MAX_CATALOG_CACHE_TTL_MINUTES = 24 * 60;
export interface MobileRemoteConfigAdapter {
  /** 마지막으로 activate된 cache를 읽는다. 네트워크 요청은 하지 않는다. */
  initialize(): Promise<MobileRemoteConfigSnapshot>;
  /** fetch/activate 실패 시 마지막 검증 snapshot 또는 local defaults를 유지한다. */
  refresh(): Promise<MobileRemoteConfigSnapshot>;
  getSnapshot(): MobileRemoteConfigSnapshot;
}

export function createMobileRemoteConfigAdapter(): MobileRemoteConfigAdapter {
  let instance: RemoteConfig | null = null;
  let snapshot: MobileRemoteConfigSnapshot = MOBILE_REMOTE_CONFIG_DEFAULTS;

  function configuredInstance(): RemoteConfig {
    instance ??= getRemoteConfig();
    instance.defaultConfig = { ...MOBILE_REMOTE_CONFIG_DEFAULTS };
    instance.settings = {
      fetchTimeoutMillis: MOBILE_REMOTE_CONFIG_FETCH_TIMEOUT_MS,
      minimumFetchIntervalMillis:
        MOBILE_REMOTE_CONFIG_MINIMUM_FETCH_INTERVAL_MS,
    };
    return instance;
  }

  async function loadActivatedValues(): Promise<MobileRemoteConfigSnapshot> {
    try {
      const remoteConfig = configuredInstance();
      await ensureInitialized(remoteConfig);
      snapshot = readValidatedSnapshot(remoteConfig);
    } catch {
      // Firebase app/config가 없거나 cache가 손상된 빌드는 local defaults로 안전하게 닫는다.
    }
    return snapshot;
  }

  return {
    initialize: loadActivatedValues,
    async refresh() {
      const activated = await loadActivatedValues();
      try {
        const remoteConfig = configuredInstance();
        await fetchAndActivate(remoteConfig);
        snapshot = readValidatedSnapshot(remoteConfig);
      } catch {
        snapshot = activated;
      }
      return snapshot;
    },
    getSnapshot() {
      return snapshot;
    },
  };
}

function readValidatedSnapshot(
  remoteConfig: RemoteConfig,
): MobileRemoteConfigSnapshot {
  return Object.freeze({
    mobile_catalog_cache_ttl_minutes: readBoundedInteger(
      remoteConfig,
      'mobile_catalog_cache_ttl_minutes',
      MOBILE_REMOTE_CONFIG_DEFAULTS.mobile_catalog_cache_ttl_minutes,
      MIN_CATALOG_CACHE_TTL_MINUTES,
      MAX_CATALOG_CACHE_TTL_MINUTES,
    ),
    mobile_deck_updates_push_enabled: readBoolean(
      remoteConfig,
      'mobile_deck_updates_push_enabled',
      MOBILE_REMOTE_CONFIG_DEFAULTS.mobile_deck_updates_push_enabled,
    ),
  });
}

function readBoundedInteger(
  remoteConfig: RemoteConfig,
  key: MobileRemoteConfigKey,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = safeValue(remoteConfig, key);
  if (value === null) {
    return fallback;
  }
  const candidate = value.asNumber();
  return Number.isSafeInteger(candidate) &&
    candidate >= minimum &&
    candidate <= maximum
    ? candidate
    : fallback;
}

function readBoolean(
  remoteConfig: RemoteConfig,
  key: MobileRemoteConfigKey,
  fallback: boolean,
): boolean {
  const value = safeValue(remoteConfig, key);
  if (value === null) {
    return fallback;
  }
  const raw = value.asString().trim().toLowerCase();
  return raw === 'true' || raw === 'false' ? value.asBoolean() : fallback;
}

function safeValue(
  remoteConfig: RemoteConfig,
  key: MobileRemoteConfigKey,
): Value | null {
  try {
    const value = getValue(remoteConfig, key);
    return value.getSource() === 'static' ? null : value;
  } catch {
    return null;
  }
}
