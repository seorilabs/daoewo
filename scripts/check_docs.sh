#!/usr/bin/env bash
set -euo pipefail

required_files=(
  "docs/README.md"
  "docs/01-planning/product-spec.md"
  "docs/01-planning/release-targets.md"
  "docs/02-decisions/0001-docs-as-source-of-truth.md"
  "docs/02-decisions/0002-react-native-framework-choice.md"
  "docs/03-architecture/clean-architecture.md"
  "docs/05-markets/google-play.md"
  "docs/05-markets/app-store.md"
  "docs/05-markets/apps-in-toss.md"
  "docs/05-markets/firebase.md"
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

echo "Docs source-of-truth structure check passed."
