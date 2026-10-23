# Shopnex admin, API, hosted checkout and storefront in one image, behind Caddy on a single port.
# Used by the one-click deploys (Render, DigitalOcean…).
FROM node:24-slim
RUN corepack enable
COPY --from=caddy:2 /usr/bin/caddy /usr/local/bin/caddy
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build && pnpm --dir templates/storefront build
ENV NODE_ENV=production PORT=3000
VOLUME /data
EXPOSE 3000
CMD ["deploy/start.sh"]
