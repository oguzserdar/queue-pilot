# Queue Pilot as one self-contained image: `docker compose up`, Coolify, Railway, Render or any host that runs a
# container. Migrations run on start (MIGRATE_ON_START), then the Next.js standalone server listens on 3000.
FROM node:24-alpine3.24 AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:24-alpine3.24 AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 MIGRATE_ON_START=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/scripts/migrate-on-deploy.mjs ./scripts/migrate-on-deploy.mjs
COPY --from=build --chown=app:app /app/src/lib/env-check.mjs ./src/lib/env-check.mjs
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["sh", "-c", "node scripts/migrate-on-deploy.mjs && node server.js"]
