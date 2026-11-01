#!/bin/sh
# Shopnex installer for Linux servers.
#
#   curl -fsSL https://shopnex.ai/install.sh | sudo sh
#   curl -fsSL https://shopnex.ai/install.sh | sudo SHOPNEX_DOMAIN=shop.example.com sh
#
# Installs Docker if missing, then runs the released Shopnex images with Docker Compose in /opt/shopnex.
# With SHOPNEX_DOMAIN set, the Caddy inside the app container serves HTTPS for the shop and for stripe.<domain>
# (point both DNS records at this server first). Safe to re-run: it keeps your database and secret and moves to
# the newest release.
#
# Options (environment variables): SHOPNEX_DOMAIN, SHOPNEX_VERSION (release tag or commit, default latest release), SHOPNEX_DIR.
set -eu

REPO="shopnex-ai/shopnex"
DIR="${SHOPNEX_DIR:-/opt/shopnex}"
die() { printf 'Error: %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || die "This installer supports Linux. See https://docs.shopnex.ai/docs/self-hosting"
[ "$(id -u)" -eq 0 ] || die "Run as root: curl -fsSL <url> | sudo sh"
[ ! -f /etc/systemd/system/shopnex.service ] || die "An older Shopnex install (no Docker) was found; installing over it would start an empty shop. See https://docs.shopnex.ai/docs/self-hosting/install"

if ! docker compose version >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

VERSION="${SHOPNEX_VERSION:-$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)}"
[ -n "$VERSION" ] || die "Could not find the latest release; set SHOPNEX_VERSION=vX.Y.Z"

mkdir -p "$DIR" && cd "$DIR"
curl -fsSL "https://raw.githubusercontent.com/$REPO/$VERSION/deploy/docker-compose.yml" -o docker-compose.yml

old() { sed -n "s/^$1=//p" .env 2>/dev/null | head -n 1; }
DOMAIN="${SHOPNEX_DOMAIN:-$(old DOMAIN)}"
SECRET="$(old BETTER_AUTH_SECRET)"
[ -n "$SECRET" ] || SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
if [ -n "$DOMAIN" ]; then
  APP_URL="https://$DOMAIN"; STRIPE_URL="https://stripe.$DOMAIN"
else
  IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | cut -d' ' -f1)"
  APP_URL="http://$IP:3000"; STRIPE_URL="http://$IP:4600"
fi
# chmod first: a umask does not apply under a default ACL, and `>` keeps the mode of an existing file
touch .env && chmod 600 .env && printf 'SHOPNEX_VERSION=%s\nDOMAIN=%s\nAPP_URL=%s\nSTRIPE_APP_URL=%s\nBETTER_AUTH_SECRET=%s\n' \
  "$VERSION" "$DOMAIN" "$APP_URL" "$STRIPE_URL" "$SECRET" > .env

docker compose pull -q
docker compose up -d --remove-orphans

printf '\nShopnex %s is starting. Open %s/admin/setup in a minute to create the owner account.\n' "$VERSION" "$APP_URL"
printf 'Finish setup right away: until then anyone who finds the address can claim the shop.\n'
printf 'Config: %s/.env   Logs: cd %s && docker compose logs -f   Update: run this command again.\n' "$DIR" "$DIR"
