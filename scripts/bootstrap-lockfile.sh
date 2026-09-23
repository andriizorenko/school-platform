#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${CI:-}" == "true" ]]; then
  echo "Refusing to generate a lockfile in CI. Generate/review/commit it from a trusted networked development environment." >&2
  exit 1
fi

corepack enable
corepack prepare pnpm@10.17.1 --activate
pnpm install --lockfile-only --no-frozen-lockfile
pnpm install --frozen-lockfile
RELEASE_ALLOW_UNTRACKED_LOCKFILE=true node scripts/release-preflight.mjs

echo "pnpm-lock.yaml generated and frozen install verified. Review the lockfile diff before committing it."
