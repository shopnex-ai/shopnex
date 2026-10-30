#!/bin/sh
# Shopnex installer for Debian / Ubuntu servers.
#
#   curl -fsSL https://shopnex.ai/install.sh | sh
#   curl -fsSL https://shopnex.ai/install.sh | SHOPNEX_DOMAIN=shop.example.com sh
#
# Installs Docker if it is missing, then runs the released Shopnex images (admin, storefront, Stripe app and
# Postgres) with Docker Compose in /opt/shopnex. With SHOPNEX_DOMAIN set, Caddy serves HTTPS for the shop on that
# domain and for the Stripe app on stripe.<domain> (point both DNS records at this server first).
# Safe to re-run: it keeps your database and .env, and moves to the newest release.
#
# Options (environment variables):
#   SHOPNEX_DOMAIN         public domain. Default: this server's IP on :80, Stripe app on :4600
#   SHOPNEX_STRIPE_DOMAIN  domain for the Stripe app                          Default: stripe.<SHOPNEX_DOMAIN>
#   SHOPNEX_VERSION        release tag to install, e.g. v1.2.3                 Default: the latest release
#   SHOPNEX_DIR            install directory                                   Default: /opt/shopnex
set -eu

REPO="shopnex-ai/shopnex"
SHOPNEX_DIR="${SHOPNEX_DIR:-/opt/shopnex}"
ENV_FILE="$SHOPNEX_DIR/.env"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '\033[31mError: %s\033[0m\n' "$1" >&2; exit 1; }

# ── checks ───────────────────────────────────────────────────────────────────
[ "$(uname -s)" = "Linux" ] || die "This installer supports Debian/Ubuntu Linux. On other systems, see https://docs.shopnex.ai/docs/self-hosting"
command -v apt-get >/dev/null 2>&1 || die "apt-get not found. This installer supports Debian and Ubuntu; see https://docs.shopnex.ai/docs/self-hosting for other systems."

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || die "Run as root, or install sudo."
  SUDO="sudo"
fi

export DEBIAN_FRONTEND=noninteractive

# An older version of this installer ran Shopnex directly on the host (Node and Postgres). Its data lives in that
# Postgres, not in a container, so installing over it would start an empty shop next to the real one.
if [ -f /etc/systemd/system/shopnex.service ]; then
  die "An older Shopnex install (running directly on this server, not in Docker) was found. Installing over it would start a new, empty shop. Keep using the old install, or migrate first: see https://docs.shopnex.ai/docs/self-hosting/install#moving-from-the-older-installer"
fi

# ── docker ───────────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  say "Installing Docker"
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq ca-certificates curl openssl >/dev/null
  curl -fsSL https://get.docker.com | $SUDO sh >/dev/null
fi
$SUDO systemctl enable --now docker >/dev/null 2>&1 || true
command -v curl >/dev/null 2>&1 || $SUDO apt-get install -y -qq curl >/dev/null
command -v openssl >/dev/null 2>&1 || $SUDO apt-get install -y -qq openssl >/dev/null

# ── version ──────────────────────────────────────────────────────────────────
if [ -z "${SHOPNEX_VERSION:-}" ]; then
  SHOPNEX_VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$SHOPNEX_VERSION" ] || die "Could not find the latest release. Set SHOPNEX_VERSION=vX.Y.Z and run again."
fi
case "$SHOPNEX_VERSION" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) die "SHOPNEX_VERSION must be a release tag like v1.2.3 (got '$SHOPNEX_VERSION')." ;;
esac

# ── files ────────────────────────────────────────────────────────────────────
say "Setting up Shopnex $SHOPNEX_VERSION in $SHOPNEX_DIR"
$SUDO mkdir -p "$SHOPNEX_DIR"
$SUDO chmod 755 "$SHOPNEX_DIR"

# The Compose file is downloaded per release, so the images and the file always match
curl -fsSL "https://raw.githubusercontent.com/$REPO/$SHOPNEX_VERSION/deploy/docker-compose.yml" \
  | $SUDO tee "$SHOPNEX_DIR/docker-compose.yml" >/dev/null \
  || die "Could not download the Compose file for $SHOPNEX_VERSION."

env_get() { [ -f "$ENV_FILE" ] && $SUDO sed -n "s/^$1=//p" "$ENV_FILE" | head -n 1 || true; }
env_set() {
  { $SUDO grep -v "^$1=" "$ENV_FILE" 2>/dev/null || true; printf '%s=%s\n' "$1" "$2"; } | $SUDO tee "$ENV_FILE.tmp" >/dev/null
  $SUDO mv "$ENV_FILE.tmp" "$ENV_FILE"
}

# Keep what an earlier run chose when this run does not say otherwise
SHOPNEX_DOMAIN="${SHOPNEX_DOMAIN:-$(env_get SHOPNEX_DOMAIN)}"
SHOPNEX_STRIPE_DOMAIN="${SHOPNEX_STRIPE_DOMAIN:-$(env_get SHOPNEX_STRIPE_DOMAIN)}"

if [ -n "$SHOPNEX_DOMAIN" ]; then
  SHOPNEX_STRIPE_DOMAIN="${SHOPNEX_STRIPE_DOMAIN:-stripe.$SHOPNEX_DOMAIN}"
  APP_URL="https://$SHOPNEX_DOMAIN"
  STRIPE_APP_URL="https://$SHOPNEX_STRIPE_DOMAIN"
else
  IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | cut -d' ' -f1)"
  APP_URL="http://$IP"
  STRIPE_APP_URL="http://$IP:4600"
fi

if [ ! -f "$ENV_FILE" ]; then
  $SUDO sh -c "umask 077 && : > '$ENV_FILE'"
  env_set BETTER_AUTH_SECRET "$(openssl rand -hex 32)"
fi
env_set SHOPNEX_VERSION "$SHOPNEX_VERSION"
env_set APP_URL "$APP_URL"
env_set STRIPE_APP_URL "$STRIPE_APP_URL"
env_set SHOPNEX_DOMAIN "$SHOPNEX_DOMAIN"
env_set SHOPNEX_STRIPE_DOMAIN "${SHOPNEX_STRIPE_DOMAIN:-}"
$SUDO chmod 600 "$ENV_FILE"

# ── dashboard updates ────────────────────────────────────────────────────────
# A root script on the host does the updating, so no container ever gets access to Docker. The app can only
# drop a version string into $SHOPNEX_DIR/update/request; the script checks it before doing anything.
UPDATER=""
if curl -fsSL "https://raw.githubusercontent.com/$REPO/$SHOPNEX_VERSION/deploy/shopnex-update.sh" -o /tmp/shopnex-update.sh 2>/dev/null; then
  $SUDO install -o root -g root -m 755 /tmp/shopnex-update.sh /usr/local/sbin/shopnex-update
  rm -f /tmp/shopnex-update.sh
  $SUDO mkdir -p "$SHOPNEX_DIR/update/request" "$SHOPNEX_DIR/update/status" "$SHOPNEX_DIR/backups"
  $SUDO chmod 700 "$SHOPNEX_DIR/backups"
  $SUDO tee /etc/systemd/system/shopnex-update.service >/dev/null <<EOF
[Unit]
Description=Update Shopnex

[Service]
Type=oneshot
Environment=SHOPNEX_DIR=$SHOPNEX_DIR
ExecStart=/usr/local/sbin/shopnex-update
TimeoutStartSec=900
EOF
  $SUDO tee /etc/systemd/system/shopnex-update.path >/dev/null <<EOF
[Unit]
Description=Watch for a Shopnex update request

[Path]
PathExists=$SHOPNEX_DIR/update/request/pending

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now shopnex-update.path >/dev/null 2>&1
  UPDATER=1
else
  printf 'Note: %s has no dashboard updater, so updates need this installer. Continuing.\n' "$SHOPNEX_VERSION"
fi

# ── web server ───────────────────────────────────────────────────────────────
# Caddy runs as a container in front of the app. The app itself stays on 127.0.0.1.
if [ -n "$SHOPNEX_DOMAIN" ]; then
  $SUDO tee "$SHOPNEX_DIR/Caddyfile" >/dev/null <<EOF
$SHOPNEX_DOMAIN {
	reverse_proxy shopnex:3000
}

$SHOPNEX_STRIPE_DOMAIN {
	reverse_proxy stripe:4600
}
EOF
  CADDY_PORTS="- '80:80'
      - '443:443'"
  STRIPE_BLOCK="  stripe:
    ports: !reset []
"
else
  $SUDO tee "$SHOPNEX_DIR/Caddyfile" >/dev/null <<EOF
:80 {
	reverse_proxy shopnex:3000
}
EOF
  CADDY_PORTS="- '80:80'"
  STRIPE_BLOCK=""
fi

UPDATER_BLOCK=""
if [ -n "$UPDATER" ]; then
  # request/ is writable by the app, status/ is read-only: only the host script ever writes the status
  UPDATER_BLOCK="    volumes:
      - ./update/request:/update/request
      - ./update/status:/update/status:ro
    environment:
      SHOPNEX_UPDATER_DIR: /update
"
fi

$SUDO tee "$SHOPNEX_DIR/docker-compose.override.yml" >/dev/null <<EOF
# Written by install.sh; re-running the installer replaces it.
services:
  shopnex:
    ports: !override
      - '127.0.0.1:3000:3000'
${UPDATER_BLOCK}${STRIPE_BLOCK}  caddy:
    image: caddy:2
    restart: unless-stopped
    depends_on: [shopnex, stripe]
    ports:
      $CADDY_PORTS
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

volumes:
  caddy_data:
  caddy_config:
EOF

# ── start ────────────────────────────────────────────────────────────────────
say "Downloading and starting Shopnex"
cd "$SHOPNEX_DIR"
$SUDO docker compose pull -q
$SUDO docker compose up -d --remove-orphans

say "Waiting for Shopnex to answer"
tries=0
until curl -fsS -o /dev/null http://127.0.0.1:3000/admin/login 2>/dev/null; do
  tries=$((tries + 1))
  [ "$tries" -lt 60 ] || die "Shopnex did not start. See the logs: cd $SHOPNEX_DIR && docker compose logs shopnex"
  sleep 2
done

# ── done ─────────────────────────────────────────────────────────────────────
say "Shopnex $SHOPNEX_VERSION is running"
printf '\nYour shop is at %s and the admin at %s/admin.\nOpen the admin to finish the setup wizard and create your shop and account.\n' "$APP_URL" "$APP_URL"
printf 'Config: %s   Logs: cd %s && docker compose logs -f\n' "$ENV_FILE" "$SHOPNEX_DIR"
printf 'Update: re-run the same install command.\n\n'
