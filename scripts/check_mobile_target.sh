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
