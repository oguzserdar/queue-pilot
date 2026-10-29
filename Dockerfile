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

# The migration script runs before the server and imports pg and drizzle-orm directly. The standalone output keeps
# only what the server traces, so these two are installed on their own, at the versions package.json pins.
FROM base AS migrator
COPY package.json ./
RUN npm install --omit=dev --no-save --no-package-lock --prefix /migrator \
  "pg@$(node -p "require('./package.json').dependencies.pg")" \
  "drizzle-orm@$(node -p "require('./package.json').dependencies['drizzle-orm']")"

FROM node:24-alpine3.24 AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 MIGRATE_ON_START=1 PORT=3000 HOSTNAME=0.0.0.0
# The app runs with node alone. npm and corepack ship in the base image with their own dependencies, and every
# vulnerability in those would block the release scan, so the final image leaves them out.
RUN addgroup -S app && adduser -S app -G app \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
     /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/scripts/migrate-on-deploy.mjs ./scripts/migrate-on-deploy.mjs
COPY --from=migrator --chown=app:app /migrator/node_modules ./scripts/node_modules
COPY --from=build --chown=app:app /app/src/lib/env-check.mjs ./src/lib/env-check.mjs
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["sh", "-c", "node scripts/migrate-on-deploy.mjs && node server.js"]
