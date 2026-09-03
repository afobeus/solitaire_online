# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY client client
COPY shared shared
COPY server server
COPY migrations migrations
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/solitaire.sqlite
WORKDIR /app
RUN groupadd --system --gid 10001 game && useradd --system --uid 10001 --gid game --home-dir /app game
COPY --from=build --chown=game:game /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build --chown=game:game /app/node_modules ./node_modules
COPY --from=build --chown=game:game /app/dist ./dist
COPY --from=build --chown=game:game /app/migrations ./migrations
COPY --chown=game:game scripts/database.mjs ./scripts/database.mjs
RUN mkdir -p /data /backups && chown game:game /data /backups
USER game
EXPOSE 3000
CMD ["node","dist/server/index.js"]
