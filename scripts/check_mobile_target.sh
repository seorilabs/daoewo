#!/usr/bin/env bash
set -euo pipefail

required_files=(
  "apps/mobile/README.md"
  "apps/mobile/package.example.json"
)

for file in "${required_files[@]}"; do
  if [ ! -f "${file}" ]; then
    echo "Missing mobile target scaffold file: ${file}" >&2
    exit 1
  fi
done

if [ ! -d "apps/mobile/android" ] || [ ! -d "apps/mobile/ios" ]; then
  echo "apps/mobile native projects are not initialized yet."
  echo "Run: pnpm run bootstrap:mobile -- <AppName>"
  exit 1
fi

ios_entitlements="apps/mobile/ios/Daoewo/Daoewo.entitlements"
ios_info_plist="apps/mobile/ios/Daoewo/Info.plist"
ios_project="apps/mobile/ios/Daoewo.xcodeproj/project.pbxproj"
android_manifest="apps/mobile/android/app/src/main/AndroidManifest.xml"
android_application="apps/mobile/android/app/src/main/java/com/seorilabs/daoewo/MainApplication.kt"
notification_spec="apps/mobile/specs/NativeDaoewoNotifications.ts"

for file in \
  "${ios_entitlements}" \
  "${ios_info_plist}" \
  "${ios_project}" \
  "${android_manifest}" \
  "${android_application}" \
  "${notification_spec}"; do
  if [ ! -f "${file}" ]; then
    echo "Missing mobile native readiness file: ${file}" >&2
    exit 1
  fi
done

if ! rg -q '<key>aps-environment</key>' "${ios_entitlements}" || \
   ! rg -q '<string>\$\(APS_ENVIRONMENT\)</string>' "${ios_entitlements}"; then
  echo "iOS Push Notifications entitlement is not configuration-aware." >&2
  exit 1
fi

if ! rg -q 'com\.apple\.Push = \{' "${ios_project}" || \
   ! rg -q 'com\.apple\.BackgroundModes = \{' "${ios_project}" || \
   ! rg -q 'APS_ENVIRONMENT = development;' "${ios_project}" || \
   ! rg -q 'APS_ENVIRONMENT = production;' "${ios_project}"; then
  echo "iOS Push/Background Modes Xcode capability settings are incomplete." >&2
  exit 1
fi

if ! rg -q '<key>UIBackgroundModes</key>' "${ios_info_plist}" || \
   ! rg -q '<string>fetch</string>' "${ios_info_plist}" || \
   ! rg -q '<string>remote-notification</string>' "${ios_info_plist}"; then
  echo "iOS FCM background modes are incomplete." >&2
  exit 1
fi

if ! rg -q 'android\.permission\.POST_NOTIFICATIONS' "${android_manifest}" || \
   ! rg -q 'com\.google\.firebase\.messaging\.default_notification_icon' "${android_manifest}" || \
   ! rg -q '@drawable/ic_notification' "${android_manifest}"; then
  echo "Android FCM permission/default icon settings are incomplete." >&2
  exit 1
fi

if ! rg -q 'DaoewoNotificationScheduler\.ensureChannel\(this\)' "${android_application}"; then
  echo "Android FCM default notification channel is not initialized." >&2
  exit 1
fi

if ! rg -q 'requestPermission\(\): Promise<boolean>;' "${notification_spec}"; then
  echo "Native notification permission TurboModule contract is missing." >&2
  exit 1
fi

node <<'NODE'
const firebase = require('./apps/mobile/firebase.json')['react-native'];
if (
  firebase?.messaging_auto_init_enabled !== false ||
  firebase?.messaging_ios_auto_register_for_remote_messages !== false ||
  firebase?.messaging_android_notification_channel_id !== 'daoewo_reminders' ||
  firebase?.messaging_android_notification_color !== '@color/daoewo_indigo'
) {
  console.error('FCM opt-in/default notification firebase.json settings are incomplete.');
  process.exit(1);
}
NODE

launch_storyboard="$(find "apps/mobile/ios" -name "LaunchScreen.storyboard" -type f | sed -n '1p')"

if [ -z "${launch_storyboard}" ]; then
  echo "Missing iOS LaunchScreen.storyboard. Keep a native launch screen and brand it for the product." >&2
  exit 1
fi

if rg -n "Powered by React Native|Welcome to React Native|React Native" "${launch_storyboard}"; then
  echo "Default React Native launch screen text remains in ${launch_storyboard}." >&2
  echo "Replace the native launch screen with product branding before release." >&2
  exit 1
fi

echo "Mobile target is initialized."
