# Shopnex admin, API, hosted checkout and storefront in one image, behind Caddy on a single port.
# Used by the one-click deploys (Render, DigitalOcean…).
FROM node:25-slim
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
CMD ["deploy/start.sh"]
