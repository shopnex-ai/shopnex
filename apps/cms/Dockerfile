# syntax=docker/dockerfile:1.4

# Base image
FROM node:22-slim AS base


WORKDIR /app

RUN corepack enable
RUN pnpm i -g turbo

# Copy everything (you may optimize this in multi-stage builds)
COPY . .

# Prune for Docker
RUN turbo prune @shopnex/cms --docker

# Restore and cache node_modules + turbo cache
RUN pnpm install --frozen-lockfile

WORKDIR /app/apps/cms

RUN npx payload migrate

WORKDIR /app

# Build with turbo and cache
RUN pnpm turbo run build --filter=@shopnex/cms

# Final step
WORKDIR /app/apps/cms

CMD ["pnpm", "start"]