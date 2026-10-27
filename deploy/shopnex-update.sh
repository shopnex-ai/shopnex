#!/bin/sh
# Host-side updater for a Compose install made by install.sh. Runs as root under systemd, started by
# shopnex-update.path when the dashboard writes a version to $DIR/update/request/pending.
#
# The app container never gets Docker access. All it can do is write a version string into that one directory,
# and everything below treats the string as untrusted: it must be a plain vX.Y.Z, newer than the running version,
# and published as both images. Progress goes to $DIR/update/status, which the container can only read.
set -u

DIR="${SHOPNEX_DIR:-/opt/shopnex}"
REPO="shopnex-ai/shopnex"
REQUEST="$DIR/update/request/pending"
STATUS_DIR="$DIR/update/status"
BACKUPS="$DIR/backups"
KEEP_BACKUPS=5

[ -f "$REQUEST" ] || exit 0
exec 9>/run/shopnex-update.lock
flock -n 9 || exit 0

# Read, then delete right away so a failure below can never leave the path unit retriggering
# Only characters a release tag can contain survive, which also keeps the status JSON well-formed
VERSION="$(head -c 32 "$REQUEST" 2>/dev/null | tr -cd 'v0-9.')"
rm -f "$REQUEST"

status() { # state step message
  printf '{"state":"%s","version":"%s","step":"%s","message":"%s","at":%s}\n' "$1" "$VERSION" "$2" "$3" "$(date +%s)" \
    > "$STATUS_DIR/status.json.tmp" && mv -f "$STATUS_DIR/status.json.tmp" "$STATUS_DIR/status.json"
}
fail() { status failed "$1" "$2"; echo "shopnex-update: $2" >&2; exit 1; }

env_get() { sed -n "s/^$1=//p" "$DIR/.env" | head -n 1; }
env_set() {
  { grep -v "^$1=" "$DIR/.env" || true; printf '%s=%s\n' "$1" "$2"; } > "$DIR/.env.tmp" && mv -f "$DIR/.env.tmp" "$DIR/.env"
  chmod 600 "$DIR/.env"
}

cd "$DIR" || exit 1
mkdir -p "$STATUS_DIR" "$BACKUPS"

# ── check the request ────────────────────────────────────────────────────────
status running checking "Checking the request"
printf '%s' "$VERSION" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || fail checking "Refused: the requested version is not a release tag."
CURRENT="$(env_get SHOPNEX_VERSION)"
[ "$VERSION" != "$CURRENT" ] || fail checking "Already on $VERSION."
[ "$(printf '%s\n%s\n' "${CURRENT#v}" "${VERSION#v}" | sort -V | tail -n 1)" = "${VERSION#v}" ] \
  || fail checking "Refused: $VERSION is older than the running $CURRENT."
for image in "ghcr.io/$REPO:$VERSION" "ghcr.io/$REPO-stripe:$VERSION"; do
  docker manifest inspect "$image" >/dev/null 2>&1 || fail checking "Refused: $image is not published."
done

# ── back up the database ─────────────────────────────────────────────────────
status running backup "Backing up the database"
BACKUP="$BACKUPS/shopnex-$(date +%Y%m%d-%H%M%S)-before-$VERSION.sql"
docker compose exec -T db pg_dump -U shopnex shopnex > "$BACKUP" 2>/dev/null && [ -s "$BACKUP" ] \
  || { rm -f "$BACKUP"; fail backup "The database backup failed, so nothing was changed."; }
gzip -f "$BACKUP"
ls -1t "$BACKUPS"/*.sql.gz 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f

# ── fetch and check the new Compose file ─────────────────────────────────────
status running download "Downloading $VERSION"
NEW="$DIR/docker-compose.yml.new"
curl -fsSL --max-time 30 "https://raw.githubusercontent.com/$REPO/$VERSION/deploy/docker-compose.yml" -o "$NEW" \
  || { rm -f "$NEW"; fail download "Could not download the Compose file for $VERSION."; }
SHOPNEX_VERSION="$VERSION" docker compose --project-directory "$DIR" -f "$NEW" -f "$DIR/docker-compose.override.yml" config -q 2>/dev/null \
  || { rm -f "$NEW"; fail download "The Compose file for $VERSION did not validate."; }

cp -f "$DIR/docker-compose.yml" "$DIR/docker-compose.yml.prev"
cp -f "$DIR/.env" "$DIR/.env.prev"
mv -f "$NEW" "$DIR/docker-compose.yml"
env_set SHOPNEX_VERSION "$VERSION"

rollback() { # reason
  mv -f "$DIR/docker-compose.yml.prev" "$DIR/docker-compose.yml"
  mv -f "$DIR/.env.prev" "$DIR/.env"
  docker compose up -d --remove-orphans >/dev/null 2>&1
  fail "$1" "Update to $VERSION failed and the previous files were restored. A database backup is in $BACKUPS."
}

status running pull "Pulling the new images"
docker compose pull -q >/dev/null 2>&1 || rollback pull

# ── switch over ──────────────────────────────────────────────────────────────
status running restart "Restarting Shopnex"
docker compose up -d --remove-orphans >/dev/null 2>&1 || rollback restart

tries=0
until curl -fsS -o /dev/null http://127.0.0.1:3000/admin/login 2>/dev/null; do
  tries=$((tries + 1))
  [ "$tries" -lt 60 ] || rollback health
  sleep 2
done

rm -f "$DIR/docker-compose.yml.prev" "$DIR/.env.prev"
status done done "Updated to $VERSION"
