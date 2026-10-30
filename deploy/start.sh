#!/bin/bash
# Container entrypoint: migrate, then run the admin app, the storefront and Caddy side by side.
# If any of them exits the container exits, so the platform restarts it.
set -e

# Platforms like Render only expose their public URL as RENDER_EXTERNAL_URL.
export APP_URL="${APP_URL:-$RENDER_EXTERNAL_URL}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-$APP_URL}"

# No secret given: generate one once and keep it on the /data volume, so restarts keep sessions
# and the provider keys encrypted with it. Without a volume it is regenerated on every start.
if [ -z "$BETTER_AUTH_SECRET" ]; then
  SECRET_FILE="${DATA_DIR:-/data}/better-auth-secret"
  if [ ! -s "$SECRET_FILE" ]; then
    mkdir -p "$(dirname "$SECRET_FILE")"
    (umask 077 && head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$SECRET_FILE")
    echo "BETTER_AUTH_SECRET not set: generated one at $SECRET_FILE. Mount a volume on $(dirname "$SECRET_FILE") or set BETTER_AUTH_SECRET to keep it across redeploys." >&2
  fi
  BETTER_AUTH_SECRET="$(cat "$SECRET_FILE")"
fi
export BETTER_AUTH_SECRET
: "${DATABASE_URL:?set DATABASE_URL}"

export PUBLIC_PORT="${PORT:-3000}" ADMIN_PORT=3001 STOREFRONT_PORT=4321

# Caddy serves the bundled storefront on the app's own origin, so a single shop that hasn't saved a
# Storefront URL in Settings (Themes, editor preview) uses that one.
export STOREFRONT_URL="${STOREFRONT_URL:-$APP_URL}"

# Migrations are idempotent, so running them on every start also covers updates.
pnpm db:migrate

(cd apps/admin-ui && PORT=$ADMIN_PORT node server.mjs) &
(cd templates/storefront && HOST=127.0.0.1 PORT=$STOREFRONT_PORT \
  SHOPNEX_URL="http://localhost:$ADMIN_PORT" SHOPNEX_PUBLIC_URL="$APP_URL" node dist/server/entry.mjs) &
caddy run --config deploy/Caddyfile --adapter caddyfile &

wait -n
exit 1
