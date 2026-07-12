#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--" ]; then
  shift
fi

app_name="${1:-}"

if [ -z "${app_name}" ]; then
  echo "Usage: pnpm run bootstrap:ait -- <app-name>" >&2
  echo "Example: pnpm run bootstrap:ait -- my-seorilabs-app" >&2
  exit 2
fi

if [ -f "apps/ait/granite.config.ts" ] || [ -f "apps/ait/package.json" ] || [ -d "apps/ait/src" ]; then
  echo "apps/ait already appears initialized. Refusing to overwrite." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

echo "Creating AppsInToss Granite RN app: ${app_name}"
(
  cd "${tmp_dir}"
  pnpm create granite-app "${app_name}" --tools eslint-prettier
)

rsync -a "${tmp_dir}/${app_name}/" "apps/ait/"

echo "AppsInToss target initialized at apps/ait."
echo "Next: pnpm --dir apps/ait add @apps-in-toss/framework @toss/tds-react-native && pnpm --dir apps/ait ait init --template react-native --app-name ${app_name}"
