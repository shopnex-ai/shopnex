#!/bin/bash
# Upgrade test: install the previous release on a fresh database, seed data, upgrade to the build in this
# checkout, and fail if any seeded data is lost or changed. Then run a smoke subset of the e2e suite.
#
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/shopnex scripts/upgrade-test.sh
#
# The database must be empty and reachable from containers on the host network (Linux; CI runs it there).
# PREVIOUS_VERSION overrides the release to start from (default: the latest stable GitHub release).
# CURRENT_IMAGE skips the build and uses an image you already have.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?set DATABASE_URL to an empty database}"
work="$(mktemp -d)"
current="${CURRENT_IMAGE:-shopnex-upgrade-current}"
container=shopnex-upgrade
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-upgrade-test-secret-upgrade-test-secret}"
export SHOPNEX_SECRET="${SHOPNEX_SECRET:-upgrade-test-shopnex-secret-upgrade}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://localhost:3000}"
export APP_URL="$BETTER_AUTH_URL"
export STOREFRONT_URL="${STOREFRONT_URL:-$APP_URL}"
export DEMO_OWNER_EMAIL="${DEMO_OWNER_EMAIL:-owner@example.com}"
export DEMO_OWNER_PASSWORD="${DEMO_OWNER_PASSWORD:-upgrade-owner-Passw0rd!}"

env_args=(-e DATABASE_URL -e BETTER_AUTH_SECRET -e SHOPNEX_SECRET -e BETTER_AUTH_URL -e APP_URL
  -e STOREFRONT_URL -e DEMO_OWNER_EMAIL -e DEMO_OWNER_PASSWORD)

# 1. The previous release
previous="${PREVIOUS_VERSION:-$(gh release view --json tagName --jq .tagName)}"
old_image="ghcr.io/shopnex-ai/shopnex:$previous"
echo "::group::Previous release $previous"
docker pull "$old_image"
echo "::endgroup::"

# 2. Install it on the empty database and seed it: the shop, accounts, products, collections, pages, menus, orders
echo "Installing $previous and seeding data"
docker run --rm --network host "${env_args[@]}" --entrypoint bash "$old_image" \
  -c 'pnpm db:migrate && pnpm demo:seed'
node scripts/db-snapshot.mjs snapshot "$work/before.json"

# 3. The build in this checkout
if [ -z "${CURRENT_IMAGE:-}" ]; then
  echo "::group::Build the current image"
  docker build -t "$current" .
  echo "::endgroup::"
fi

# 4. Upgrade: run its migrations (what deploy/start.sh does first), then compare before any app code touches the data
echo "Upgrading to the current build"
docker run --rm --network host "${env_args[@]}" --entrypoint bash "$current" -c 'pnpm db:migrate'
node scripts/db-snapshot.mjs snapshot "$work/after.json"
node scripts/db-snapshot.mjs compare "$work/before.json" "$work/after.json"

# 5. Smoke: start the current build on the upgraded database and run part of the e2e suite against it
echo "Starting the current build"
docker run -d --name "$container" --network host "${env_args[@]}" -e PORT=3000 "$current" >/dev/null
if ! npx --yes wait-on@8 -t 120000 http-get://localhost:3000/api/v1/storefront/shop; then
  docker logs "$container" >&2
  echo "The upgraded app did not start" >&2
  exit 1
fi

# Tests that sign up many accounts (auth, customer-accounts) are left out: the image runs in production mode,
# where Better Auth rate-limits sign-ups
if ! (cd e2e && APP_URL="$APP_URL" pnpm exec tsx --env-file-if-exists=../.env --test --test-concurrency=1 \
  tests/pricing.test.ts tests/stock.test.ts tests/payments.test.ts tests/seo.test.ts); then
  docker logs --tail 100 "$container" >&2
  echo "The smoke tests failed on the upgraded app" >&2
  exit 1
fi
echo "Upgrade from $previous: ok"
