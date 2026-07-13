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

if ! node --input-type=module <<'NODE'
import fs from 'node:fs';

import {
  isFinalizedPublicHttpsUrl,
  validateAppStoreMetadata,
  validateStoreScreenshotInventory,
} from './scripts/release-readiness-validators.mjs';

const configs = {
  play: JSON.parse(fs.readFileSync('play-store/google-play.config.json', 'utf8')),
  appStore: JSON.parse(fs.readFileSync('app-store/app-store.config.json', 'utf8')),
  toss: JSON.parse(fs.readFileSync('apps-in-toss/apps-in-toss.config.json', 'utf8')),
};
const registrationManifest = JSON.parse(fs.readFileSync('assets/registration-icons.manifest.json', 'utf8'));

let blocked = false;
const fail = (message) => {
  console.error(message);
  blocked = true;
};
for (const [label, value, optional] of [
  ['Google Play support URL', configs.play.contactWebsite, false],
  ['Google Play privacy URL', configs.play.privacyPolicyUrl, false],
  ['App Store support URL', configs.appStore.supportUrl, false],
  ['App Store privacy URL', configs.appStore.privacyPolicyUrl, false],
  ['App Store marketing URL', configs.appStore.marketingUrl, true],
]) {
  if (!isFinalizedPublicHttpsUrl(value, { optional })) {
    fail(`${label} is not a finalized public HTTPS URL.`);
  }
}

for (const error of validateAppStoreMetadata(configs.appStore)) {
  fail(error);
}

const playPhone = configs.play.assets?.phoneScreenshots ?? [];
const playTablet7 = configs.play.assets?.sevenInchTabletScreenshots ?? [];
const playTablet10 = configs.play.assets?.tenInchTabletScreenshots ?? [];
const appStorePhone = configs.appStore.assets?.iphone69Screenshots ?? [];
const appStoreIpad = configs.appStore.assets?.ipad13Screenshots ?? [];
const tossVertical = configs.toss.assets?.screenshots636x1048 ?? [];
console.log(`Store screenshot inventory: Play phone=${playPhone.length}, Play tablet7=${playTablet7.length}, Play tablet10=${playTablet10.length}, App Store iPhone=${appStorePhone.length}, App Store iPad=${appStoreIpad.length}, AppsInToss vertical=${tossVertical.length}`);

for (const error of validateStoreScreenshotInventory({
  registrationManifest,
  play: configs.play,
  appStore: configs.appStore,
  toss: configs.toss,
})) {
  fail(error);
}

if (blocked) process.exitCode = 1;
NODE
then
  blockers=1
fi

if ! python3 -c '
import json
import plistlib
import sys

with open(sys.argv[1], "rb") as source:
    json.dump(plistlib.load(source), sys.stdout)
' apps/mobile/ios/Daoewo/PrivacyInfo.xcprivacy | node --input-type=module -e '
import { validatePrivacyInfoManifest } from "./scripts/release-readiness-validators.mjs";

let source = "";
for await (const chunk of process.stdin) source += chunk;
const manifest = JSON.parse(source);
const errors = validatePrivacyInfoManifest(manifest);
for (const error of errors) console.error(error);
if (errors.length > 0) process.exitCode = 1;
'; then
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

if node --input-type=module -e '
  import { isFinalizedPublicHttpsUrl } from "./scripts/release-readiness-validators.mjs";
  const config = JSON.parse(await (await import("node:fs/promises")).readFile("play-store/google-play.config.json", "utf8"));
  process.exit(isFinalizedPublicHttpsUrl(config.accountDeletionUrl) ? 0 : 1);
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

if ! node --input-type=module <<'NODE'
import fs from 'node:fs';
import {
  isFinalizedPublicHttpsUrl,
  validateSubscriptionSkuParity,
} from './scripts/release-readiness-validators.mjs';

const mobile = fs.readFileSync('apps/mobile/src/runtime-config.ts', 'utf8');
const toss = fs.readFileSync('apps/ait/src/runtime-config.ts', 'utf8');
const play = JSON.parse(fs.readFileSync('play-store/google-play.config.json', 'utf8'));
const appStore = JSON.parse(fs.readFileSync('app-store/app-store.config.json', 'utf8'));
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
for (const [label, value] of [
  ['Mobile terms URL', readLegalUrl(mobile, 'terms')],
  ['Mobile privacy URL', readLegalUrl(mobile, 'privacy')],
  ['AppsInToss API base URL', readString(toss, 'apiBaseUrl')],
  ['AppsInToss terms URL', readLegalUrl(toss, 'terms')],
  ['AppsInToss privacy URL', readLegalUrl(toss, 'privacy')],
]) {
  if (!isFinalizedPublicHttpsUrl(value)) fail(`${label} is not a finalized public HTTPS URL.`);
}

const mobileSubscription = {
  monthly: readString(mobile, 'monthly'),
  annual: readString(mobile, 'annual'),
};
const mobileFunctionsRegion = readString(mobile, 'functionsRegion');
const backendFunctionsRegion = process.env.FUNCTIONS_REGION?.trim() ?? '';
if (
  backendFunctionsRegion.length > 0 &&
  mobileFunctionsRegion !== backendFunctionsRegion
) {
  fail(`Mobile functionsRegion (${mobileFunctionsRegion}) does not match FUNCTIONS_REGION (${backendFunctionsRegion}).`);
}
for (const error of validateSubscriptionSkuParity({
  playSubscription: {
    monthly: play.subscription?.monthlyProductId,
    annual: play.subscription?.annualProductId,
  },
  appStoreSubscription: {
    monthly: appStore.subscription?.monthlyProductId,
    annual: appStore.subscription?.annualProductId,
  },
  mobileSubscription,
  googleAllowlist: process.env.GOOGLE_PLAY_PRODUCT_IDS,
  appleAllowlist: process.env.APP_STORE_PRODUCT_IDS,
})) {
  fail(error);
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

receipt_secret_markers=(
  "APP_STORE_IAP_PRIVATE_KEY_CONFIGURED"
  "APP_STORE_ROOT_CA_CERTIFICATES_CONFIGURED"
)

for variable in "${receipt_secret_markers[@]}"; do
  if [ "${!variable:-false}" != "true" ]; then
    block "Release check cannot verify required App Store secret configuration marker: ${variable}."
  fi
done

if ! node <<'NODE'
const config = require('./functions/store-notification-readiness.json');
process.exit(config.shared?.claimMissingAuthorityBarrier?.implemented === true ? 0 : 1);
NODE
then
  block "Pre-claim store authority barrier is not marked implemented in functions/store-notification-readiness.json."
fi

if ! rg -q 'resolveReceiptClaimForNotification' functions/src/store-notifications/service.ts || \
   ! rg -q 'receiptAuthorityBarriers' functions/src/repositories/firestore-repository.ts || \
   ! rg -q 'receiptAuthorityBarriers' firebase/firestore.rules; then
  block "Pre-claim store authority barrier implementation/rules wiring is incomplete."
fi

if ! node <<'NODE'
const config = require('./functions/store-notification-readiness.json');
process.exit(config.googlePlay?.linkedPurchaseMigration?.implemented === true ? 0 : 1);
NODE
then
  block "Google Play linked purchase migration is not marked implemented in functions/store-notification-readiness.json."
fi

if ! rg -q 'googlePlayReceiptIdentity' functions/src/receipts/google-play-provider.ts || \
   ! rg -q 'ownershipState: "superseded"' functions/src/repositories/firestore-repository.ts || \
   ! rg -q 'samePredecessor' functions/src/store-notifications/google-play.ts; then
  block "Google Play linked purchase provider/claim/notification wiring is incomplete."
fi

if ! rg -q 'export const googlePlayVoidedPurchaseReconciliation' functions/src/index.ts || \
   ! rg -q 'export const appStoreProductionNotificationHistoryReconciliation' functions/src/index.ts || \
   ! rg -q 'export const appStoreSandboxNotificationHistoryReconciliation' functions/src/index.ts || \
   ! rg -q 'createGoogleVoidedPurchasesSource' functions/src/store-notifications/reconciliation-runtime.ts || \
   ! rg -q 'createAppleNotificationHistorySource' functions/src/store-notifications/reconciliation-runtime.ts || \
   ! rg -q 'getOrderForAuthority' functions/src/store-notifications/google-play.ts || \
   ! rg -q 'voidedOrderFingerprint' functions/src/repositories/firestore-repository.ts || \
   ! rg -q 'restartWindow' functions/src/store-notifications/firestore-reconciliation-cursor.ts || \
   ! rg -q 'storeReconciliationCursors' firebase/firestore.rules; then
  block "Google/Apple store reconciliation scheduler/cursor/rules wiring is incomplete."
fi

if ! rg -q 'createMissedRenewalEntitlementReader' apps/mobile/src/mobile-runtime.ts || \
   [ ! -f apps/mobile/src/missed-renewal-recovery.ts ] || \
   [ ! -f apps/mobile/__tests__/missed-renewal-recovery.test.ts ]; then
  block "Mobile missed-renewal client re-verification wiring is incomplete."
fi

if ! rg -q 'TOSS_ACCOUNT_MARKER_KEY' apps/ait/src/runtime.ts || \
   ! rg -q 'recoverColdStartSessionOnce' apps/ait/src/runtime.ts || \
   ! rg -q 'cold start 복구' apps/ait/src/runtime.test.ts; then
  block "AppsInToss cold-start session recovery or sensitive-token boundary is incomplete."
fi

if ! rg -q 'export const syncLearningBackup' functions/src/index.ts || \
   ! rg -q 'reconcileLearningBackup' functions/src/repositories/firestore-repository.ts || \
   ! rg -q 'createLearningSyncPort' apps/mobile/src/mobile-runtime.ts || \
   ! rg -q 'createLearningSyncPort' apps/ait/src/runtime.ts || \
   [ ! -f packages/product-ui/tests/sync-hydration.test.tsx ] || \
   [ ! -f functions/tests/unit/learning-backup.test.ts ]; then
  block "Free backup or Pro progress hydrate implementation wiring is incomplete."
fi

if ! rg -q 'createNativeTtsAdapter' apps/mobile/src/mobile-runtime.ts || \
   [ ! -f apps/mobile/specs/NativeDaoewoTts.ts ] || \
   [ ! -f apps/mobile/android/app/src/main/java/com/seorilabs/daoewo/NativeDaoewoTtsModule.kt ] || \
   [ ! -f apps/mobile/ios/Daoewo/RCTNativeDaoewoTts.mm ] || \
   ! rg -q 'ttsEnabled' packages/product-ui/src/DaoewoApp.tsx; then
  block "Mobile TTS native bridge or user setting wiring is incomplete."
fi

if ! rg -q 'requestPermission' apps/mobile/specs/NativeDaoewoNotifications.ts || \
   ! rg -q 'POST_NOTIFICATIONS' apps/mobile/android/app/src/main/AndroidManifest.xml || \
   [ ! -f apps/mobile/android/app/src/main/java/com/seorilabs/daoewo/DaoewoNotificationScheduler.kt ] || \
   [ ! -f apps/mobile/ios/Daoewo/RCTNativeDaoewoNotifications.mm ] || \
   ! rg -q 'dailyReminder' packages/product-ui/src/product-state.ts || \
   ! rg -q 'reviewReminder' packages/product-ui/src/product-state.ts; then
  block "Android/iOS local reminder permission, scheduler, or settings wiring is incomplete."
fi

if ! rg -q 'shareApi.share' apps/mobile/src/mobile-sharing.ts || \
   ! rg -Fq 'share({' apps/ait/src/runtime.ts || \
   ! rg -q 'serializeLearningDataExport' packages/product-ui/src/DaoewoApp.tsx || \
   ! rg -q 'createLearningDataExport' packages/product-ui/src/product-state.ts; then
  block "Mobile/AIT sharing or privacy-bounded learning-data export wiring is incomplete."
fi

if ! node --test scripts/remote-config-template.test.mjs >/dev/null; then
  block "Remote Config deploy template and mobile local defaults are invalid or mismatched."
fi

if ! rg -q 'createMobileRemoteConfigAdapter' apps/mobile/src/mobile-runtime.ts || \
   ! rg -q 'createTimedCatalogCache' apps/mobile/src/mobile-runtime.ts || \
   ! rg -q 'mobile_deck_updates_push_enabled' apps/mobile/src/mobile-runtime.ts; then
  block "Mobile Remote Config cache TTL or deck-updates kill-switch wiring is incomplete."
fi

if ! node <<'NODE'
const config = require('./apps/mobile/firebase.json')['react-native'] ?? {};
const valid =
  config.crashlytics_is_error_generation_on_js_crash_enabled === false &&
  config.messaging_auto_init_enabled === false &&
  config.messaging_ios_auto_register_for_remote_messages === false;
process.exit(valid ? 0 : 1);
NODE
then
  block "Crashlytics raw JS capture or FCM auto-init is not privacy-safe opt-in-first."
fi

if ! rg -q 'createSafeCrashReporter' apps/mobile/src/mobile-runtime.ts || \
   ! rg -q 'observeSafeCrashFailure' apps/mobile/src/mobile-runtime.ts || \
   ! rg -q 'DaoewoOperationalError' apps/mobile/src/adapters/crash-reporter.ts || \
   ! rg -q 'clearUserContext' apps/mobile/src/mobile-runtime.ts; then
  block "PII-safe Crashlytics adapter or account cleanup wiring is incomplete."
fi

if ! rg -q 'registerNotificationInstallation' apps/mobile/src/mobile-runtime.ts || \
   ! rg -q 'unregisterNotificationInstallation' apps/mobile/src/mobile-runtime.ts || \
   ! rg -q 'requestMobileNotificationPermission' apps/mobile/src/mobile-runtime.ts || \
   ! rg -q 'deckReadyNotifications' packages/product-ui/src/DaoewoApp.tsx || \
   ! rg -q 'export const registerNotificationInstallation' functions/src/index.ts || \
   ! rg -q 'export const unregisterNotificationInstallation' functions/src/index.ts || \
   ! rg -q 'export const enqueueDeckReadyNotification' functions/src/index.ts || \
   ! rg -q 'export const processDeckReadyNotificationOutbox' functions/src/index.ts || \
   ! rg -q 'export const completeDeckRequest' functions/src/index.ts || \
   ! rg -q 'operatorClaim.*request.auth' functions/src/index.ts || \
   ! rg -q 'export const sendCatalogPublishedNotification' functions/src/index.ts || \
   ! rg -q 'listCatalogNotificationInstallations' functions/src/notifications/catalog-published.ts || \
   rg -q 'subscribeToTopic|unsubscribeFromTopic' apps/mobile/src/adapters/firebase-messaging.ts || \
   ! rg -q 'catalog-published' apps/mobile/src/adapters/firebase-messaging.ts || \
   ! rg -q 'catalog-published' functions/src/notifications/firebase-messaging-sender.ts || \
   ! rg -q 'leaseId' functions/src/notifications/deck-ready-outbox.ts || \
   ! rg -q 'notificationInstallations' firebase/firestore.rules || \
   ! rg -q 'notificationOutbox' firebase/firestore.rules; then
  block "Deck-update FCM client/installations, leased Functions outbox, catalog trigger, or Firestore deny-rule wiring is incomplete."
fi

if ! rg -q 'export const processAccountMergeCleanup = onDocumentCreated' functions/src/index.ts || \
   ! rg -q 'export const accountMergeCleanupReconciliation = onSchedule' functions/src/index.ts || \
   [ ! -f functions/src/services/account-merge-cleanup-service.ts ] || \
   ! rg -q 'getAccountMergeResult' functions/src/services/account-merge-service.ts || \
   ! rg -q 'getUser\(source.uid\)' functions/src/services/account-merge-service.ts || \
   ! rg -q 'currentSource.providerData.length === 0' functions/src/services/account-merge-service.ts || \
   ! rg -q 'listAccountMergeCleanupCandidates' functions/src/repositories/firestore-repository.ts || \
   ! rg -q 'cleanupStatus: "pending"' functions/src/repositories/firestore-repository.ts || \
   ! rg -q 'cleanupMergedSourceAuth\(sourceUid\)' functions/src/repositories/firestore-repository.ts || \
   ! rg -q 'activeOwner' firebase/firestore.rules || \
   [ "$(rg -c 'this\.assertTransactionAccountNotDeleting' functions/src/repositories/firestore-repository.ts)" -ne 2 ]; then
  block "Account merge current-provider check, v2 idempotent result, retry trigger/sweeper, transaction write blocker, target-deletion cleanup, or direct-read blocker wiring is incomplete."
fi

if ! node <<'NODE'
const config = require('./firebase/firestore.indexes.json');
const expected = [
  ['schemaVersion', 'ASCENDING'],
  ['cleanupStatus', 'ASCENDING'],
  ['cleanupUpdatedAt', 'ASCENDING'],
];
const present = config.indexes.some((index) =>
  index.collectionGroup === 'accountMerges' &&
  index.queryScope === 'COLLECTION' &&
  JSON.stringify(index.fields.map(({ fieldPath, order }) => [fieldPath, order])) === JSON.stringify(expected)
);
process.exit(present ? 0 : 1);
NODE
then
  block "Account merge cleanup sweeper composite index is missing or invalid."
fi

if ! rg -q 'com.apple.Push' apps/mobile/ios/Daoewo.xcodeproj/project.pbxproj || \
   ! rg -q 'aps-environment' apps/mobile/ios/Daoewo/Daoewo.entitlements || \
   ! rg -q 'remote-notification' apps/mobile/ios/Daoewo/Info.plist || \
   ! rg -q 'messaging_android_notification_channel_id' apps/mobile/firebase.json || \
   [ ! -f apps/mobile/android/app/src/main/res/drawable/ic_notification.xml ]; then
  block "Native APNs/FCM capability, background mode, channel, or icon wiring is incomplete."
fi

if ! node <<'NODE'
const pkg = require('./apps/ait/package.json');
const rawVersion = pkg.dependencies?.['@apps-in-toss/framework'];
const match = String(rawVersion ?? '').match(/(\d+)\.(\d+)\.(\d+)/);
const supported = match && (Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 5));
process.exit(supported ? 0 : 1);
NODE
then
  block "AppsInToss Smart Message requires @apps-in-toss/framework 2.5.0 or newer."
fi

if rg -q 'createUnsupportedDaoewoDeckReadyNotifications' apps/ait/src/runtime.ts || \
   ! rg -q 'requestNotificationAgreement' apps/ait/src || \
   ! rg -q 'templateCode' apps/ait/src || \
   ! rg -q 'apps-in-toss/messenger/send-message' functions/src; then
  block "AppsInToss Smart Message runtime/server adapter is intentionally unsupported or incomplete; mobile FCM is not an AIT fallback."
fi

if ! rg -Fq -- '- [x] AIT_SMART_MESSAGE_CONSOLE_APPROVED:' docs/06-release/release-checklist.md; then
  block "AppsInToss Smart Message Console agreement/campaign/template approval is not verified."
fi

if ! rg -Fq -- '- [x] AIT_SMART_MESSAGE_MTLS_PROVIDER_VERIFIED:' docs/06-release/release-checklist.md; then
  block "AppsInToss Smart Message partner mTLS provider and user-key mapping are not verified."
fi

if ! rg -Fq -- '- [x] AIT_SMART_MESSAGE_E2E_VERIFIED:' docs/06-release/release-checklist.md; then
  block "AppsInToss Smart Message real Toss App test/live delivery E2E is not verified."
fi

if ! rg -Fq -- '- [x] FIREBASE_OPERATOR_COMPLETION_E2E_VERIFIED:' docs/06-release/release-checklist.md; then
  block "Firebase operator claim lifecycle and completeDeckRequest callable E2E are not verified."
fi

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
  block "Store notification live verification gates remain false in functions/store-notification-readiness.json."
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

if ! node packages/product-catalog/scripts/generate-catalog.mjs --check; then
  block "Catalog source/publication approval snapshots, chunk checksums, or generated artifacts are invalid."
fi

if ! node --input-type=module <<'NODE'
import fs from 'node:fs';
import { PUBLISHED_DECK_CONTENT } from './packages/product-catalog/dist/published-content.generated.js';
import { validatePublishedContentInventory } from './scripts/release-readiness-validators.mjs';

const manifest = JSON.parse(
  fs.readFileSync('content-pipeline/manifests/v1.json', 'utf8'),
);
const errors = validatePublishedContentInventory({
  manifest,
  publishedContent: PUBLISHED_DECK_CONTENT,
  expectedTotal: 14,
  expectedP1: 7,
});
for (const error of errors) console.error(error);
if (errors.length > 0) process.exitCode = 1;
NODE
then
  blockers=1
fi

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
