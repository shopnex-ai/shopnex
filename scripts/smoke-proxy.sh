#!/bin/bash
# Runs the real deploy/Caddyfile in front of two stub apps and checks that the X-Forwarded-Proto a TLS-terminating
# proxy (Traefik, a load balancer) sends reaches the apps. If Caddy replaced it with "http", the storefront would build
# http:// API URLs and the browser would block the cart as mixed content. Needs `caddy` or Docker (Linux: host network).
#
#   scripts/smoke-proxy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

export ADMIN_PORT=13001 STOREFRONT_PORT=14321 PUBLIC_PORT=13000
export SITE_ADDRESS=":$PUBLIC_PORT" AUTO_HTTPS_OPT="auto_https off"
export APPS_CADDYFILE="no-apps-*.caddy" SHOP_HOSTS_CADDYFILE="no-shops-*.caddy" SITE_TLS_FILE="no-tls-*.caddy"

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; docker rm -f smoke-proxy-caddy >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Stub app: answers with the forwarded headers it received
for port in "$ADMIN_PORT" "$STOREFRONT_PORT"; do
  node -e '
    require("http").createServer((req, res) => {
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ proto: req.headers["x-forwarded-proto"] ?? null, host: req.headers["x-forwarded-host"] ?? null }))
    }).listen(Number(process.argv[1]), "127.0.0.1")
  ' "$port" &
  pids+=($!)
done

if command -v caddy >/dev/null; then
  caddy run --config deploy/Caddyfile --adapter caddyfile >/tmp/smoke-proxy-caddy.log 2>&1 &
  pids+=($!)
else
  docker run -d --name smoke-proxy-caddy --network host -v "$PWD/deploy:/etc/caddy/deploy:ro" \
    -e ADMIN_PORT -e STOREFRONT_PORT -e SITE_ADDRESS -e AUTO_HTTPS_OPT -e APPS_CADDYFILE -e SHOP_HOSTS_CADDYFILE -e SITE_TLS_FILE \
    caddy:2 caddy run --config /etc/caddy/deploy/Caddyfile --adapter caddyfile >/dev/null
fi

for _ in $(seq 1 20); do
  curl -s -o /dev/null "http://127.0.0.1:$PUBLIC_PORT/" && break
  sleep 1
done

fail=0
check() { # path, header value to send, expected proto
  got=$(curl -fsS -H "X-Forwarded-Proto: $2" "http://127.0.0.1:$PUBLIC_PORT$1" | node -pe 'JSON.parse(require("fs").readFileSync(0)).proto')
  if [ "$got" = "$3" ]; then echo "ok   $1 sent '$2' -> app saw '$got'"; else echo "FAIL $1 sent '$2' -> app saw '$got', want '$3'" >&2; fail=1; fi
}
check /               https https   # storefront
check /api/v1/health  https https   # admin app (API, checkout, /admin share this route)
check /               http  http

exit $fail
