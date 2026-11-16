# Cambo Supply — Full-Stack Rebuild Design

Date: 2026-11-16
Status: Draft, awaiting approval

## 1. Intent

Rebuild the Cambo Supply store (today: a single static HTML page at
cambokbstore.pages.dev that reads products from Firebase Firestore and sends
orders to a Telegram bot) as a production-grade web application:

- React frontend, Node/Express API, PostgreSQL database.
- Customer accounts (sign up, log in, order history). Sign-up verifies the
  customer's phone number through the store's Telegram bot; login is phone +
  password. No email anywhere.
- An admin role and dashboard to run the store: products, banners, promo
  codes, orders, store settings.
- Same look as today: dark-only theme, mobile-first, fully responsive up to
  desktop.
- Online payment is **out of scope for now**. The owner will integrate KHQR /
  Bakong next, so the order and payment data model must be ready for it.

Why: the current site has no real backend. Orders exist only as Telegram
messages, products are edited in the Firebase console, images are stored as
base64 text in the database (slow to load), and the bot token and API key are
exposed in the page source. The rebuild turns it into a store the owner can
operate and grow.

## 2. Goals, non-goals, anti-goals

**Goals**
- Feature parity with the current storefront (section 4).
- Orders stored in Postgres with a status lifecycle the admin manages.
- Server is the source of truth for prices, stock, delivery fee and discounts.
- Secure by default: no secrets in the browser, hardened auth, input
  validation everywhere.
- Deployable with Docker; reproducible dev setup with one command.
- Seeded with the 44 scraped products and 3 banners.

**Non-goals (for this phase)**
- Online payment (KHQR / Bakong / ABA). Only a placeholder + data model.
- Email (no email field, no email verification, no email sending).
- Automatic login inside the Telegram Mini App (site still works when opened
  in Telegram; customers log in with phone + password there too).
- Khmer language UI (English only; strings kept in one place so i18n can be
  added later).
- Light mode.
- Multi-store, multi-currency (USD only), inventory per variant (each
  product is one SKU; color/size variants are separate products, as today).

**Anti-goals (would be a failure even if it "works")**
- Trusting totals, prices or fees sent by the client.
- Overselling: two customers buying the last unit.
- Secrets (Telegram token, DB URL, session secret) reaching the frontend bundle.
- A redesign that no longer looks like the current store.
- Images served as base64 blobs from the API.

## 3. Approaches considered

| | A. Separate SPA + API (chosen) | B. Express serves built SPA | C. Next.js full-stack |
|---|---|---|---|
| Shape | `web` (React/Vite) + `api` + `file` + `report` services in one monorepo | Same code, single server | One framework for UI + API |
| Deploy | Web on a CDN (Cloudflare Pages, as today); API + Postgres on a Node host | One process | Vercel/Node |
| Trade-off | Two deploy targets; best caching and scaling | Simplest hosting; no CDN benefits | Owner asked for Express |

**Chosen: A.** Matches how the store is hosted today, keeps the API reusable
for a future mobile/Telegram client and the Bakong callback, and lets the
storefront load from a CDN. B stays possible: the API can optionally serve the
built web app, configured by an env flag, for single-box hosting. C is dropped
because Express was requested.

## 4. Storefront features (parity with current site)

From the current page's code:

- Header: logo, brand, cart pill with item count.
- Search (name / description / category).
- Banner carousel (auto-advance, dots, swipe).
- Category filter chips: All, Keyboards, Mice, Mousepads, Accessories
  (categories become admin-managed).
- Product grid: image, category tag, name, short specs line, price, "Add"
  button, "Sold out" badge, photo-count badge.
- Product detail drawer/page: image gallery with thumbnails and counter, spec
  table (label/value rows), price, quantity, add to cart. Gets its own URL
  (`/products/:slug`) so it can be shared; on mobile it opens as a bottom
  sheet, on desktop as a page/modal.
- Cart drawer: line items, quantity +/-, remove, subtotal, toast on add.
  Cart persists in localStorage for guests and syncs to the account on login.
- Checkout (requires login):
  - Name (prefilled from profile), phone (required).
  - Region: Phnom Penh or Province.
  - Delivery service: Grab (Phnom Penh only), VET, J&T.
  - Address / note; "use my location" pin (browser geolocation) **plus** a
    small map (Leaflet + OpenStreetMap, no API key) to adjust the pin.
  - Delivery fee (server-computed, rates admin-editable):
    - Province: $2.00.
    - Phnom Penh, Grab, with pin: distance from store ≤3 km $1.50, ≤5 km
      $2.00, else $2.50.
    - Phnom Penh otherwise: $1.50.
  - Promo code: apply/remove, shows discount line.
  - Payment method: Cash on Delivery (Phnom Penh only) or "KHQR — coming
    soon" (visible, disabled) until Bakong is integrated.
  - Order summary and confirm; success screen with order number.
- Account: profile (name, default address; phone shown, changeable only by
  re-verifying through Telegram), change password, log out of all devices,
  order history, order detail with status timeline.
- Sign up / log in / forgot password screens (flow in section 9).

## 5. Admin dashboard (`/admin`, role ADMIN only)

- **Dashboard:** today's / this week's orders and revenue, pending orders
  count, low-stock list.
- **Orders:** list with filters (status, date, search by number/phone), detail
  view, change status (with note), mark payment status, view map pin link,
  print-friendly packing view.
- **Products:** create/edit/archive; name, slug, category, short specs line,
  description, price, compare-at price (optional), stock quantity, sold-out
  toggle, spec rows (label/value, reorderable), images (multi-upload,
  reorder, delete), sort order (drag to reorder), active/hidden.
- **Banners:** upload, link (optional), order, active toggle.
- **Categories:** name, slug, sort order.
- **Promo codes:** code, type (fixed / percent), value, minimum subtotal,
  start/end date, usage limit total and per user, active toggle.
- **Customers:** list, view orders, disable account, change role (admin ↔ customer).
- **Reports:** sales by day/month with chart, top products, payment and
  region breakdown, CSV export; invoice PDF on every order.
- **Settings:** store name, store coordinates, delivery rates and distance
  tiers, Telegram notification on/off.

Admin UI is a separate lazy-loaded section of the same React app (not shipped
to customers' first load).

## 6. Architecture

Four services (owner's decision), each in its own top-level folder and
deployable on its own, plus shared code:

```
cambo-supply/
  web/      React 19 + Vite 7 SPA                        :5173 (dev)
  api/      Express 5 + Prisma — auth, catalog, orders   :4000  ← the only service the browser calls for data
  file/     Express 5 + sharp — uploads, image variants,
            serves /files/* (local) or writes to S3/R2   :4100
  report/   Express 5 + jsreport + pg — invoice PDFs,
            sales reports, CSV export                    :4200
  shared/   zod schemas, money/phone/delivery rules (used by all)
  docker/   one Dockerfile per service, nginx config
  docker-compose.yml        dev: postgres (+ all services)
  docker-compose.prod.yml   prod example
```

```
browser ──► web (static)          browser ──► file  GET /files/* (images, public, cached)
browser ──► api ──► Postgres (read/write)
             ├──► file    POST/DELETE /internal/*  (bearer FILE_SERVICE_SECRET)
             └──► report  GET /internal/*          (bearer REPORT_SERVICE_SECRET)
                             └──► Postgres (read-only role)
```

- **Auth stays in the api.** file and report have no user accounts; their
  `/internal/*` routes accept only the api's shared secret and are not
  exposed publicly (private network / firewall). The api checks who the
  user is and what they may see, then calls the service.
- Package manager: npm workspaces (Node 22+).
- TypeScript everywhere (strict). Shared zod schemas validate on both sides.

### 6.1 Frontend (`web`)
- React 19, Vite 7, TypeScript, React Router (data routers, lazy routes).
- TanStack Query for server state; Zustand for cart/UI state.
- Tailwind CSS v4 with the current site's design tokens (`--bg #14171c`,
  `--surface #181c24`, `--yellow #ffb703`, etc.), fonts Plus Jakarta Sans and
  Space Grotesk. Dark only.
- react-hook-form + zod for forms.
- Responsive: mobile-first (current site is a 520px column); grid 2 cols
  mobile → 3 tablet → 4–5 desktop; drawers become side panels on desktop.
- Images: `<img srcset>` with WebP sizes, lazy loading, fixed aspect ratios to
  avoid layout shift.
- Accessibility: keyboard navigable drawers (focus trap), labels, contrast
  checked against the dark palette.
- SEO basics: per-page titles/meta, Open Graph tags for product pages.

### 6.2 API (`api`)
- Express 5, TypeScript, Prisma ORM with migrations, PostgreSQL 17 (Prisma 6).
- Layered: routes → controllers → services → Prisma. Services hold business
  rules (pricing, stock, promo) and are unit-tested.
- Versioned REST under `/api/v1`. JSON errors in one shape:
  `{ error: { code, message, details? } }`.
- Validation: zod on every body/query/param.
- Config: env validated with zod at startup; app refuses to boot on bad config.
- Logging: pino (JSON), request IDs, no secrets/PII in logs.
- Health: `/healthz` (process) and `/readyz` (DB reachable).
- Graceful shutdown on SIGTERM.

### 6.3 Key endpoints (sketch)
- Auth: `POST /auth/telegram/start` (purpose: signup | reset | change-phone →
  returns a bot deep link + request id), `GET /auth/telegram/:id/status`
  (polled by the page), `POST /auth/signup/complete` (request id + name +
  password), `POST /auth/reset/complete` (request id + new password),
  `POST /auth/login` (phone + password), `POST /auth/logout`,
  `POST /auth/logout-all`, `POST /auth/change-password`, `GET /auth/me`.
- Telegram: `POST /telegram/webhook` (bot updates; secret-header checked).
- Catalog (public): `GET /products`, `/products/:slug`, `/categories`,
  `/banners`.
- Cart/checkout: `POST /checkout/quote` (returns server-computed subtotal,
  fee, discount, total), `POST /orders`, `GET /orders` (mine),
  `GET /orders/:number`.
- Account: `GET/PATCH /me`.
- Admin: `/admin/products`, `/admin/categories`, `/admin/banners`,
  `/admin/promos`, `/admin/orders`, `/admin/customers`, `/admin/settings`,
  `/admin/uploads`, `/admin/stats`, `/admin/reports/*`.
- Invoices: `GET /orders/:number/invoice.pdf` (owner), `GET /admin/orders/:id/invoice.pdf`.

## 7. Data model (Prisma, summarized)

All money in **integer cents (USD)**. All tables have `createdAt`, `updatedAt`.

- **User**: id (uuid), phone (unique, E.164, e.g. `+85512345678`),
  passwordHash, name, telegramUserId (unique, bigint), telegramChatId,
  telegramUsername, role (CUSTOMER | ADMIN), passwordChangedAt, disabledAt.
- **Session**: id, userId, tokenHash, userAgent, ip, expiresAt, revokedAt.
- **TelegramAuthRequest**: id, tokenHash (deep-link token), purpose (SIGNUP |
  RESET | CHANGE_PHONE), status (PENDING | VERIFIED | COMPLETED | EXPIRED),
  phone, telegramUserId, telegramChatId, telegramUsername, firstName,
  userId (for RESET/CHANGE_PHONE), expiresAt, verifiedAt, completedAt.
- **Address**: userId, label, region (PHNOM_PENH | PROVINCE), addressLine,
  lat, lng, isDefault.
- **Category**: id, name, slug, sortOrder.
- **Product**: id, slug (unique), name, categoryId, specsLine, description,
  priceCents, compareAtCents, stock, isSoldOut, isActive, sortOrder.
- **ProductSpec**: productId, label, value, sortOrder.
- **ProductImage**: productId, storageKey, width, height, sortOrder.
- **Banner**: id, storageKey, linkUrl, sortOrder, isActive.
- **PromoCode**: code (unique, uppercase), type (FIXED | PERCENT), value,
  minSubtotalCents, startsAt, endsAt, maxUses, maxUsesPerUser, usedCount,
  isActive.
- **Order**: id, number (human-readable, e.g. `CS-250001`), userId, status,
  contact name/phone snapshot, region, deliveryService, addressLine, lat,
  lng, distanceKm, subtotalCents, deliveryFeeCents, discountCents,
  totalCents, promoCodeId, note.
  - `status`: PENDING → CONFIRMED → PACKED → SHIPPING → DELIVERED;
    CANCELLED from any pre-shipping state.
- **OrderItem**: orderId, productId, name/price/image **snapshot**, quantity,
  lineTotalCents.
- **OrderStatusEvent**: orderId, fromStatus, toStatus, note, actorUserId, at.
- **Payment** (ready for KHQR): orderId, method (COD | KHQR), status
  (UNPAID | PENDING | PAID | FAILED | EXPIRED | REFUNDED), amountCents,
  currency, provider, providerRef (e.g. Bakong md5 / bill number), qrString,
  expiresAt, paidAt, rawPayload (jsonb).
- **StoreSetting**: single row; storeLat/Lng, rate table (jsonb), Telegram
  notify flag.

## 8. Business rules (server-side)

- **Quote and order total** are computed only on the server from DB prices,
  current settings and the promo code. Client totals are display-only.
- **Distance**: Haversine from store coordinates to customer pin.
- **Stock**: order creation runs in one transaction; product rows are locked
  (`SELECT … FOR UPDATE`) and stock decremented; insufficient stock → 409
  with the affected items. Cancelling an order restocks.
- **Promo**: validated at quote and again at order creation (dates, usage
  limits, minimum subtotal); `usedCount` incremented in the same transaction.
- **COD** allowed only for Phnom Penh. **KHQR** rejected with a clear
  "not available yet" error until enabled.
- **Idempotency**: `POST /orders` accepts an `Idempotency-Key` header so a
  double-tap does not create two orders.
- **Order notification**: after commit, enqueue a Telegram message to the
  admin chat (token and chat id server-side env only). Failure to notify
  never fails the order; it is logged and retried a few times.

## 9. Auth and security

- **Sign-up flow (Telegram phone verification)**:
  1. Customer taps "Sign up with Telegram". API creates a
     `TelegramAuthRequest` (10-minute expiry) and returns
     `https://t.me/<bot>?start=<token>`; the page opens it and shows "Waiting
     for Telegram…".
  2. In Telegram the bot receives `/start <token>` and replies with a
     one-tap "📱 Share my phone number" keyboard button (`request_contact`).
  3. Customer taps it. The bot accepts the contact **only if
     `contact.user_id` equals the sender's id** (rejects forwarded or typed
     contacts of other people), normalizes the number to E.164, and marks
     the request VERIFIED. Bot replies "Verified — go back to the website."
  4. The page (polling status every 2 s) sees VERIFIED and shows a form:
     name (prefilled from Telegram first name) and password + confirm.
  5. `signup/complete` creates the user with the verified phone and
     Telegram ids, marks the request COMPLETED (single use) and logs them in.
  - If the phone is already registered, the bot says so and the page offers
    "Log in" or "Forgot password".
- **Login**: phone + password. Phone input accepts local formats
  (`012 345 678`, `+855…`) and normalizes with libphonenumber-js (default
  region KH).
- **Forgot password**: customer enters phone → same deep-link flow with
  purpose RESET → bot asks to share contact; it must match the account's
  phone **and** Telegram user id → page shows "set new password" →
  all other sessions are revoked. Responses never reveal whether a phone is
  registered.
- **Change phone**: from the account page, same flow with purpose
  CHANGE_PHONE; new number must be unused.
- **Bot**: one bot for login and admin order alerts. Production receives
  updates by webhook (`setWebhook` with a secret token, verified on every
  request); development uses long polling. Bot token is server-side only.
- **Passwords**: argon2id; minimum 8 chars, checked against a small
  common-password list.
- **Sessions**: opaque random token in an `httpOnly; Secure; SameSite=Lax`
  cookie, hashed (SHA-256) in the `Session` table; 30-day sliding expiry;
  revocable (logout, logout-all, password change revokes others). Chosen
  over JWT because sessions can be revoked instantly and nothing sensitive
  lives in the browser.
- **Domains**: web on `shop.<domain>`, API on `api.<domain>` (same site),
  cookie scoped to the parent domain. CORS allowlist = web origin only, with
  credentials.
- **CSRF**: SameSite=Lax plus Origin/Referer check on all state-changing
  requests.
- **Deep-link tokens**: 32 random bytes, stored hashed, single use, 10-minute
  expiry; status endpoint only returns state for the browser that started
  the request (request id bound to a short-lived httpOnly cookie).
- **Rate limits**: login (per IP and per phone, with lockout backoff),
  Telegram auth start, password reset, order creation. In-memory store for a single API instance; Redis store
  swappable via config when scaling out.
- **Authorization**: `requireAuth` and `requireRole('ADMIN')` middleware; every
  admin route covered by tests that a customer gets 403.
- **Headers**: helmet (CSP for the API), body size limits, uploads limited by
  type (jpeg/png/webp) and size (≤8 MB), filenames never trusted.
- **First admin**: the owner signs up normally through Telegram, then a CLI
  script promotes that phone (`npm run admin:promote -w api -- +855…`).
  After that, admins can make other accounts admin (or back to customer) from
  Admin → Customers; nobody can change their own role and the last admin can't
  be removed. Customer-facing endpoints never grant roles.
- **Secrets** only in server env. The current site's exposed Telegram bot
  token and Firebase key should be rotated by the owner.

## 10. File service (`file`)

- Admin uploads go to the api (which checks the admin session, size ≤8 MB,
  type jpeg/png/webp), and the api forwards the bytes to the file service.
- File service processes images with sharp: strip metadata, auto-rotate,
  resize to 3 widths (400, 800, 1200, no upscaling), WebP. Returns
  `{ storageKey, width, height }`; the api stores the key in Postgres.
- Storage adapter inside the file service: local disk (dev, single box;
  served at `GET /files/*` with immutable cache headers) or S3-compatible
  (Cloudflare R2 / S3) for production, where a CDN/bucket domain serves files.
- Also accepts generic files (`POST /internal/files`, e.g. future payment
  proofs) with a type allowlist.
- Image URLs are built from `PUBLIC_FILES_URL` + key; the api returns full
  URLs per size.

## 10b. Report service (`report`)

Owner's decision: invoices and sales reports.

- **Invoice PDF** per order (owner's decision: jsreport — an HTML/CSS Handlebars
  template, `report/templates/invoice.html`, printed to A4 by headless Chrome,
  embedded in the report service; English, Khmer addresses render correctly): store name and
  logo, order number and date, customer name and phone, delivery
  region/service/address, line items (qty, name, unit price, line total),
  subtotal, delivery fee, discount (with code), total, payment method and
  status, order status. Generated on demand (no stored copies), filename
  `invoice-CS-250001.pdf`.
  - Customer downloads from their order page; admin downloads/prints from
    the order detail.
- **Sales reports** (admin only): for a date range in Asia/Phnom_Penh time,
  grouped by day or month — orders, units, revenue (non-cancelled orders),
  average order value; top products by units and revenue; breakdown by
  payment method and delivery region. CSV export of the orders in the range.
  Shown in the admin dashboard with a chart.
- Reads Postgres through a **read-only role** with plain SQL (`pg`), so a bug
  in reporting can never change data.

## 11. Seed data

- Script imports `scrape/products.json` + images: creates categories
  (keyboard, mouse, deskmat → "Mousepads", accessories), 44 products, specs,
  images (processed through the same pipeline), 3 banners, store settings
  (store at 11.5714, 104.8872; current rates), and a demo promo code.
- Duplicate scraped listings (e.g. the 21 identical mousepads) are imported
  as-is with a numeric suffix in the slug; the owner can rename or merge them
  in admin.

## 12. Quality, testing, delivery

- **Tests**: Vitest. API: unit tests for pricing/delivery/promo/stock rules;
  integration tests with Supertest against a real Postgres (Docker,
  per-run schema). Web: component tests for cart and checkout logic. One
  Playwright smoke test: browse → add to cart → sign up → checkout (COD).
- **Lint/format**: ESLint + Prettier; `tsc --noEmit` in CI.
- **CI**: GitHub Actions — install, lint, typecheck, test (with Postgres
  service), build both apps, build Docker images.
- **Docker**: multi-stage images, non-root user; API image runs
  `prisma migrate deploy` on start.
- **Dev**: local Postgres or `docker compose up db`; `npm run dev` runs web + api with
  hot reload; `npm run db:seed` loads the scraped catalog.
- **Docs**: README (setup, env vars, deploy, creating an admin) and
  `.env.example` for each app.

## 13. Payment readiness (for the KHQR / Bakong phase)

Not built now, but the design leaves a clean slot:
- `Payment` table already holds provider ref, QR string, expiry, raw payload.
- A `PaymentProvider` interface in the API (`createCharge`, `checkStatus`,
  `handleWebhook`) with a `CodProvider` implemented now; `KhqrProvider` added
  later (generate KHQR via Bakong, poll/check transaction by md5, mark PAID).
- Checkout UI already has the payment-method step; KHQR option is shown as
  "coming soon".

## 14. Decided by the owner

- Stack: React, Node + Express, PostgreSQL.
- Customer auth and an admin role.
- Telegram bot sign-up by sharing phone number, then set a password; no
  email.
- Four separate services in top-level folders: web, api, file (storage),
  report (invoices + sales reports).
- Invoices built with jsreport (HTML template → PDF).
- Production quality, responsive, dark mode only like the current site.
- Payment skipped for now; KHQR / Bakong later.

## 15. Calls made by the designer (owner to check)

1. Approach A (separate web + API, monorepo).
2. TypeScript throughout.
3. Login required to check out (no guest checkout). Since every account has
   a Telegram-verified phone, no extra verification step at checkout.
4. Sign-up by sharing phone through the Telegram bot, then phone + password
   login (owner's decision). Designer calls within it: only the sender's own
   contact is accepted; the page polls for verification; the same bot does
   password reset and phone change.
5. Server sessions in Postgres over JWT.
6. COD available now; KHQR shown as "coming soon".
7. Telegram new-order alert kept (server-side, optional).
8. Leaflet/OpenStreetMap map for pin adjustment (no Google Maps key).
9. English only; no automatic Mini App login this phase.
10. Images stored on local disk in dev and S3/R2 in production, owned by the
    file service.
11. Uploads pass through the api (auth) to the file service; report reads
    Postgres with a read-only role; internal calls use shared secrets.

## 16. Left to the builder

Exact component breakdown, folder structure inside each app, migration
naming, pagination sizes, exact admin table layouts, and test fixtures —
within the constraints above.
