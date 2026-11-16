# syntax=docker/dockerfile:1.7
# Build context: repository root.  docker build -f docker/api.Dockerfile .

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY api/package.json api/
RUN npm ci --workspace api --include-workspace-root
COPY shared shared
COPY api api
RUN npx prisma generate --schema api/prisma/schema.prisma \
 && npm run build --workspace api \
 && npm prune --omit=dev --workspace api --include-workspace-root

FROM node:22-alpine
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/api/package.json api/package.json
COPY --from=build --chown=node:node /app/api/prisma api/prisma
COPY --from=build --chown=node:node /app/api/dist api/dist
COPY --from=build --chown=node:node /app/api/seed-data api/seed-data
USER node
WORKDIR /app/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# Apply pending migrations, then start. Safe to run on every boot.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
