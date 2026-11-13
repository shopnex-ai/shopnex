# ShopNex admin, API, hosted checkout and storefront in one image, behind Caddy on a single port.
# Used by the one-click deploys (Render, DigitalOcean…).
FROM node:24-slim
RUN corepack enable
COPY --from=caddy:2 /usr/bin/caddy /usr/local/bin/caddy
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build && pnpm --dir templates/storefront build
# Release tag, set by the release workflow. Empty for branch builds, which never show an update badge.
ARG APP_VERSION=
ENV NODE_ENV=production PORT=3000 APP_VERSION=$APP_VERSION
VOLUME /data
EXPOSE 3000 80 443
# Healthy once the admin app (ADMIN_PORT 3001 in deploy/start.sh, behind Caddy) answers its API: the migrations have run
# and it is serving. Proxies and orchestrators use this to hold traffic back while a new container boots, instead of
# returning 502. Node's own fetch: the slim image has no curl or wget.
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["deploy/start.sh"]
