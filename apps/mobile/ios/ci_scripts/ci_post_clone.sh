#!/bin/sh

# Xcode Cloud clone 직후 React Native와 CocoaPods 의존성을 준비한다.
# 코드 서명은 Xcode Cloud managed signing이 담당하며 키 파일을 셸로 전달하지 않는다.

set -eu

REPO="${CI_PRIMARY_REPOSITORY_PATH:?CI_PRIMARY_REPOSITORY_PATH is required}"
IOS="${REPO}/apps/mobile/ios"
FIREBASE_PLIST="${IOS}/Daoewo/GoogleService-Info.plist"

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1

run_step() {
  if [ "${CI_POST_CLONE_DRY_RUN:-0}" = "1" ]; then
    echo "dry-run: skipped: $*"
    return 0
  fi
  "$@"
}

decode_base64_to() {
  target="$1"
  if base64 --decode </dev/null >/dev/null 2>&1; then
    base64 --decode >"$target"
  else
    base64 -D >"$target"
  fi
}

run_step brew install node cocoapods
run_step npm install -g pnpm@11.3.0

if [ -n "${FIREBASE_IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64:-}" ]; then
  printf '%s' "$FIREBASE_IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64" | decode_base64_to "$FIREBASE_PLIST"
  run_step plutil -lint "$FIREBASE_PLIST"
elif [ ! -f "$FIREBASE_PLIST" ]; then
  echo "FIREBASE_IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64가 없고 커밋된 GoogleService-Info.plist도 없습니다." >&2
  exit 1
fi

cd "$REPO"
run_step pnpm install --frozen-lockfile
cd "$IOS"
run_step pod install

echo "Xcode Cloud post-clone 준비 완료"
