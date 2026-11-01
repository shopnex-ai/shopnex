#!/bin/bash
# Container entrypoint: migrate, then run the admin app, the storefront and Caddy side by side.
# If any of them exits the container exits, so the platform restarts it.
set -e

# Platforms like Render only expose their public URL as RENDER_EXTERNAL_URL.
export APP_URL="${APP_URL:-$RENDER_EXTERNAL_URL}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-$APP_URL}"

# Two independent secrets: BETTER_AUTH_SECRET signs sessions (Better Auth), SHOPNEX_SECRET encrypts the
# provider keys saved in the admin and signs preview links. One not given is generated once and kept on
# the /data volume, so restarts keep sessions and stored keys. Without a volume it is regenerated on every start.
ensure_secret() {
  local name="$1" file="$2" path="${DATA_DIR:-/data}/$2"
  if [ -z "${!name}" ]; then
    if [ ! -s "$path" ]; then
      mkdir -p "$(dirname "$path")"
      (umask 077 && head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$path")
      echo "$name not set: generated one at $path. Mount a volume on $(dirname "$path") or set $name to keep it across redeploys." >&2
    fi
    export "$name=$(cat "$path")"
  fi
}
ensure_secret BETTER_AUTH_SECRET better-auth-secret
ensure_secret SHOPNEX_SECRET shopnex-secret
: "${DATABASE_URL:?set DATABASE_URL}"

export PUBLIC_PORT="${PORT:-3000}" ADMIN_PORT=3001 STOREFRONT_PORT=4321

# DOMAIN turns on Caddy's automatic HTTPS (ports 80 and 443 must reach this container). Certificates
# are kept on the /data volume so restarts don't request new ones.
if [ -n "$DOMAIN" ]; then
  export SITE_ADDRESS="$DOMAIN" AUTO_HTTPS_OPT="" APPS_CADDYFILE=Caddyfile.apps
  export XDG_DATA_HOME="${DATA_DIR:-/data}/caddy"
  export APP_URL="${APP_URL:-https://$DOMAIN}"
  export BETTER_AUTH_URL="${BETTER_AUTH_URL:-$APP_URL}"
else
  export SITE_ADDRESS=":$PUBLIC_PORT" AUTO_HTTPS_OPT="auto_https off" APPS_CADDYFILE="no-apps-*.caddy"
fi

# Multi-tenant shops live at <slug>.ROOT_DOMAIN: serve the wildcard next to the admin host. A wildcard certificate
# needs the DNS-01 challenge, so its `tls { dns … }` block goes in a file named by SITE_TLS_FILE (Caddy built with
# your DNS provider's plugin). Behind a CDN that terminates TLS (Cloudflare…), leave it unset.
if [ -n "$DOMAIN" ] && [ "$TENANCY_MODE" = "multi" ] && [ -n "$ROOT_DOMAIN" ]; then
  root="${ROOT_DOMAIN#*://}"
  root="${root%%[:/]*}"
  export SITE_ADDRESS="$DOMAIN, *.$root"
fi
export SITE_TLS_FILE="${SITE_TLS_FILE:-no-tls-*.caddy}"

# Caddy serves the bundled storefront on the app's own origin, so a single shop that hasn't saved a
# Storefront URL in Settings (Themes, editor preview) uses that one.
export STOREFRONT_URL="${STOREFRONT_URL:-$APP_URL}"

# drizzle-kit swallows the real connection error, so a bad host or password looks like a crashing
# migration. Connect first and print what pg says (never the URL, it holds the password).
pnpm --silent --filter @shopnex/db exec node -e '
const { Client } = require("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
client.connect().then(() => client.end()).catch((err) => {
  console.error("Cannot connect to the database: " + (err.message || err.code || err));
  console.error("Check DATABASE_URL (host, port, user, password, sslmode) and that the database is reachable from this container.");
  process.exit(1);
});
'

# Migrations are idempotent, so running them on every start also covers updates.
pnpm db:migrate

(cd apps/admin-ui && PORT=$ADMIN_PORT node server.mjs) &
(cd templates/storefront && HOST=127.0.0.1 PORT=$STOREFRONT_PORT \
  SHOPNEX_URL="http://localhost:$ADMIN_PORT" SHOPNEX_PUBLIC_URL="$APP_URL" node dist/server/entry.mjs) &
caddy run --config deploy/Caddyfile --adapter caddyfile &

wait -n
exit 1
