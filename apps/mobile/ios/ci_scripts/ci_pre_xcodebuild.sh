#!/bin/sh

# Xcode Cloud archive 직전 exact GitHub tag의 중앙 version binding을 Info.plist에 적용한다.
# 앱 저장소는 버전을 계산하지 않으며, 같은 불변 중앙 commit의 두 helper를 checksum 검증한다.

set -eu

AUTHORITY_SHA="9afa357f9ba6c8d6a813c7cec7ad3d35c626bdd5"
APPLIER_SHA256="b399afde0016e23947e173437e266aa83071079d1345b41ff580ebfe63357d6f"
AUTHORITY_SHA256="ca9ef5b4fe326323840b171f9e6ed069cb182d2aee8e88b72e352c57514d466b"
SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH='' cd -- "${SCRIPT_DIR}/../../../.." && pwd)"
REPO="${CI_PRIMARY_REPOSITORY_PATH:-${REPO_ROOT}}"
RELEASE_TAG="${CI_TAG:-}"
INFO_PLIST="${REPO}/apps/mobile/ios/Daoewo/Info.plist"
DRY_RUN="${CI_PRE_XCODEBUILD_DRY_RUN:-0}"

if [ -z "$RELEASE_TAG" ]; then
  echo "CI_TAG가 없습니다. Xcode Cloud release archive는 exact vX.Y.Z tag에서만 허용됩니다." >&2
  exit 1
fi

authority_dir=""
cleanup_authority="false"
cleanup() {
  if [ "$cleanup_authority" = "true" ] && [ -n "$authority_dir" ]; then
    rm -rf "$authority_dir"
  fi
}
trap cleanup EXIT INT TERM

if [ "$DRY_RUN" = "1" ] && [ -n "${SEORI_RELEASE_AUTHORITY_DIR:-}" ]; then
  authority_dir="$SEORI_RELEASE_AUTHORITY_DIR"
else
  authority_dir="$(mktemp -d)"
  cleanup_authority="true"
  base_url="https://raw.githubusercontent.com/seorilabs/.github/${AUTHORITY_SHA}/scripts/release"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "${base_url}/xcode-cloud-apply-tag-version.mjs" \
    --output "${authority_dir}/xcode-cloud-apply-tag-version.mjs"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "${base_url}/tag-version-authority.mjs" \
    --output "${authority_dir}/tag-version-authority.mjs"
  (
    cd "$authority_dir"
    printf '%s  %s\n' "$APPLIER_SHA256" xcode-cloud-apply-tag-version.mjs | shasum -a 256 -c
    printf '%s  %s\n' "$AUTHORITY_SHA256" tag-version-authority.mjs | shasum -a 256 -c
  )
fi

if [ "$DRY_RUN" = "1" ]; then
  result="$(node "${authority_dir}/xcode-cloud-apply-tag-version.mjs" \
    --tag "$RELEASE_TAG" --repository "$REPO" --info-plist "$INFO_PLIST" --dry-run)"
else
  result="$(node "${authority_dir}/xcode-cloud-apply-tag-version.mjs" \
    --tag "$RELEASE_TAG" --repository "$REPO" --info-plist "$INFO_PLIST")"
fi

marketing="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).appleMarketingVersion ?? ""))' "$result")"
build="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).appleBuildNumber ?? ""))' "$result")"
source_sha="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).sourceSha ?? ""))' "$result")"

if [ -z "$marketing" ] || [ -z "$build" ] || [ -z "$source_sha" ]; then
  echo "중앙 Xcode Cloud release binding 결과가 불완전합니다." >&2
  exit 1
fi

echo "중앙 태그 버전 적용 완료: ${marketing} (Apple ${build}, source ${source_sha})"
