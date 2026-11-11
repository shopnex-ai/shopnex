# One bundled app (apps/<name>, built on @shopnex/app) as its own small image: the app is bundled into a single
# file (plus its SQL migrations), so the runtime image holds only Node and that.
#
#   docker build -f deploy/Dockerfile.app --build-arg APP=stripe -t shopnex-app-stripe .
#   docker run -p 4600:4600 -e STRIPE_APP_URL=https://stripe.example.com -e APP_DATABASE_URL=postgres://… -e STRIPE_APP_KEY=snxk_… shopnex-app-stripe
#
# The app reads <NAME>_APP_URL (its public origin; give ShopNex the same), keeps its data in Postgres in a schema of
# its own (APP_DATABASE_URL, or DATABASE_URL), and takes its identity from <NAME>_APP_KEY (STRIPE_APP_KEY: a snxk_… private key; a new
# key is a new app). Nothing is written to the container: it needs no volume.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
ARG APP
RUN test -n "$APP" || (echo "Set --build-arg APP=<folder in apps/>" >&2; exit 1)
COPY . .
# This app and what it depends on, plus the root (esbuild)
RUN pnpm install --frozen-lockfile --filter . --filter "{./apps/${APP}}..." \
  && node scripts/bundle-app.mjs "apps/${APP}"

FROM node:22-alpine
ARG APP
WORKDIR /app
COPY --from=build /app/apps/${APP}/dist/ ./
USER node
ENV NODE_ENV=production PORT=4600
EXPOSE 4600
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/shopnex/app.js" || exit 1
CMD ["node", "server.mjs"]
