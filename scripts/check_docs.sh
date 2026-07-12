#!/usr/bin/env bash
set -euo pipefail

required_files=(
  "docs/README.md"
  "docs/01-planning/product-spec.md"
  "docs/01-planning/release-targets.md"
  "docs/02-decisions/0001-docs-as-source-of-truth.md"
  "docs/02-decisions/0002-react-native-framework-choice.md"
  "docs/02-decisions/0003-native-launch-screen-policy.md"
  "docs/02-decisions/0004-server-authoritative-premium-content.md"
  "docs/02-decisions/0005-subscription-and-device-sync.md"
  "docs/02-decisions/0006-design-system.md"
  "docs/03-architecture/clean-architecture.md"
  "docs/05-markets/google-play.md"
  "docs/05-markets/app-store.md"
  "docs/05-markets/apps-in-toss.md"
  "docs/05-markets/firebase.md"
  "docs/05-markets/privacy-data-inventory.md"
  "docs/05-markets/subscription-terms.md"
  "docs/06-release/release-checklist.md"
  "docs/07-qa/test-strategy.md"
  "docs/08-ops/dependencies.md"
  "docs/08-ops/github-actions.md"
)

for file in "${required_files[@]}"; do
  if [ ! -f "${file}" ]; then
    echo "Missing docs source file: ${file}" >&2
    exit 1
  fi
done

if rg -n 'Seorilabs Starter Template App|Lifecycle state: `planning`|Planning approval: `확정 필요`' \
  README.md docs/01-planning docs/03-architecture; then
  echo "Template planning text remains in product source-of-truth docs." >&2
  exit 1
fi

for value in "다외워" "com.seorilabs.daoewo" "daoewo"; do
  if ! rg -q --fixed-strings "${value}" docs/01-planning/product-spec.md; then
    echo "Product spec is missing required identity: ${value}" >&2
    exit 1
  fi
done

echo "Docs source-of-truth structure check passed."
