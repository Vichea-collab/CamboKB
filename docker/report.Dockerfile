# syntax=docker/dockerfile:1.7
# Build context: repository root.  docker build -f docker/report.Dockerfile .
# Debian (not Alpine): jsreport's chrome-pdf needs Chromium, and Noto fonts render
# Khmer addresses on invoices.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY report/package.json report/
RUN npm ci --workspace report --include-workspace-root
COPY shared shared
COPY report report
RUN npm run build --workspace report \
 && npm prune --omit=dev --workspace report --include-workspace-root

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-noto-core fonts-khmeros tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PUPPETEER_SKIP_DOWNLOAD=true CHROME_PATH=/usr/bin/chromium
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/report/package.json report/package.json
COPY --from=build --chown=node:node /app/report/dist report/dist
COPY --from=build --chown=node:node /app/report/templates report/templates
USER node
WORKDIR /app/report
EXPOSE 4200
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4200/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
