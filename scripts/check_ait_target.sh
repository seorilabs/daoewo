#!/usr/bin/env bash
set -euo pipefail

required_files=(
  "apps/ait/README.md"
  "apps/ait/granite.config.example.ts"
  "apps/ait/package.example.json"
)

for file in "${required_files[@]}"; do
  if [ ! -f "${file}" ]; then
    echo "Missing AIT target scaffold file: ${file}" >&2
    exit 1
  fi
done

if [ ! -f "apps/ait/granite.config.ts" ]; then
  echo "apps/ait is not initialized yet."
  echo "Run: pnpm run bootstrap:ait -- <app-name>"
  exit 1
fi

echo "AppsInToss target is initialized."
