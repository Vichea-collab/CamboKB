# syntax=docker/dockerfile:1.7
# Build context: repository root.  docker build -f docker/web.Dockerfile .
# Serves the built SPA and proxies /api and /files to the services, so the
# browser sees one origin (session cookie and CSRF origin check just work).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY web/package.json web/
RUN npm ci --workspace web --include-workspace-root
COPY shared shared
COPY web web
ARG VITE_API_URL=
ARG VITE_TELEGRAM_BOT_USERNAME=
# Public address of the shop (https://shop.example.com): link previews need absolute URLs.
ARG VITE_SITE_URL=
ENV VITE_API_URL=$VITE_API_URL VITE_TELEGRAM_BOT_USERNAME=$VITE_TELEGRAM_BOT_USERNAME VITE_SITE_URL=$VITE_SITE_URL
RUN npm run build --workspace web

FROM nginx:1.27-alpine
# nginx's entrypoint fills ${CSP_*} variables into these templates at start.
COPY docker/nginx/ /etc/nginx/templates/
ENV NGINX_ENVSUBST_FILTER=^CSP_ CSP_EXTRA_IMG=""
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1
