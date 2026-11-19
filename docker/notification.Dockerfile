# syntax=docker/dockerfile:1.7
# Build context: repository root.  docker build -f docker/notification.Dockerfile .

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY service-kit/package.json service-kit/
COPY notification/package.json notification/
RUN npm ci --workspace notification --include-workspace-root
COPY shared shared
COPY service-kit service-kit
COPY notification notification
RUN npm run build --workspace notification \
 && npm prune --omit=dev --workspace notification --include-workspace-root

FROM node:22-alpine
RUN apk add --no-cache tini
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/notification/package.json notification/package.json
COPY --from=build --chown=node:node /app/notification/dist notification/dist
COPY --from=build --chown=node:node /app/notification/migrations notification/migrations
USER node
WORKDIR /app/notification
EXPOSE 4300
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:4300/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
