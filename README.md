# Cambo Supply

Online store for mechanical keyboards, mice, mousepads and desk accessories in
Cambodia. Customers sign up by sharing their phone number with the store's
Telegram bot, then log in with phone + password. Admins run the shop from
`/admin`: products, banners, promo codes, orders, customers, reports and invoices.

Design and decisions: [`docs/superpowers/specs/2026-11-16-cambo-supply-rebuild-design.md`](docs/superpowers/specs/2026-11-16-cambo-supply-rebuild-design.md)

## Services

| Folder | What it does | Port |
|---|---|---|
| `web/` | React 19 + Vite storefront and admin (dark theme, mobile-first) | 5173 dev / 80 in Docker |
| `api/` | Express 5 + Prisma + PostgreSQL. Auth, catalog, cart pricing, orders, admin, Telegram bot | 4000 |
| `file/` | Image uploads: resizes to WebP (400/800/1200 px), stores on disk or S3/R2, serves `/files/*` | 4100 |
| `report/` | Invoice PDFs (jsreport: HTML template → headless Chrome) and sales reports / CSV, read-only DB access | 4200 |
| `shared/` | Business rules and validation used by every service (money, phone numbers, delivery fees, promo maths) | — |

The browser only talks to `web` (and `api`/`file` through it). `api` calls `file`
and `report` on `/internal/*` with shared secrets; those routes must stay private.

```
browser ─► web (nginx) ─► /api   ─► api ─► PostgreSQL
                        └► /files ─► file        │
                                  api ─► file   (/internal, FILE_SERVICE_SECRET)
                                  api ─► report (/internal, REPORT_SERVICE_SECRET) ─► PostgreSQL (read-only)
```

## Run it locally

Requirements: Node 22+, PostgreSQL 17 (local install, or `docker compose up db`).

```bash
npm install                         # all workspaces
cp api/.env.example api/.env        # then set DATABASE_URL and the Telegram bot (below)
cp file/.env.example file/.env
cp report/.env.example report/.env  # REPORT_DATABASE_URL can be your normal DB URL locally
cp web/.env.example web/.env.local

npx prisma migrate deploy --schema api/prisma/schema.prisma   # with DATABASE_URL exported
npm run dev                         # starts file, report, api and web together
npm run db:seed                     # in another terminal: 44 products, photos, banners, CAMBOKBSHOP promo
```

Open http://localhost:5173.

### Telegram bot

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. In `api/.env`: `TELEGRAM_MODE=polling`, `TELEGRAM_BOT_TOKEN=…`, `TELEGRAM_BOT_USERNAME=YourBot`.
3. For new-order alerts, set `TELEGRAM_ADMIN_CHAT_ID` to your Telegram user id or a group id
   (send a message to [@userinfobot](https://t.me/userinfobot) to get yours).

Polling is for development. Production uses a webhook (`TELEGRAM_MODE=webhook`,
`TELEGRAM_WEBHOOK_URL=https://your-domain/api/v1/telegram/webhook`, a random
`TELEGRAM_WEBHOOK_SECRET`); the api registers it on start.

What customers get from the bot, with no extra setup (they've already started it when they sign up):

- A message when their order is received, confirmed, packed, on the way, delivered or cancelled.
  Internal admin notes are never included. A Telegram outage never blocks an order or a status change.
- `/orders` (their latest orders), `/shop` (opens the store; as a Telegram app when the site is on https), `/help`.
- The command menu is registered automatically each time the api starts. On an https site the bot's
  menu button also opens the store as a Telegram app.

### Make yourself an admin

Sign up on the site through Telegram first, then:

```bash
npm run admin:promote -w api -- 012345678
```

The public API can never grant the admin role.

## Tests

```bash
npm test            # every workspace (api and report need PostgreSQL: DATABASE_URL_TEST)
npm run lint
npm run typecheck
```

The api and report suites create `cambo_supply_test` and migrate it automatically.

## Deploy

`docker-compose.prod.yml` runs everything on one server behind nginx:

```bash
cp .env.production.example .env.production   # fill in every value
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Then, once per database, create the read-only reporting login:

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U "$POSTGRES_USER" -d cambo_supply -v password="$REPORT_DB_PASSWORD" < report/sql/readonly-role.sql
```

Checklist:

- [ ] TLS in front of port 80 (Caddy, Cloudflare, a load balancer); `PUBLIC_ORIGIN` is the https URL.
- [ ] `FILE_SERVICE_SECRET`, `REPORT_SERVICE_SECRET`, `TELEGRAM_WEBHOOK_SECRET`: 32+ random characters each
      (`openssl rand -base64 36`). Services refuse to start in production with short or default secrets.
- [ ] Fill in Admin → Settings → Contact and policies (phone, hours, warranty), then submit the sitemap to Google Search Console.
- [ ] Images on S3/Cloudflare R2 (`STORAGE_DRIVER=s3`) or back up the `uploads` volume.
- [ ] Database backups (e.g. nightly `pg_dump`).
- [ ] **Rotate the old Telegram bot token and Firebase key** that were visible in the old site's page source,
      and treat any token that was pasted into a chat as exposed.

Hosting the web app on a CDN (e.g. Cloudflare Pages) instead: build `web` with
`VITE_API_URL=https://api.your-domain`, serve the api on a sibling subdomain, and set
`COOKIE_DOMAIN=.your-domain` and `WEB_ORIGIN=https://shop.your-domain`.

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
   **90 days**; renew it there and update the setting. If it expires, the bot warns you (once an hour)
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
  integrations/   outside services: bakong, telegram, files, reports
  http/           express app, middleware, errors
  db/ lib/ cli/   prisma client, logger, seed and admin scripts
file/  report/    the image and invoice/report services (small, flat)
shared/           rules every service shares: money, phone numbers, delivery fees, validation
docker/ scripts/ docs/
```

## Project scripts

| Command | What it does |
|---|---|
| `npm run dev` | All four services with hot reload |
| `npm run db:seed` | Load the scraped catalog (needs the file service running) |
| `npm run admin:promote -w api -- <phone>` | Make an account an admin |
| `npm run build` | Production builds of every service |
