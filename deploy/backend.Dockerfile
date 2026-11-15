# Medusa backend image. One image serves three roles, chosen at runtime:
#   migrate  medusa db:migrate (one-off, before server/worker start)
#   server   MEDUSA_WORKER_MODE=server  (HTTP API + Admin)
#   worker   MEDUSA_WORKER_MODE=worker  (subscribers, scheduled jobs)
# Build context: repository root.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH MEDUSA_DISABLE_TELEMETRY=true
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/backend/package.json apps/backend/
RUN pnpm install --frozen-lockfile --filter @store/backend
COPY apps/backend apps/backend
# Admin talks to the API on its own origin (no backend URL baked in), so the
# image is not tied to a domain.
RUN pnpm --filter @store/backend build \
 && pnpm --filter @store/backend deploy --prod --legacy /deps

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=9000 SEEDS_DIR=/app/seeds MEDUSA_DISABLE_TELEMETRY=true
WORKDIR /app
COPY --from=build /deps/node_modules ./node_modules
COPY --from=build /repo/apps/backend/.medusa/server ./
COPY seeds ./seeds
# ./static holds uploads when no S3 bucket is configured (mount a volume there).
RUN mkdir -p static && chown node:node static
USER node
EXPOSE 9000
CMD ["node_modules/.bin/medusa", "start"]
