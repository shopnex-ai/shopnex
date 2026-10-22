# Shopnex admin, API and hosted checkout in one image. Used by the one-click deploys (Render, DigitalOcean…).
FROM node:24-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# Platforms like Render only expose their public URL as RENDER_EXTERNAL_URL.
# Migrations are idempotent, so running them on every start also covers updates.
CMD ["sh", "-c", "export APP_URL=${APP_URL:-$RENDER_EXTERNAL_URL} BETTER_AUTH_URL=${BETTER_AUTH_URL:-${APP_URL:-$RENDER_EXTERNAL_URL}}; : ${BETTER_AUTH_SECRET:?set BETTER_AUTH_SECRET}; pnpm db:migrate && cd apps/admin-ui && node .output/server/index.mjs"]
