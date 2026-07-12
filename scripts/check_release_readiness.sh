#!/usr/bin/env bash
set -euo pipefail

required_paths=(
  "docs/01-planning/product-spec.md"
  "docs/01-planning/release-targets.md"
  "docs/05-markets/google-play.md"
  "docs/05-markets/app-store.md"
  "docs/05-markets/apps-in-toss.md"
  "docs/05-markets/firebase.md"
  "docs/05-markets/privacy-data-inventory.md"
  "docs/05-markets/subscription-terms.md"
  "docs/05-markets/third-party-content-notices.md"
  "docs/06-release/release-checklist.md"
)

required_release_configs=(
  "play-store/google-play.config.json"
  "app-store/app-store.config.json"
  "apps-in-toss/apps-in-toss.config.json"
  "apps/ait/granite.config.ts"
)

echo "Release readiness inventory"
echo

blockers=0

block() {
  echo "$1" >&2
  blockers=1
}

for path in "${required_paths[@]}"; do
  if [ ! -f "${path}" ]; then
    block "Missing release source file: ${path}"
  fi
done

existing_release_configs=()
for file in "${required_release_configs[@]}"; do
  if [ ! -f "${file}" ]; then
    block "Missing release config: ${file}"
    continue
  fi

  existing_release_configs+=("${file}")
done

machine_configs=(
  "play-store/google-play.config.json"
  "app-store/app-store.config.json"
  "apps-in-toss/apps-in-toss.config.json"
)

for file in "${machine_configs[@]}"; do
  if [ ! -f "${file}" ]; then
    continue
  fi

  if ! node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "${file}"; then
    block "Invalid JSON release config: ${file}"
    continue
  fi

  blocker_count="$(node -e 'const c=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(String(Array.isArray(c.blockers)?c.blockers.length:0))' "${file}")"
  if [ "${blocker_count}" -gt 0 ]; then
    echo "${file}: ${blocker_count} unresolved blocker(s)" >&2
    node -e 'const c=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); for (const b of c.blockers) console.error(`  - ${b}`)' "${file}"
    blockers=1
  fi
done

scan_targets=("${required_paths[@]}")
if [ "${#existing_release_configs[@]}" -gt 0 ]; then
  scan_targets+=("${existing_release_configs[@]}")
fi

if rg -n "확정 필요|TBD|TODO" "${scan_targets[@]}"; then
  echo
  echo "Release blockers remain. Resolve placeholders before deployment approval." >&2
  blockers=1
fi

if ! node <<'NODE'
const fs = require('node:fs');

const configs = {
  play: JSON.parse(fs.readFileSync('play-store/google-play.config.json', 'utf8')),
  appStore: JSON.parse(fs.readFileSync('app-store/app-store.config.json', 'utf8')),
  toss: JSON.parse(fs.readFileSync('apps-in-toss/apps-in-toss.config.json', 'utf8')),
};
const registrationManifest = JSON.parse(fs.readFileSync('assets/registration-icons.manifest.json', 'utf8'));
const registeredAssets = new Map(registrationManifest.items.map((item) => [item.path, item]));

let blocked = false;
const fail = (message) => {
  console.error(message);
  blocked = true;
};
const isPublicHttps = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !['example.com', 'www.example.com', 'placehold.co', 'localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
};
const checkFiles = (label, paths) => {
  for (const path of paths) {
    if (typeof path !== 'string' || !fs.existsSync(path)) fail(`${label} screenshot file is missing: ${String(path)}`);
  }
};
const checkRegisteredScreenshots = (label, paths) => {
  for (const path of paths) {
    if (!registeredAssets.has(path)) {
      fail(`${label} screenshot is not declared in assets/registration-icons.manifest.json: ${String(path)}`);
    }
  }
};

for (const [label, value] of [
  ['Google Play support URL', configs.play.contactWebsite],
  ['Google Play privacy URL', configs.play.privacyPolicyUrl],
  ['App Store support URL', configs.appStore.supportUrl],
  ['App Store privacy URL', configs.appStore.privacyPolicyUrl],
]) {
  if (!isPublicHttps(value)) fail(`${label} is not a finalized public HTTPS URL.`);
}

for (const [label, value] of [
  ['App Store monthly product ID', configs.appStore.subscription?.monthlyProductId],
  ['App Store annual product ID', configs.appStore.subscription?.annualProductId],
]) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('확정 필요')) {
    fail(`${label} is not configured.`);
  }
}

const playPhone = configs.play.assets?.phoneScreenshots ?? [];
const playTablet7 = configs.play.assets?.sevenInchTabletScreenshots ?? [];
const playTablet10 = configs.play.assets?.tenInchTabletScreenshots ?? [];
const appStorePhone = configs.appStore.assets?.iphone69Screenshots ?? [];
const appStoreIpad = configs.appStore.assets?.ipad13Screenshots ?? [];
const tossVertical = configs.toss.assets?.screenshots636x1048 ?? [];
console.log(`Store screenshot inventory: Play phone=${playPhone.length}, Play tablet7=${playTablet7.length}, Play tablet10=${playTablet10.length}, App Store iPhone=${appStorePhone.length}, App Store iPad=${appStoreIpad.length}, AppsInToss vertical=${tossVertical.length}`);

if (playPhone.length < 2) fail(`Google Play needs at least 2 real phone screenshots; found ${playPhone.length}.`);
if (playTablet7.length === 0 || playTablet10.length === 0) fail('Google Play tablet screenshot decision/assets are unresolved.');
if (appStorePhone.length === 0) fail('App Store real iPhone screenshots are missing.');
if (appStoreIpad.length === 0) fail('App Store iPad screenshots are missing while the native target supports iPad.');
if (tossVertical.length < 3) fail(`AppsInToss needs at least 3 real vertical screenshots; found ${tossVertical.length}.`);

checkFiles('Google Play', [...playPhone, ...playTablet7, ...playTablet10]);
checkFiles('App Store', [...appStorePhone, ...appStoreIpad]);
checkFiles('AppsInToss', tossVertical);
checkRegisteredScreenshots('Google Play', [...playPhone, ...playTablet7, ...playTablet10]);
checkRegisteredScreenshots('App Store', [...appStorePhone, ...appStoreIpad]);
checkRegisteredScreenshots('AppsInToss', tossVertical);

for (const path of tossVertical) {
  const item = registeredAssets.get(path);
  if (item && (item.width !== 636 || item.height !== 1048 || item.transparent === true)) {
    fail(`AppsInToss vertical screenshot must be solid 636x1048: ${path}`);
  }
}

if (blocked) process.exitCode = 1;
NODE
then
  blockers=1
fi

if ! python3 scripts/validate_registration_assets.py \
  --manifest assets/registration-icons.manifest.json --root .; then
  block "Store registration icon/feature/thumbnail PNG validation failed."
fi

if rg -n "Powered by React Native|Welcome to React Native|This is a demo page|Granite Framework" \
  apps/mobile/ios apps/mobile/App.tsx apps/ait/src --glob '!router.gen.ts'; then
  echo "Framework/template branding remains on a startup surface." >&2
  blockers=1
fi

if [ ! -f "firebase/.firebaserc" ]; then
  block "Firebase project is not provisioned: firebase/.firebaserc missing."
fi

if rg -q 'firebaseEnabled:[[:space:]]*false' apps/mobile/src/runtime-config.ts; then
  block "Mobile Firebase runtime is disabled."
fi

if rg -q "googleWebClientId:[[:space:]]*''" apps/mobile/src/runtime-config.ts; then
  block "Mobile Google OAuth web client ID is not configured."
fi

if rg -q "(monthly|annual):[[:space:]]*''" apps/mobile/src/runtime-config.ts; then
  block "Mobile Google Play/App Store subscription product identifiers are not configured."
fi

if rg -q "(terms|privacy):[[:space:]]*''" apps/mobile/src/runtime-config.ts; then
  block "Mobile Terms/Privacy public URLs are not configured."
fi

if [ ! -f "apps/mobile/android/app/google-services.json" ] || \
   [ ! -f "apps/mobile/ios/Daoewo/GoogleService-Info.plist" ]; then
  block "Native Firebase app configuration files are missing."
fi

if [ -f "firebase/.firebaserc" ] && \
   [ -f "apps/mobile/android/app/google-services.json" ] && \
   [ -f "apps/mobile/ios/Daoewo/GoogleService-Info.plist" ] && \
   ! node <<'NODE'
const fs = require('node:fs');
const firebase = JSON.parse(fs.readFileSync('firebase/.firebaserc', 'utf8'));
const android = JSON.parse(fs.readFileSync('apps/mobile/android/app/google-services.json', 'utf8'));
const ios = fs.readFileSync('apps/mobile/ios/Daoewo/GoogleService-Info.plist', 'utf8');
const projectId = firebase.projects?.default;
const plistValue = (key) => ios.match(
  new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>\\s*([^<]+?)\\s*</string>`),
)?.[1]?.trim() ?? '';
const client = (android.client ?? []).find(
  (candidate) => candidate.client_info?.android_client_info?.package_name === 'com.seorilabs.daoewo',
);
const valid =
  typeof projectId === 'string' &&
  projectId.length > 0 &&
  android.project_info?.project_id === projectId &&
  plistValue('PROJECT_ID') === projectId &&
  typeof client?.client_info?.mobilesdk_app_id === 'string' &&
  client.client_info.mobilesdk_app_id.length > 0 &&
  (client.api_key ?? []).some((entry) => typeof entry.current_key === 'string' && entry.current_key.length > 0) &&
  plistValue('GOOGLE_APP_ID').length > 0 &&
  plistValue('API_KEY').length > 0;
if (!valid) {
  console.error('Firebase project/native app config identifiers are missing or mismatched.');
  process.exit(1);
}
NODE
then
  blockers=1
fi

if [ ! -f "apps/mobile/ios/Daoewo/Daoewo.entitlements" ] || \
   ! rg -q "com.apple.developer.applesignin" apps/mobile/ios/Daoewo/Daoewo.entitlements || \
   ! rg -q "CODE_SIGN_ENTITLEMENTS = Daoewo/Daoewo.entitlements" \
     apps/mobile/ios/Daoewo.xcodeproj/project.pbxproj; then
  block "iOS Sign in with Apple capability is not configured."
fi

if ! rg -q "export const googlePlaySubscriptionNotification" functions/src/index.ts || \
   ! rg -q "export const appStoreServerNotification" functions/src/index.ts; then
  block "Google RTDN or App Store Server Notifications V2 entitlement-revocation path is missing."
fi

if [ -f "apps/mobile/ios/Daoewo/GoogleService-Info.plist" ] && \
   ! node <<'NODE'
const fs = require('node:fs');
const google = fs.readFileSync('apps/mobile/ios/Daoewo/GoogleService-Info.plist', 'utf8');
const info = fs.readFileSync('apps/mobile/ios/Daoewo/Info.plist', 'utf8');
const value = (source, key) => source.match(
  new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>\\s*([^<]+?)\\s*</string>`),
)?.[1]?.trim() ?? '';
const reversed = value(google, 'REVERSED_CLIENT_ID');
if (!reversed || !info.includes(`<string>${reversed}</string>`)) {
  console.error('iOS Google Sign-In reversed client URL scheme is missing or mismatched.');
  process.exit(1);
}
NODE
then
  blockers=1
fi

if node -e '
  const config = require("./play-store/google-play.config.json");
  const value = String(config.accountDeletionUrl ?? "").trim();
  const valid = /^https:\/\/[^/\s]+(?:\/|$)/i.test(value) &&
    !/(?:example\.com|placeholder|localhost|127\.0\.0\.1|확정 필요)/i.test(value);
  process.exit(valid ? 0 : 1);
'; then
  :
else
  block "Google Play external account-deletion request URL is not published."
fi

if rg -q "(apiBaseUrl|firebaseApiKey):[[:space:]]*''" apps/ait/src/runtime-config.ts; then
  block "AppsInToss API base URL or Firebase web API key is not configured."
fi

if rg -q "(terms|privacy):[[:space:]]*''" apps/ait/src/runtime-config.ts; then
  block "AppsInToss Terms/Privacy public URLs are not configured."
fi

if ! node <<'NODE'
const fs = require('node:fs');
const mobile = fs.readFileSync('apps/mobile/src/runtime-config.ts', 'utf8');
const toss = fs.readFileSync('apps/ait/src/runtime-config.ts', 'utf8');
let blocked = false;
const fail = (message) => {
  console.error(message);
  blocked = true;
};
const readString = (source, key) => {
  const match = source.match(new RegExp(`${key}\\s*:\\s*['\"]([^'\"]*)['\"]`));
  return match?.[1] ?? '';
};
const readLegalUrl = (source, key) => {
  const legal = source.match(/legalUrls\s*:\s*Object\.freeze\s*\(\s*\{([\s\S]*?)\}\s*\)/)?.[1] ?? '';
  return readString(legal, key);
};
const isPublicHttps = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !['example.com', 'www.example.com', 'placehold.co', 'localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
};

for (const [label, value] of [
  ['Mobile terms URL', readLegalUrl(mobile, 'terms')],
  ['Mobile privacy URL', readLegalUrl(mobile, 'privacy')],
  ['AppsInToss API base URL', readString(toss, 'apiBaseUrl')],
  ['AppsInToss terms URL', readLegalUrl(toss, 'terms')],
  ['AppsInToss privacy URL', readLegalUrl(toss, 'privacy')],
]) {
  if (!isPublicHttps(value)) fail(`${label} is not a finalized public HTTPS URL.`);
}

const mobileMonthly = readString(mobile, 'monthly');
const mobileAnnual = readString(mobile, 'annual');
const mobileFunctionsRegion = readString(mobile, 'functionsRegion');
const backendFunctionsRegion = process.env.FUNCTIONS_REGION?.trim() ?? '';
if (
  backendFunctionsRegion.length > 0 &&
  mobileFunctionsRegion !== backendFunctionsRegion
) {
  fail(`Mobile functionsRegion (${mobileFunctionsRegion}) does not match FUNCTIONS_REGION (${backendFunctionsRegion}).`);
}
for (const [envName, raw] of [
  ['GOOGLE_PLAY_PRODUCT_IDS', process.env.GOOGLE_PLAY_PRODUCT_IDS],
  ['APP_STORE_PRODUCT_IDS', process.env.APP_STORE_PRODUCT_IDS],
]) {
  if (!raw || !mobileMonthly || !mobileAnnual) continue;
  const allowlist = new Set(raw.split(',').map((value) => value.trim()).filter(Boolean));
  if (!allowlist.has(mobileMonthly) || !allowlist.has(mobileAnnual)) {
    fail(`${envName} does not contain both mobile monthly/annual product IDs.`);
  }
}

if (blocked) process.exitCode = 1;
NODE
then
  blockers=1
fi

if rg -q 'placehold\.co|example\.com|localhost|127\.0\.0\.1' \
  apps/ait/granite.config.ts apps-in-toss/apps-in-toss.config.json; then
  block "AppsInToss public runtime/listing still contains a placeholder URL."
fi

receipt_runtime_variables=(
  "FUNCTIONS_REGION"
  "GOOGLE_PLAY_PRODUCT_IDS"
  "GOOGLE_PLAY_RTDN_TOPIC"
  "APP_STORE_APP_APPLE_ID"
  "APP_STORE_PRODUCT_IDS"
  "APP_STORE_IAP_ISSUER_ID"
  "APP_STORE_IAP_KEY_ID"
  "TOSS_FIREBASE_APP_ID"
)

for variable in "${receipt_runtime_variables[@]}"; do
  if [ -z "${!variable:-}" ]; then
    block "Release check environment is missing receipt/auth config: ${variable}."
  fi
done

receipt_secret_variables=(
  "APP_STORE_IAP_PRIVATE_KEY_BASE64"
  "APP_STORE_ROOT_CA_CERTIFICATES_BASE64_JSON"
)

for variable in "${receipt_secret_variables[@]}"; do
  if [ -z "${!variable:-}" ]; then
    block "Release check cannot verify required App Store Secret Manager value: ${variable}."
  fi
done

if ! node <<'NODE'
const fs = require('node:fs');
const path = 'functions/store-notification-readiness.json';
let config;
try {
  config = JSON.parse(fs.readFileSync(path, 'utf8'));
} catch {
  process.exit(1);
}
const ready = [
  config.googlePlay?.voidedPurchasesReconciliation?.implemented,
  config.googlePlay?.voidedPurchasesReconciliation?.liveVerified,
  config.googlePlay?.missedRenewalRecovery?.implemented,
  config.googlePlay?.missedRenewalRecovery?.liveVerified,
  config.shared?.claimMissingAuthorityBarrier?.implemented,
  config.shared?.claimMissingAuthorityBarrier?.liveVerified,
  config.googlePlay?.linkedPurchaseMigration?.implemented,
  config.googlePlay?.linkedPurchaseMigration?.liveVerified,
  config.googlePlay?.rtdnIamAndTestMessage?.liveVerified,
  config.googlePlay?.androidPublisherRuntimeIam?.liveVerified,
  config.appStore?.notificationHistoryReconciliation?.implemented,
  config.appStore?.notificationHistoryReconciliation?.liveVerified,
  config.appStore?.serverNotificationsV2?.liveVerified,
  config.appStore?.serverApiStatusAndNestedJws?.liveVerified,
].every((value) => value === true);
process.exit(ready ? 0 : 1);
NODE
then
  block "Store notification reconciliation/migration/live verification gates are incomplete in functions/store-notification-readiness.json."
fi

if ! rg -q '"APP_STORE_IAP_PRIVATE_KEY_BASE64"' functions/src/index.ts || \
   ! rg -q '"APP_STORE_ROOT_CA_CERTIFICATES_BASE64_JSON"' functions/src/index.ts || \
   ! rg -q 'secrets:[[:space:]]*receiptSecrets' functions/src/index.ts; then
  block "App Store receipt secrets are not wired to deployed Functions."
fi

if rg -q 'new UnconfiguredReceiptVerificationProvider\("apps-in-toss"\)' \
  functions/src/receipts/runtime-providers.ts || \
  rg -q 'failClosedAppsInTossPartnerProvider' functions/src/app.ts; then
  block "AppsInToss official subscription partner provider is still intentionally fail-closed/unconfigured."
fi

if rg -q 'PUBLISHED_DECK_CONTENT = \{\}' \
  packages/product-catalog/src/published-content.generated.ts; then
  block "No human-approved deck body is published (published body count: 0)."
fi

# P1: Free bundle은 완전 오프라인이지만 아직 1-device 서버 backup/sync 계약을 대체하지 않는다.
# Pro도 서버 progress를 제품 UI의 account-scoped learning state로 hydrate하는 E2E가 남아 있다.
# 권위 서버 backup/hydrate와 복구 E2E를 구현·검증한 뒤 blocker를 해당 자동 검증으로 교체한다.
block "Free bundled learning is local-only; 1-device opportunistic server backup/sync is not implemented."
block "Pro multi-device progress hydrate E2E is not implemented."

node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const workRoot = 'content-pipeline/.work';
if (!fs.existsSync(workRoot)) {
  console.log('Local Gemini P1 draft inventory: 0 (the ignored operator work directory is absent).');
  process.exit(0);
}
const files = fs.readdirSync(workRoot).filter((name) => name.endsWith('.json'));
const records = files.map((name) => JSON.parse(fs.readFileSync(path.join(workRoot, name), 'utf8')));
const drafts = records.filter((record) =>
  record.deck?.priority === 'P1' &&
  record.deck?.provenance?.generatedBy === 'gemini-operator-batch-v1' &&
  record.workflow?.state === 'awaiting-human-approval'
);
console.log(`Local Gemini P1 draft inventory: ${drafts.length} awaiting-human-approval, ${drafts.reduce((sum, record) => sum + (record.cards?.length ?? 0), 0)} cards; these ignored drafts are not published content.`);
NODE

if [ "${blockers}" -ne 0 ]; then
  exit 1
fi

echo "Release inventory has no unresolved blockers. Deployment approval is still required."
