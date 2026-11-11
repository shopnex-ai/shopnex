#!/bin/bash
# Builds an app's image and checks that the container starts and serves (what CI runs for each bundled app):
#
#   scripts/smoke-app.sh stripe
set -euo pipefail

app="${1:?usage: smoke-app.sh <folder in apps/>}"
name="smoke-$app"
env_name="$(echo "$app" | tr 'a-z-' 'A-Z_')"

docker build -f deploy/Dockerfile.app --build-arg "APP=$app" -t "$name" .
docker rm -f "$name" "$name-db" >/dev/null 2>&1 || true
docker network rm "$name" >/dev/null 2>&1 || true
trap 'docker rm -f "$name" "$name-db" >/dev/null 2>&1 || true; docker network rm "$name" >/dev/null 2>&1 || true' EXIT

# An app's identity is its own private key (snxk_…). Only CJ Dropshipping has tables of its own, so only it gets a Postgres
app_key="snxk_$(node -e "crypto.subtle.generateKey('Ed25519',true,['sign']).then(async k=>console.log(Buffer.from(await crypto.subtle.exportKey('pkcs8',k.privateKey)).toString('base64url')))")"
docker network create "$name" >/dev/null
db_env=()
if [ "$app" = "cj-dropshipping" ]; then
  docker run -d --name "$name-db" --network "$name" -e POSTGRES_PASSWORD=postgres postgres:17 >/dev/null
  for _ in $(seq 1 30); do
    docker exec "$name-db" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  db_env=(-e "APP_DATABASE_URL=postgres://postgres:postgres@$name-db:5432/postgres")
fi

docker run -d --name "$name" --network "$name" -p 4600:4600 \
  -e "${env_name}_APP_URL=http://localhost:4600" \
  ${db_env[@]+"${db_env[@]}"} \
  -e "${env_name}_APP_KEY=$app_key" "$name" >/dev/null

for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null http://localhost:4600/shopnex/app.js; then
    echo "$app: ok"
    exit 0
  fi
  sleep 1
done
docker logs "$name" >&2
echo "$app: did not start" >&2
exit 1
