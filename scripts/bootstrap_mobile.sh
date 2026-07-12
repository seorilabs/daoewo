#!/usr/bin/env bash
set -euo pipefail

app_name="${1:-}"

if [ -z "${app_name}" ]; then
  echo "Usage: pnpm run bootstrap:mobile -- <AppName>" >&2
  echo "Example: pnpm run bootstrap:mobile -- MySeorilabsApp" >&2
  exit 2
fi

if [ -e "apps/mobile/android" ] || [ -e "apps/mobile/ios" ] || [ -f "apps/mobile/package.json" ]; then
  echo "apps/mobile already appears initialized. Refusing to overwrite." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

echo "Creating bare React Native app with Community CLI: ${app_name}"
(
  cd "${tmp_dir}"
  npx @react-native-community/cli@latest init "${app_name}"
)

rsync -a "${tmp_dir}/${app_name}/" "apps/mobile/"

echo "Mobile target initialized at apps/mobile."
echo "Next: merge package.example.json dependency policy and update docs/05-markets/google-play.md / app-store.md."
echo "Also replace default React Native launch/splash screens with product branding before release checks."
