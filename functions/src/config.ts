export const BACKEND_CONFIG = Object.freeze({
  region: process.env.FUNCTIONS_REGION ?? "asia-northeast3",
  chunkSize: positiveInteger(process.env.DECK_CHUNK_SIZE, 200),
  chunkCacheEntries: positiveInteger(process.env.DECK_CHUNK_CACHE_ENTRIES, 256),
  freeDailyCardLimit: positiveInteger(process.env.FREE_DAILY_CARD_LIMIT, 60),
  freeActiveGoalLimit: positiveInteger(process.env.FREE_ACTIVE_GOAL_LIMIT, 1),
  premiumUserDailySoftCap: positiveInteger(
    process.env.PREMIUM_USER_DAILY_SOFT_CAP,
    600,
  ),
  premiumDeviceDailySoftCap: positiveInteger(
    process.env.PREMIUM_DEVICE_DAILY_SOFT_CAP,
    300,
  ),
  goalResetCooldownHours: positiveInteger(
    process.env.GOAL_RESET_COOLDOWN_HOURS,
    24,
  ),
  premiumWindowTtlHours: positiveInteger(
    process.env.PREMIUM_WINDOW_TTL_HOURS,
    24,
  ),
  freeWindowTtlHours: positiveInteger(
    process.env.FREE_WINDOW_TTL_HOURS,
    24,
  ),
  maxDeckRequestsPerUtcDay: positiveInteger(
    process.env.MAX_DECK_REQUESTS_PER_UTC_DAY,
    5,
  ),
  tossAuthExchangeHourlyLimit: positiveInteger(
    process.env.TOSS_AUTH_EXCHANGE_HOURLY_LIMIT,
    30,
  ),
  tossAppCheckRefreshHourlyLimit: positiveInteger(
    process.env.TOSS_APP_CHECK_REFRESH_HOURLY_LIMIT,
    12,
  ),
  tossFirebaseAppId: process.env.TOSS_FIREBASE_APP_ID,
  googlePlayPackageName:
    process.env.GOOGLE_PLAY_PACKAGE_NAME ?? "com.seorilabs.daoewo",
  googlePlayProductIds: stringList(process.env.GOOGLE_PLAY_PRODUCT_IDS),
  googlePlayRtdnTopic: optionalTrimmed(process.env.GOOGLE_PLAY_RTDN_TOPIC),
  appStoreBundleId:
    process.env.APP_STORE_BUNDLE_ID ?? "com.seorilabs.daoewo",
  appStoreAppAppleId: optionalPositiveInteger(process.env.APP_STORE_APP_APPLE_ID),
  appStoreProductIds: stringList(process.env.APP_STORE_PRODUCT_IDS),
  appStoreIapIssuerId: process.env.APP_STORE_IAP_ISSUER_ID,
  appStoreIapKeyId: process.env.APP_STORE_IAP_KEY_ID,
});

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }

  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function optionalPositiveInteger(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function stringList(raw: string | undefined): readonly string[] {
  if (raw === undefined) return Object.freeze([]);
  return Object.freeze(
    [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))],
  );
}

function optionalTrimmed(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  return value.length === 0 ? undefined : value;
}
