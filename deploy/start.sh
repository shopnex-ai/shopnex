#!/bin/bash
# Container entrypoint: migrate, then run the admin app, the storefront and Caddy side by side.
# If any of them exits the container exits, so the platform restarts it.
set -e

# Platforms like Render only expose their public URL as RENDER_EXTERNAL_URL.
export APP_URL="${APP_URL:-$RENDER_EXTERNAL_URL}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-$APP_URL}"
: "${BETTER_AUTH_SECRET:?set BETTER_AUTH_SECRET}"
: "${DATABASE_URL:?set DATABASE_URL}"

export PUBLIC_PORT="${PORT:-3000}" ADMIN_PORT=3001 STOREFRONT_PORT=4321

# Migrations are idempotent, so running them on every start also covers updates.
pnpm db:migrate

(cd apps/admin-ui && PORT=$ADMIN_PORT node server.mjs) &
(cd templates/storefront && HOST=127.0.0.1 PORT=$STOREFRONT_PORT \
  SHOPNEX_URL="http://localhost:$ADMIN_PORT" SHOPNEX_PUBLIC_URL="$APP_URL" node dist/server/entry.mjs) &
caddy run --config deploy/Caddyfile --adapter caddyfile &

wait -n
exit 1
