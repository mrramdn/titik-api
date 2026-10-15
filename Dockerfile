# One image: the Fastify API serving the PWA from the same origin.
FROM node:24-bookworm-slim AS base
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY apps apps
RUN pnpm --filter @titikapi/web build && pnpm --filter @titikapi/api build

FROM base AS deps
RUN pnpm install --frozen-lockfile --prod --filter @titikapi/api

FROM node:24-bookworm-slim
WORKDIR /workspace/apps/api
COPY --from=deps /workspace/node_modules /workspace/node_modules
COPY --from=deps /workspace/apps/api/node_modules /workspace/apps/api/node_modules
COPY --from=build /workspace/apps/api/dist ./dist
COPY apps/api/package.json apps/api/docker-entrypoint.sh ./
COPY apps/api/migrations ./migrations
COPY --from=build /workspace/apps/web/dist /app/web
COPY data /workspace/data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WEB_DIR=/app/web DATA_DIR=/workspace/data UPLOAD_DIR=/data/uploads
EXPOSE 3000
CMD ["sh", "docker-entrypoint.sh"]
