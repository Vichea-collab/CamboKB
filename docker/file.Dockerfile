# syntax=docker/dockerfile:1.7
# Build context: repository root.  docker build -f docker/file.Dockerfile .

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY file/package.json file/
RUN npm ci --workspace file --include-workspace-root
COPY file file
RUN npm run build --workspace file \
 && npm prune --omit=dev --workspace file --include-workspace-root

FROM node:22-alpine
RUN apk add --no-cache tini
ENV NODE_ENV=production UPLOADS_DIR=/data/uploads
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/file/package.json file/package.json
COPY --from=build --chown=node:node /app/file/dist file/dist
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
WORKDIR /app/file
VOLUME ["/data/uploads"]
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:4100/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
