# Cambo Supply

Online store for mechanical keyboards, mice, mousepads and desk accessories in
Cambodia. Customers sign up by sharing their phone number with the store's
Telegram bot, then log in with phone + password. Admins run the shop from
`/admin`: products, banners, promo codes, orders, customers, reports and invoices.

Design and decisions: [`docs/superpowers/specs/2026-11-16-cambo-supply-rebuild-design.md`](docs/superpowers/specs/2026-11-16-cambo-supply-rebuild-design.md)

## Services

Five services (plus the databases and the monitoring stack). Each has one job, its own Dockerfile, its own REST
API and **its own database**. Nothing reads another service's database; they talk over REST and through events
the api queues for them. Full picture: [`docs/architecture.md`](docs/architecture.md).

| Folder | What it does | Own data | Port |
|---|---|---|---|
| `web/` | React 19 + Vite storefront and admin (dark theme, mobile-first), served by nginx | none | 5173 dev / 80 in Docker |
| `api/` | Accounts, catalog, pricing, orders, KHQR payments, admin. Express 5 + Prisma | `api-db` (Postgres) | 4000 |
| `file/` | Image uploads: resizes to WebP (400/800/1200 px), stores on disk or S3/R2, serves `/files/*` | `file-db` (asset registry) + blobs | 4100 |
| `report/` | Sales reports, CSV, invoice PDFs (jsreport + headless Chrome) | `report-db` (order facts, kept up to date by events) | 4200 |
| `notification/` | Telegram: message queue with retries, order alerts, the owner's order buttons, the bot webhook | `notification-db` (message queue, handled events) | 4300 |
| `shared/` | Rules and contracts every service shares: money, phone numbers, delivery fees, event schemas | n/a (a library) | n/a |
| `service-kit/` | Plumbing every service repeats: logger, metrics, request ids, migrations (a library) | n/a | n/a |

```
browser ─► web (nginx) ─┬─ /api/*            ─► api ──► api-db
                        ├─ /files/*          ─► file ─► file-db  + blobs
                        └─ /telegram/webhook ─► notification ─► notification-db

api ──REST /internal──► file             store and delete images
api ──events──────────► report           order snapshots  ─► report-db   (+ REST for PDFs and reports)
api ──events──────────► notification     order placed, status changed, paid, alerts
notification ──REST──► api               chat messages that need shop data; order buttons

Prometheus ─► every service's /metrics        Alloy ─► Loki (logs of every container)       Grafana shows both
```

## Run it locally

Requirements: Node 22+, PostgreSQL 17 (a local install, or `docker compose up db`; if port 5432 is taken on your machine, use `DB_PORT=5433 docker compose up db` and put that port in the `DATABASE_URL`s). Each service has its own database: `npm run dev` creates the missing ones (`cambo_files`, `cambo_reports`, `cambo_notifications`) when `psql` is available.

```bash
npm install                         # all workspaces
cp api/.env.example api/.env        # then set DATABASE_URL and the Telegram bot (below)
cp file/.env.example file/.env
cp report/.env.example report/.env
cp notification/.env.example notification/.env   # the Telegram bot lives here (below)
cp web/.env.example web/.env.local

npx prisma migrate deploy --schema api/prisma/schema.prisma   # with DATABASE_URL exported
npm run dev                         # starts file, report, notification, api and web together
npm run db:seed                     # in another terminal: 44 products, photos, banners, CAMBOKBSHOP promo
```

Open http://localhost:5173.

### Telegram bot

The bot belongs to the **notification service**.

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. In `notification/.env`: `TELEGRAM_MODE=polling`, `TELEGRAM_BOT_TOKEN=…`. In `api/.env`: `TELEGRAM_BOT_USERNAME=YourBot` (the api builds the login link from it). `TELEGRAM_WEBAPP_KEY` in `api/.env` is only for logging in inside the Telegram Mini App; it is made from the token, and `api/.env.example` shows how.
3. For new-order alerts, set `TELEGRAM_ADMIN_CHAT_ID` (in `notification/.env`) to your Telegram user id or a group id
   (send a message to [@userinfobot](https://t.me/userinfobot) to get yours).

Polling is for development. Production uses a webhook (`TELEGRAM_MODE=webhook`, a random `TELEGRAM_WEBHOOK_SECRET` made with `openssl rand -hex 32`,
and `TELEGRAM_WEBHOOK_URL=https://your-domain/telegram/webhook`); the notification service registers it on start and
nginx forwards that one path to it. Production also needs `TELEGRAM_WEBAPP_KEY` and an https `PUBLIC_ORIGIN`:
see `docs/deployment.md`, "Telegram login".

What customers get from the bot, with no extra setup (they've already started it when they sign up):

- A message when their order is received, confirmed, packed, on the way, delivered or cancelled.
  Internal admin notes are never included. A Telegram outage never blocks an order or a status change.
  On an https site each message has a **View my order** button that opens the order inside Telegram as a Mini App
  (**Order again** after an unpaid order expired); on http, as in local development, it is a plain link.
- `/orders` (their latest orders), `/shop` (opens the store; as a Telegram app when the site is on https), `/help`.
- **Share the delivery location.** At checkout (Phnom Penh), **Share location in Telegram** opens the bot with a
  "📍 Share my location" button. The location goes back to the checkout page, moves the pin and re-prices the Grab
  fee by distance from the store. It only works from the Telegram account linked to the logged-in customer, and the
  coordinates are only handed back for 10 minutes. Set where the store is in **Admin → Settings → Store location**:
  the distance is measured from that point, in a straight line.
- The command menu is registered automatically each time the api starts. On an https site the bot's
  menu button also opens the store as a Telegram app.

What you get as the shop owner (set `TELEGRAM_ADMIN_CHAT_ID`, then press the bot's **Start** in that chat once):

- A new-order alert with the items, address and map pin, plus buttons under it to work the order without
  opening the site: **Confirm → Mark packed → Out for delivery → Mark delivered**, and **Cancel** (asks
  twice; stock goes back). The buttons follow the order if it is changed on the website. KHQR orders that
  aren't paid yet have no buttons: they confirm themselves when the money arrives (you get a 💰 alert with
  the next button) and cancel themselves when the time is up.
- Only the admin chat can press them. In a group, only members whose Telegram is linked to an admin account.
- In **Admin → Settings** a status card shows whether the bot is connected and how many messages are waiting
  or failed, with a **Send test message** button. It says so plainly when the notification service can't be reached.

How messages are delivered: the api saves an event about what happened in the same transaction as the change
(`ServiceEvent` table) and delivers it to the notification service right away, retrying until it is accepted. The
notification service turns each event into messages, saves them in its own `messages` table, and sends them
immediately. If Telegram is down or rate-limiting, messages are retried in the background (5 s, 15 s, 45 s … up to
15 min, 8 tries); if the notification service itself is down, the api keeps the events and retries them (about
2.5 hours). Nothing is lost on a restart, and each notification is sent only once. Blocked users (403) are not
retried. Old rows are cleaned up after 14 days (30 for failures).

### Live admin screens

The admin pages listen to `GET /api/v1/admin/events` (Server-Sent Events), so new orders, status changes and
payments appear without a refresh, with a chime and a toast for new orders. A green dot in the sidebar shows
the stream is connected; if it drops, the browser reconnects and refreshes everything once. nginx must not
buffer this route (already configured in `docker/nginx/default.conf.template`; keep the same settings if you
put another proxy or CDN in front). Events are passed in memory inside the api process, so run **one api
instance**; to scale to several, replace `lib/events.ts` with Postgres `LISTEN/NOTIFY` or Redis pub/sub.

### Make yourself an admin

Sign up on the site through Telegram first, then:

```bash
npm run admin:promote -w api -- 012345678
```

The public API can never grant the admin role.

## Tests

```bash
npm test            # every workspace (the services need PostgreSQL, each its own test database)
npm run lint
npm run typecheck
```

Each suite creates its own test database (`cambo_supply_test`, `cambo_file_test`, `cambo_report_test`,
`cambo_notification_test`) and migrates it automatically. `api/test/integration.test.ts` starts the api, the report
service and the notification service as real HTTP servers and follows an order through all three, including the
"notification service is down, then back" case.

With Docker, `scripts/smoke.sh` checks a running stack end to end: every service and database, the services
calling each other with their secrets, metrics, logs and dashboards.

## Docker Compose, CI/CD and deployment

**Run everything locally in Docker** (each service with its own Postgres):

```bash
docker compose up --build                            # the shop on http://localhost:8080
docker compose --profile observability up --build    # + Grafana :3001 (admin/admin), Prometheus :9090
scripts/smoke.sh                                     # checks that the whole stack is wired up
```

Set `WEB_PORT`, `GRAFANA_PORT`, `PROMETHEUS_PORT` or `DB_PORT` if a port is taken, and `COMPOSE_PROJECT_NAME` to run a second copy.

**CI/CD** (`.github/workflows/`):

- `ci.yml` on every push and pull request: lint, typecheck, tests of every service (each with its own database), builds,
  and a job that starts the whole Compose stack and runs `scripts/smoke.sh`.
- On pushes to `main` and `v*` tags it also **publishes five images** to GitHub Container Registry:
  `ghcr.io/<owner>/cambokb-api`, `-file`, `-report`, `-notification`, `-web`, tagged `sha-<commit>`, `latest` (main) and the version.
- `deploy.yml` is **manual only** (Actions → Deploy → Run workflow). It uploads the Compose file to a server and runs
  `docker compose pull && up -d`. It needs repository secrets that do not exist yet, so it can't run by accident.

**Deploying is not done yet; everything is prepared**, for a DigitalOcean Droplet with Cloudflare in front (a Tunnel, nothing open to the internet) and optionally R2 for photos. The step-by-step, with the Droplet size, firewall and Cloudflare rules, is in [`docs/deployment.md`](docs/deployment.md).
In short, on a server with Docker:

```bash
cp .env.production.example .env.production   # fill in every value
docker compose -f docker-compose.prod.yml --env-file .env.production pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Checklist:

- [ ] TLS: Cloudflare terminates it (Tunnel recommended); `PUBLIC_ORIGIN` is the https URL.
- [ ] Every secret in `.env.production` is 32+ random characters (`openssl rand -base64 36`) and each database has its own
      password. Services refuse to start in production with short or default secrets.
- [ ] Fill in Admin → Settings → Contact and policies (phone, hours, warranty), then submit the sitemap to Google Search Console.
- [ ] Images on S3/Cloudflare R2 (`STORAGE_DRIVER=s3`) or back up the `uploads` volume.
- [ ] Database backups: `scripts/backup.sh` from cron, copied off the server (the report database can also be rebuilt: see below).
- [ ] Grafana and Prometheus listen on 127.0.0.1 only; reach them with `ssh -L 3001:127.0.0.1:3001 <server>`. Set `GRAFANA_ADMIN_PASSWORD`.
- [ ] **Rotate the old Telegram bot token and Firebase key** that were visible in the old site's page source,
      and treat any token that was pasted into a chat as exposed.

**Rebuilding the report database** (new install, or after restoring the api database): empty it, then run
`docker compose exec api node dist/events.js backfill`. The api re-sends every order. If events were ever given up
on (an alert fires), fix the cause and run `docker compose exec api node dist/events.js retry-failed`.

Hosting the web app on a CDN (e.g. Cloudflare Pages) instead: build `web` with
`VITE_API_URL=https://api.your-domain`, serve the api on a sibling subdomain, and set
`COOKIE_DOMAIN=.your-domain` and `WEB_ORIGIN=https://shop.your-domain`.

## Observability

Every service exposes Prometheus metrics on `/metrics` (never routed through nginx) and writes one JSON log line per
event with its `service`, `level` and `requestId`. With the `observability` profile (always on in the production
Compose file): **Prometheus** scrapes the services and cAdvisor, **Alloy** ships every container's logs to **Loki**, and
**Grafana** has two dashboards, "Cambo Supply: services" (availability, request rate, errors, response time, CPU,
memory, event backlog, Telegram queue) and "Cambo Supply: logs" (errors, search, follow one request across services).
Alert rules are in `observability/prometheus/alerts.yml`. A walk-through for the demo, including how to find the
cause of an error from its logs, is in [`docs/observability.md`](docs/observability.md).

## Store information, link previews and search engines

- **Contact details and warranty text:** Admin → Settings → "Contact and policies". They feed the footer and the
  Contact, Delivery (live fees), Warranty & returns and Privacy pages. Leave a field empty to hide it. The Privacy page
  describes what the system actually stores; have it reviewed before you rely on it as a legal document.
  Until you write warranty text, the page shows a short general message that promises nothing specific.
- **Link previews:** social and chat apps don't run JavaScript, so nginx sends their crawlers (Telegram, Facebook,
  WhatsApp, Googlebot…) a plain page with the product's name, price and photo from `GET /seo/products/:slug`
  (also contains Google "Product" structured data). People always get the normal app. Images for previews
  are 1200×630 JPEGs from `/files/og/…`. Set `VITE_SITE_URL` (the shop's public https address) when building the web
  image — previews need absolute URLs. Compose passes it from `PUBLIC_ORIGIN`.
- **Search engines:** `/robots.txt` and `/sitemap.xml` are generated by the api from the live catalogue.
  Submit `https://your-domain/sitemap.xml` in Google Search Console.
- **Security headers:** nginx sends a Content-Security-Policy, HSTS and the other standard headers on every response.
  If images come from a CDN (S3/R2 on its own domain), set `CSP_EXTRA_IMG=https://your-cdn-domain` for the `web` service.
- **Install as an app:** the web manifest and icons let phones add the shop to the home screen.

## Payments: KHQR (Bakong)

Customers can pay by scanning a KHQR with any Cambodian bank app (ABA, ACLEDA, Wing, Bakong…), in
Phnom Penh and the provinces. Cash on delivery stays Phnom Penh only.

**How it works:** checkout creates the order (stock is held) and shows a QR for the exact total,
valid 10 minutes ("Get a new QR" if it runs out). The api asks Bakong whether it was paid, every few
seconds while the customer watches and every 20 s in the background. When paid, the order confirms
itself and you and the customer get Telegram messages. Unpaid after 10 minutes → cancelled, stock back,
customer told. Every QR ever shown for an order is checked, and no QR outlives the 10 minutes.

**Turn it on:**

1. Your Bakong account ID — shown in your bank app's Bakong/KHQR section (looks like `yourname@aclb`).
2. A Bakong Open API token: register your email at https://api-bakong.nbc.gov.kh. It expires every
   **90 days**; renew it there and update the setting. If it expires, the shop owner gets a Telegram warning (once an hour)
   and paid orders wait until you renew (nothing is lost, they're re-checked).
3. In `api/.env` (or your production secrets): `BAKONG_ACCOUNT_ID=…` and `BAKONG_TOKEN=…`, then restart the api.
   KHQR appears at checkout only when both are set.
4. **Test with a small real order** (e.g. a $0.50 test product) and pay it from your phone before announcing it.

Optional: `BAKONG_MERCHANT_NAME`/`CITY` (what the payer's app shows), `KHQR_QR_TTL_MINUTES`,
`KHQR_ORDER_HOLD_MINUTES`. Bakong's API may refuse requests from outside Cambodia; if your server is
abroad, set `BAKONG_API_URL` to a small relay hosted in Cambodia.

Admins see "Waiting for KHQR payment" and a **Check payment now** button on the order. Payments that
don't match (wrong amount or account) are never accepted and are reported to you. Money that arrives
after an order was cancelled is recorded as paid and flagged for a refund.

## Project layout

```
web/src/
  app/            router, store layout, header and footer
  features/       one folder per feature: catalog, cart, checkout, payments, auth,
                  account, orders, info, admin (pages, components, hooks and tests together)
  shared/         ui (buttons, drawer, inputs, map) and lib (api client, strings, types)
api/src/
  modules/        one folder per feature: auth, account, catalog, orders, payments,
                  promos, customers, store, dashboard, reports, seo, bot (routes, logic, tests)
  integrations/   outside services: bakong, files, reports, and the events sent to report and notification
  http/           express app, middleware, errors
  db/ lib/ cli/   prisma client, logger, seed and admin scripts
file/ report/ notification/   the other services (small, flat), each with migrations/ for its own database
shared/           rules and contracts every service shares: money, phone numbers, delivery fees, validation, events
service-kit/      logger, metrics, request ids, migrations (used by every service)
docker/ observability/ scripts/ docs/
```

## Project scripts

| Command | What it does |
|---|---|
| `npm run dev` | All five services with hot reload |
| `npm run db:seed` | Load the scraped catalog (needs the file service running) |
| `npm run admin:promote -w api -- <phone>` | Make an account an admin |
| `npm run events -w @cambo/api -- backfill` | Re-send every order to the report service |
| `scripts/smoke.sh` | Check a running Docker stack end to end |
| `npm run build` | Production builds of every service |
