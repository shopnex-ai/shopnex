#!/bin/bash
# Builds an app's image and checks that the container starts and serves (what CI runs for each bundled app):
#
#   scripts/smoke-app.sh stripe
set -euo pipefail

app="${1:?usage: smoke-app.sh <folder in apps/>}"
name="smoke-$app"
env_name="$(echo "$app" | tr 'a-z-' 'A-Z_')"

docker build -f Dockerfile.app --build-arg "APP=$app" -t "$name" .
docker rm -f "$name" >/dev/null 2>&1 || true
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$name" -p 4600:4600 \
  -e "${env_name}_APP_URL=http://localhost:4600" "$name" >/dev/null

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
