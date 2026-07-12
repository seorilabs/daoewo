export interface FunctionsDeployConfig {
  region: string;
  googlePlayRtdnTopic: string;
  googlePlayProductIds: readonly string[];
  appStoreAppAppleId: number;
  appStoreProductIds: readonly string[];
  appStoreIapIssuerId: string;
  appStoreIapKeyId: string;
  tossFirebaseAppId: string;
  runtimeOverrides: Readonly<Record<string, string>>;
}

const OPTIONAL_RUNTIME_OVERRIDES = [
  "GOOGLE_PLAY_PACKAGE_NAME",
  "APP_STORE_BUNDLE_ID",
  "DECK_CHUNK_SIZE",
  "DECK_CHUNK_CACHE_ENTRIES",
  "FREE_DAILY_CARD_LIMIT",
  "FREE_ACTIVE_GOAL_LIMIT",
  "PREMIUM_USER_DAILY_SOFT_CAP",
  "PREMIUM_DEVICE_DAILY_SOFT_CAP",
  "GOAL_RESET_COOLDOWN_HOURS",
  "PREMIUM_WINDOW_TTL_HOURS",
  "FREE_WINDOW_TTL_HOURS",
  "MAX_DECK_REQUESTS_PER_UTC_DAY",
  "TOSS_AUTH_EXCHANGE_HOURLY_LIMIT",
  "TOSS_APP_CHECK_REFRESH_HOURLY_LIMIT",
] as const;

const POSITIVE_INTEGER_OVERRIDES: ReadonlySet<string> = new Set(
  OPTIONAL_RUNTIME_OVERRIDES.filter(
    (name) => name !== "GOOGLE_PLAY_PACKAGE_NAME" && name !== "APP_STORE_BUNDLE_ID",
  ),
);

export function validateFunctionsDeployEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): FunctionsDeployConfig {
  const region = required(environment, "FUNCTIONS_REGION");
  if (!/^[a-z]+(?:-[a-z0-9]+)+\d$/.test(region)) {
    throw new Error("FUNCTIONS_REGION has an invalid region format.");
  }
  const googlePlayRtdnTopic = requireGooglePlayRtdnTopicId(
    environment.GOOGLE_PLAY_RTDN_TOPIC,
  );
  const googlePlayProductIds = csv(environment, "GOOGLE_PLAY_PRODUCT_IDS");
  const appStoreProductIds = csv(environment, "APP_STORE_PRODUCT_IDS");
  const appStoreAppAppleIdRaw = required(environment, "APP_STORE_APP_APPLE_ID");
  const appStoreAppAppleId = Number(appStoreAppAppleIdRaw);
  if (!Number.isSafeInteger(appStoreAppAppleId) || appStoreAppAppleId <= 0) {
    throw new Error("APP_STORE_APP_APPLE_ID must be a positive integer.");
  }
  return {
    region,
    googlePlayRtdnTopic,
    googlePlayProductIds,
    appStoreAppAppleId,
    appStoreProductIds,
    appStoreIapIssuerId: required(environment, "APP_STORE_IAP_ISSUER_ID"),
    appStoreIapKeyId: required(environment, "APP_STORE_IAP_KEY_ID"),
    tossFirebaseAppId: required(environment, "TOSS_FIREBASE_APP_ID"),
    runtimeOverrides: optionalRuntimeOverrides(environment),
  };
}

export function requireGooglePlayRtdnTopicId(value: string | undefined): string {
  const topicId = value?.trim();
  if (topicId === undefined || topicId.length === 0) {
    throw new Error(
      "GOOGLE_PLAY_RTDN_TOPIC must be configured before Functions deployment.",
    );
  }
  if (!isPubSubTopicId(topicId)) {
    throw new Error(
      "GOOGLE_PLAY_RTDN_TOPIC must be a Pub/Sub topic ID, not a projects/.../topics/... resource name.",
    );
  }
  return topicId;
}

export function renderFunctionsRuntimeDotenv(config: FunctionsDeployConfig): string {
  const values: Readonly<Record<string, string>> = {
    FUNCTIONS_REGION: config.region,
    GOOGLE_PLAY_RTDN_TOPIC: config.googlePlayRtdnTopic,
    GOOGLE_PLAY_PRODUCT_IDS: config.googlePlayProductIds.join(","),
    APP_STORE_APP_APPLE_ID: String(config.appStoreAppAppleId),
    APP_STORE_PRODUCT_IDS: config.appStoreProductIds.join(","),
    APP_STORE_IAP_ISSUER_ID: config.appStoreIapIssuerId,
    APP_STORE_IAP_KEY_ID: config.appStoreIapKeyId,
    TOSS_FIREBASE_APP_ID: config.tossFirebaseAppId,
    ...config.runtimeOverrides,
  };
  return `${Object.entries(values)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join("\n")}\n`;
}

function optionalRuntimeOverrides(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of OPTIONAL_RUNTIME_OVERRIDES) {
    const value = environment[name]?.trim();
    if (value === undefined || value.length === 0) continue;
    if (POSITIVE_INTEGER_OVERRIDES.has(name)) {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number <= 0) {
        throw new Error(`${name} must be a positive integer when configured.`);
      }
    }
    result[name] = value;
  }
  return result;
}

function isPubSubTopicId(value: string): boolean {
  // Firebase Functions adds projects/{project}/topics/ around this ID.
  return (
    value.length >= 3 &&
    value.length <= 255 &&
    /^[A-Za-z][A-Za-z0-9._~+%-]*$/.test(value) &&
    !value.toLowerCase().startsWith("goog")
  );
}

function required(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be configured before Functions deployment.`);
  }
  return value;
}

function csv(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): readonly string[] {
  const raw = required(environment, name);
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new Error(`${name} must contain a non-empty unique product allowlist.`);
  }
  return values;
}
