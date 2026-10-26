# One bundled app (apps/<name>, built on @shopnex/app) as its own small image: the app is bundled into a single
# file, so the runtime image holds only Node and that file.
#
#   docker build -f Dockerfile.app --build-arg APP=stripe -t shopnex-app-stripe .
#   docker run -p 4600:4600 -e STRIPE_APP_URL=https://stripe.example.com -v stripe_data:/data shopnex-app-stripe
#
# The app reads <NAME>_APP_URL (its public origin; give Shopnex the same) and keeps its identity key and data in
# /data: mount a volume there, or it is a new app after every recreate.
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
COPY --from=build /app/apps/${APP}/dist/server.mjs ./server.mjs
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
ENV NODE_ENV=production PORT=4600 DATA_DIR=/data
EXPOSE 4600
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/shopnex/app.js" || exit 1
CMD ["node", "server.mjs"]
