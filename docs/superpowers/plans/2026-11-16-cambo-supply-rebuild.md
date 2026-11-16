# Cambo Supply Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Cambo Supply store as a React + Express + PostgreSQL app with Telegram-phone sign-up, phone+password login, a customer storefront/checkout (COD, KHQR placeholder) and an admin dashboard.

**Architecture:** npm-workspaces monorepo: `apps/api` (Express 5 + Prisma 6, REST under `/api/v1`), `apps/web` (React 19 + Vite SPA, admin lazy-loaded), `packages/shared` (zod schemas + pure business functions used by both). Server is the source of truth for money, stock and auth; sessions are opaque cookies stored hashed in Postgres.

**Tech Stack:** Node 22+, TypeScript 5.9.3, Express 5.3, Prisma 6.19.3, PostgreSQL 17, zod 4, argon2, sharp, multer 2, helmet, pino, express-rate-limit, libphonenumber-js; React 19, Vite 7.3, React Router 7.18, TanStack Query 5, Zustand 5, Tailwind 4.3, react-hook-form, react-leaflet 5; Vitest 4.1, Supertest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-cambo-supply-rebuild-design.md`

## Global Constraints

- Money is integer **cents USD** everywhere (DB, API, shared). Display with `formatUsd`.
- Phone numbers stored E.164 (`+855…`), normalized with libphonenumber-js, default region `KH`.
- Delivery: Province $2.00; Phnom Penh + Grab + pin: ≤3 km $1.50, ≤5 km $2.00, else $2.50; Phnom Penh otherwise $1.50. Grab only for Phnom Penh. Store at lat 11.5714, lng 104.8872. Rates live in `StoreSetting` and are admin-editable.
- COD only for Phnom Penh. KHQR rejected with code `PAYMENT_METHOD_UNAVAILABLE` until enabled.
- Error body shape: `{ error: { code, message, details? } }`.
- Session cookie `cs_session`: httpOnly, Secure in production, SameSite=Lax, 30-day sliding; token stored as SHA-256 hash.
- Telegram deep-link token: 32 random bytes (base64url), stored hashed, single use, 10-minute expiry; request bound to cookie `cs_tg_req`.
- No secret (bot token, DB URL, session secret) in `apps/web`. Only `VITE_API_URL` and `VITE_TELEGRAM_BOT_USERNAME` are exposed to the browser.
- Dark theme only; tokens from the current site: `--bg #14171c`, `--surface #181c24`, `--surface-card #141820`, `--surface-light #242b35`, `--border rgba(255,255,255,.08)`, `--text #f9fafb`, `--muted #8e98a8`, `--yellow #ffb703`, `--yellow-hover #e0a100`, `--green #10b981`; fonts Plus Jakarta Sans (body) and Space Grotesk (headings).
- Order numbers `CS-` + Postgres sequence starting at 250001.
- Images: WebP at widths 400, 800, 1200; uploads jpeg/png/webp only, ≤8 MB.
- Tests run against local Postgres via `DATABASE_URL_TEST` (database `cambo_supply_test`).

## Review Focus

1. Two customers ordering the last unit at the same time → exactly one order succeeds, the other gets 409 `OUT_OF_STOCK` (test in Task 7).
2. Double-tapped "Confirm order" (same `Idempotency-Key`) → one order, both responses return it (test in Task 7).
3. Telegram contact that isn't the sender's own (`contact.user_id !== from.id`), an expired token, or a reused token → rejected, account not created (tests in Task 4).
4. Phone typed as `012 345 678`, `+855 12 345 678`, `85512345678`, `12345678` → same `+85512345678`; garbage → rejected (test in Task 1, login test in Task 3).
5. Product price changed or product hidden after it was put in the cart → checkout uses the current DB price / rejects with `PRODUCT_UNAVAILABLE`; the client cart refreshes (tests in Task 7 and Task 12).

---

## File Structure

```
package.json, tsconfig.base.json, eslint.config.js, .prettierrc, .gitignore, .nvmrc
packages/shared/src/
  money.ts        formatUsd
  phone.ts        normalizePhone
  geo.ts          haversineKm
  delivery.ts     computeDeliveryFeeCents, DeliverySettings, DEFAULT_DELIVERY_SETTINGS
  promo.ts        computePromoDiscountCents
  schemas/        auth.ts, checkout.ts, catalog.ts, admin.ts, settings.ts
  index.ts
apps/api/
  prisma/schema.prisma, prisma/migrations/
  src/config.ts, app.ts, server.ts, logger.ts, errors.ts, prisma.ts
  src/middleware/   auth.ts, origin.ts, validate.ts, rateLimit.ts, error.ts
  src/auth/         password.ts, sessions.ts, routes.ts, telegramAuth.ts
  src/telegram/     client.ts, updates.ts, poller.ts, routes.ts, notify.ts
  src/storage/      types.ts, local.ts, s3.ts, images.ts
  src/catalog/      routes.ts, serializers.ts
  src/checkout/     quote.ts, orders.ts, payments.ts, routes.ts
  src/admin/        products.ts, categories.ts, banners.ts, promos.ts, orders.ts, customers.ts, settings.ts, stats.ts, uploads.ts, index.ts
  src/account/      routes.ts
  scripts/          seed.ts, promote-admin.ts
  test/             globalSetup.ts, helpers.ts, *.test.ts
apps/web/
  index.html, vite.config.ts, src/main.tsx, src/router.tsx, src/styles.css
  src/lib/          api.ts, queryClient.ts, strings.ts
  src/stores/       cart.ts, ui.ts
  src/components/   Header, BannerCarousel, CategoryChips, ProductCard, ProductGrid, Drawer, CartDrawer, Toast, PhoneInput, MapPicker, ImageGallery, Price
  src/pages/        Home, ProductDetail, Checkout, OrderSuccess, Login, Signup, ForgotPassword, account/*
  src/admin/        AdminLayout, Dashboard, Orders, OrderDetail, Products, ProductEdit, Banners, Categories, Promos, Customers, Settings
  e2e/smoke.spec.ts
docker/api.Dockerfile, docker/web.Dockerfile, docker/nginx.conf
docker-compose.yml, docker-compose.prod.yml, .github/workflows/ci.yml, README.md
```

---

### Task 1: Monorepo scaffold + shared package

**Files:**
- Create: root `package.json` (workspaces `apps/*`, `packages/*`; scripts `dev`, `build`, `test`, `lint`, `typecheck`, `db:seed`), `tsconfig.base.json` (strict, `moduleResolution: bundler`, ES2022), `eslint.config.js` (typescript-eslint 8), `.prettierrc`, `.gitignore`, `.nvmrc` (22)
- Create: `packages/shared/package.json` (name `@cambo/shared`, `"exports": "./src/index.ts"`), `packages/shared/src/*` per File Structure
- Test: `packages/shared/src/*.test.ts`

**Interfaces:**
- Produces:
  - `formatUsd(cents: number): string` — `2100 → "$21"`, `2150 → "$21.50"`, `0 → "$0"`.
  - `normalizePhone(input: string): string | null` — E.164 or null.
  - `haversineKm(a: LatLng, b: LatLng): number`; `type LatLng = { lat: number; lng: number }`.
  - `type Region = 'PHNOM_PENH' | 'PROVINCE'`; `type DeliveryService = 'GRAB' | 'VET' | 'JNT'`; `type PaymentMethod = 'COD' | 'KHQR'`.
  - `type DeliverySettings = { store: LatLng; provinceFeeCents: number; phnomPenhStandardFeeCents: number; grabTiers: { maxKm: number; feeCents: number }[]; grabBeyondFeeCents: number }`; `DEFAULT_DELIVERY_SETTINGS` = store 11.5714/104.8872, 200, 150, `[{maxKm:3,feeCents:150},{maxKm:5,feeCents:200}]`, 250.
  - `computeDeliveryFeeCents(s: DeliverySettings, input: { region: Region; service: DeliveryService; pin?: LatLng | null }): { feeCents: number; distanceKm: number | null }` — throws `Error('DELIVERY_NOT_AVAILABLE')` for PROVINCE+GRAB.
  - `computePromoDiscountCents(promo: { type: 'FIXED' | 'PERCENT'; value: number }, subtotalCents: number): number` — FIXED value is cents; PERCENT 1–100 rounded down; never exceeds subtotal.
  - zod schemas: `phoneSchema` (transforms via normalizePhone, error "Invalid phone number"), `passwordSchema` (8–128, not in `COMMON_PASSWORDS`), `loginSchema {phone,password}`, `signupCompleteSchema {requestId: uuid, name: 1–60, password}`, `resetCompleteSchema {requestId, password}`, `changePasswordSchema {currentPassword, newPassword}`, `telegramStartSchema {purpose: 'SIGNUP'|'RESET'|'CHANGE_PHONE', phone?}`, `cartItemSchema {productId: uuid, quantity: int 1–20}`, `quoteSchema {items: cartItem[1..50], region, deliveryService, pin?: LatLng|null, promoCode?: string}`, `createOrderSchema = quoteSchema & {contactName 1–60, contactPhone: phoneSchema, addressLine 1–500, note?: ≤500, paymentMethod}`, `productInputSchema`, `categoryInputSchema`, `bannerInputSchema`, `promoInputSchema`, `settingsInputSchema`, `orderStatusUpdateSchema {status, note?}`. Inferred types exported as `LoginInput`, `QuoteInput`, `CreateOrderInput`, etc.
  - `ORDER_STATUSES = ['PENDING','CONFIRMED','PACKED','SHIPPING','DELIVERED','CANCELLED']`; `canTransition(from, to): boolean` — forward one or more steps along PENDING→CONFIRMED→PACKED→SHIPPING→DELIVERED; CANCELLED only from PENDING/CONFIRMED/PACKED.

- [ ] **Step 1: `git init`, write root config files, `npm install` dev deps (typescript@5.9.3, vitest@4.1.12, eslint@9, typescript-eslint, prettier, zod@4, libphonenumber-js)**
- [ ] **Step 2: Write failing tests**
  - `phone.test.ts`: `['012 345 678','+855 12 345 678','85512345678','12345678','0123-456-78']` all → `'+85512345678'`; `'abc'`, `'123'`, `''` → `null`.
  - `delivery.test.ts`: PROVINCE+VET → `{200, null}`; PP+VET → 150; PP+GRAB no pin → 150; PP+GRAB pin 2 km away → 150, 4 km → 200, 8 km → 250 (pins built by offsetting latitude by km/111.32); PROVINCE+GRAB throws `DELIVERY_NOT_AVAILABLE`.
  - `promo.test.ts`: FIXED 100 on 2100 → 100; FIXED 5000 on 2100 → 2100; PERCENT 10 on 2155 → 215; PERCENT 100 on 999 → 999.
  - `money.test.ts`: values above.
  - `status.test.ts`: PENDING→CONFIRMED true; PENDING→DELIVERED true; DELIVERED→PENDING false; SHIPPING→CANCELLED false; PACKED→CANCELLED true.
  - `schemas.test.ts`: `passwordSchema` rejects `"password"` and 7 chars; `createOrderSchema` rejects quantity 0 and 21.
- [ ] **Step 3: Run `npm test -w packages/shared` → FAIL (modules missing)**
- [ ] **Step 4: Implement the modules listed in Interfaces**
- [ ] **Step 5: Run `npm test -w packages/shared` → PASS; `npm run typecheck` → no errors**
- [ ] **Step 6: Commit `chore: scaffold monorepo and shared business rules`**

### Task 2: API foundation (config, app, errors, Prisma schema, test harness)

**Files:**
- Create: `apps/api/package.json` (`@cambo/api`, scripts `dev` (tsx watch), `build` (tsc), `start`, `test`, `prisma:migrate`, `db:seed`, `admin:promote`), `tsconfig.json`, `vitest.config.ts` (globalSetup, `fileParallelism: false`)
- Create: `src/config.ts`, `src/logger.ts`, `src/errors.ts`, `src/prisma.ts`, `src/middleware/error.ts`, `src/middleware/validate.ts`, `src/middleware/origin.ts`, `src/app.ts`, `src/server.ts`, `prisma/schema.prisma`, `.env.example`
- Test: `test/globalSetup.ts`, `test/helpers.ts`, `test/health.test.ts`, `test/origin.test.ts`

**Interfaces:**
- Consumes: `@cambo/shared` types.
- Produces:
  - `loadConfig(env?: NodeJS.ProcessEnv): Config` — zod-validated; fields `nodeEnv, port (4000), databaseUrl, webOrigin (CSV → string[]), cookieDomain?, sessionTtlDays (30), trustProxy (bool), telegram: { botToken, botUsername, webhookSecret?, adminChatId?, mode: 'webhook'|'polling'|'off' }, storage: { driver: 'local'|'s3', localDir ('./uploads'), publicBaseUrl, s3?: {bucket, region, endpoint?, accessKeyId, secretAccessKey} }, rateLimit: { loginMax (10), windowMs (900000) }, serveWeb?: string`. Throws listing every invalid key.
  - `class AppError extends Error { constructor(status: number, code: string, message: string, details?: unknown) }`.
  - `validate({ body?, query?, params? }: zod schemas)` middleware → writes parsed values to `req.valid.body|query|params`; failure → 400 `VALIDATION_ERROR` with zod issues in `details`.
  - `originCheck(allowed: string[])` — for non-GET/HEAD/OPTIONS, rejects 403 `BAD_ORIGIN` unless `Origin` (or `Referer` origin) is in `allowed`; skips `/api/v1/telegram/webhook`.
  - `type AppDeps = { config: Config; prisma: PrismaClient; storage: StorageAdapter; telegram: TelegramClient; logger: Logger }`; `createApp(deps: AppDeps): express.Express` — helmet, cors(allowlist, credentials), `express.json({limit:'100kb'})`, cookie-parser, pino-http with request id, originCheck, routers mounted at `/api/v1/*`, `/healthz`, `/readyz` (SELECT 1 → 200 `{ok:true}` / 503), 404 → `NOT_FOUND`, error middleware (AppError → its status; Prisma P2002 → 409 `CONFLICT`; else 500 `INTERNAL`, message hidden in production).
  - `server.ts`: loads config, builds deps, listens, starts telegram poller if mode=polling, SIGTERM → close server, disconnect Prisma.
  - Prisma schema: every model in spec §7 with enums `Role, Region, DeliveryService, OrderStatus, PaymentMethod, PaymentStatus, PromoType, TelegramAuthPurpose, TelegramAuthStatus`; `Order.number` default `dbgenerated("'CS-' || nextval('order_number_seq')")` with the sequence created in the migration SQL `START 250001`; `Order` has `idempotencyKey String?` with `@@unique([userId, idempotencyKey])`; `StoreSetting` single row id `1` with `delivery Json`, `telegramNotify Boolean @default(true)`, `storeName`.
  - `test/helpers.ts`: `createTestApp(overrides?: Partial<AppDeps>): Promise<{ app, prisma, telegram: FakeTelegramClient, storage: MemoryStorage }>`; `resetDb(prisma)` truncates all tables `RESTART IDENTITY CASCADE` and recreates StoreSetting row; `WEB_ORIGIN = 'http://localhost:5173'`. (`FakeTelegramClient`/`MemoryStorage` are defined in Tasks 4/5; in this task stub them as minimal objects in helpers and replace when those tasks land.)
  - `test/globalSetup.ts`: creates DB `cambo_supply_test` if missing, runs `prisma migrate deploy` with `DATABASE_URL=$DATABASE_URL_TEST`.

- [ ] **Step 1: Install deps (express@5.3.0, prisma@6.19.3, @prisma/client@6.19.3, helmet, cors, cookie-parser, pino, pino-http, zod, supertest, tsx, @types/*)**
- [ ] **Step 2: Write `schema.prisma`; run `npx prisma migrate dev --name init --create-only`, append the `order_number_seq` SQL to the migration, then `npx prisma migrate dev` → migration applies on `cambo_supply`**
- [ ] **Step 3: Write failing tests**
  - `health.test.ts`: `GET /healthz` → 200 `{ok:true}`; `GET /readyz` → 200; `GET /api/v1/nope` → 404 body `{error:{code:'NOT_FOUND'}}`.
  - `origin.test.ts`: `POST /api/v1/auth/logout` with `Origin: https://evil.test` → 403 `BAD_ORIGIN`; with `Origin: WEB_ORIGIN` → not 403.
  - `config.test.ts`: `loadConfig({})` throws mentioning `DATABASE_URL`; valid env parses `WEB_ORIGIN="a,b"` to `['a','b']`.
- [ ] **Step 4: Run `npm test -w apps/api` → FAIL**
- [ ] **Step 5: Implement files listed above**
- [ ] **Step 6: Run `npm test -w apps/api` → PASS**
- [ ] **Step 7: Commit `feat(api): app foundation, prisma schema, test harness`**

### Task 3: Sessions, password auth, guards, rate limits

**Files:**
- Create: `src/auth/password.ts`, `src/auth/sessions.ts`, `src/middleware/auth.ts`, `src/middleware/rateLimit.ts`, `src/auth/routes.ts` (login/logout/logout-all/me/change-password)
- Test: `test/auth.test.ts`; add `createUser(prisma, {phone?, password?, role?, name?})` and `loginAs(app, phone, password): Promise<supertest.Agent>` to `test/helpers.ts`

**Interfaces:**
- Consumes: `loginSchema`, `changePasswordSchema`, `AppError`, `validate`.
- Produces:
  - `hashPassword(pw: string): Promise<string>` (argon2id), `verifyPassword(hash: string, pw: string): Promise<boolean>`.
  - `createSession(prisma, userId: string, meta: { ip?: string; userAgent?: string }, ttlDays: number): Promise<{ token: string; expiresAt: Date }>`; `getSessionUser(prisma, token: string): Promise<{ user: User; sessionId: string } | null>` (slides expiry when >1 day since last extension; ignores revoked/expired/disabled users); `revokeSession(prisma, sessionId)`; `revokeAllSessions(prisma, userId, exceptSessionId?)`.
  - `setSessionCookie(res, config, token, expiresAt)`, `clearSessionCookie(res, config)`.
  - `loadUser` middleware sets `req.user?` and `req.sessionId?`; `requireAuth` → 401 `UNAUTHENTICATED`; `requireRole('ADMIN')` → 403 `FORBIDDEN`.
  - `loginLimiter(config)` keyed by `ip + normalized phone`; `limiter(name, max, windowMs)` generic.
  - Routes: `POST /auth/login` → 200 `{ user: PublicUser }` + cookie, or 401 `INVALID_CREDENTIALS` (same response for unknown phone and wrong password; a dummy argon2 verify runs for unknown phones); `POST /auth/logout` → 204; `POST /auth/logout-all` → 204; `GET /auth/me` → `{ user }` or 401; `POST /auth/change-password` → 204, revokes other sessions, 400 `INVALID_CREDENTIALS` if current is wrong.
  - `type PublicUser = { id, name, phone, role, telegramUsername }` (`toPublicUser(user)` in `src/auth/sessions.ts`).

- [ ] **Step 1: Write failing tests in `auth.test.ts`**
  - login with `phone: '012 345 678'` for a user stored as `+85512345678` → 200, `set-cookie` contains `cs_session` and `HttpOnly`, `SameSite=Lax`.
  - wrong password and unknown phone both → 401 `INVALID_CREDENTIALS`.
  - `GET /auth/me` with cookie → user without `passwordHash`; without → 401.
  - logout → subsequent `/auth/me` 401.
  - change-password revokes a second agent's session but keeps the current one.
  - disabled user (`disabledAt` set) → login 401 and existing session → 401.
  - 11th failed login within window (config `loginMax: 10`) → 429 `RATE_LIMITED`.
  - customer agent `GET /api/v1/admin/stats` → 403 (mount a placeholder admin router with `requireAuth, requireRole('ADMIN')` now; real routes in Task 8).
- [ ] **Step 2: Run `npx vitest run test/auth.test.ts` → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit `feat(api): sessions, phone+password login, guards, rate limits`**

### Task 4: Telegram bot + phone-share sign-up, reset, change phone

**Files:**
- Create: `src/telegram/client.ts`, `src/telegram/updates.ts`, `src/telegram/poller.ts`, `src/telegram/routes.ts`, `src/auth/telegramAuth.ts`; modify `src/auth/routes.ts`
- Test: `test/telegramAuth.test.ts`; add `FakeTelegramClient` to `test/helpers.ts`

**Interfaces:**
- Consumes: sessions/password from Task 3, `telegramStartSchema`, `signupCompleteSchema`, `resetCompleteSchema`, `normalizePhone`.
- Produces:
  - `interface TelegramClient { sendMessage(chatId: number | string, text: string, opts?: { replyMarkup?: unknown; parseMode?: 'HTML' }): Promise<void>; getUpdates(offset: number, timeoutSec: number): Promise<TgUpdate[]>; setWebhook(url: string, secret: string): Promise<void> }`; `HttpTelegramClient(botToken)` using `fetch` to `https://api.telegram.org/bot<token>/<method>`; `FakeTelegramClient` records `sent: {chatId, text, opts}[]`.
  - `startTelegramAuth(deps, { purpose, phone?, userId? }): Promise<{ requestId: string; deepLink: string; expiresAt: Date }>` — deep link `https://t.me/${botUsername}?start=${token}`.
  - `handleTelegramUpdate(deps, update: TgUpdate): Promise<void>`:
    - `/start <token>`: find PENDING, unexpired request by token hash; store `telegramChatId/telegramUserId/telegramUsername/firstName`; reply text `"Tap the button below to share your phone number with Cambo Supply."` with `reply_markup: { keyboard: [[{ text: '📱 Share my phone number', request_contact: true }]], one_time_keyboard: true, resize_keyboard: true }`. Unknown/expired token → reply `"This link has expired. Please start again on the website."`.
    - `contact` message: find the latest PENDING request for `from.id` that already received `/start`; reject unless `contact.user_id === from.id` (reply `"Please share your own phone number using the button."`); normalize phone; for SIGNUP: if phone already belongs to a user → reply `"This number already has an account. Log in on the website or use Forgot password."` and set request EXPIRED; for RESET: require user with that phone **and** same `telegramUserId`, else reply generic `"We couldn't verify this account."`; for CHANGE_PHONE: new phone must be unused. On success set VERIFIED + `phone`, reply `"✅ Verified! Go back to the website to continue."` with `reply_markup: { remove_keyboard: true }`.
  - Routes (all under `/api/v1/auth`): `POST /telegram/start` (rate limit 10 per IP per 15 min) → `{ requestId, deepLink, expiresAt }` + cookie `cs_tg_req=<requestId>` (httpOnly, 15 min); RESET requires `phone` and responds identically whether or not it exists; CHANGE_PHONE requires auth. `GET /telegram/:id/status` → `{ status, phone? (masked "+855 •• ••• 678"), firstName? }`, 404 unless `:id` equals `cs_tg_req` cookie. `POST /signup/complete` → creates user (phone, name, passwordHash, telegram ids), request COMPLETED, session cookie, 201 `{ user }`; request not VERIFIED/expired/COMPLETED → 409 `TELEGRAM_NOT_VERIFIED`. `POST /reset/complete` → updates password, revokes all sessions, logs in. `POST /me/phone/complete` (auth) → updates phone.
  - `POST /api/v1/telegram/webhook` — 401 unless header `X-Telegram-Bot-Api-Secret-Token` equals `config.telegram.webhookSecret`; always 200 after handling (errors logged, not surfaced).
  - `startPolling(deps): () => void` — long-poll loop with 25 s timeout and offset tracking; returns stop function.

- [ ] **Step 1: Write failing tests in `telegramAuth.test.ts`** (simulate updates by calling the webhook with the secret)
  - full signup: start → `/start token` from user 777 → bot sent message containing `request_contact` → contact `{user_id: 777, phone_number: '85512345678'}` → status `VERIFIED` → `signup/complete` 201 → `/auth/me` phone `+85512345678`, `telegramUserId` 777.
  - contact with `user_id: 999` from 777 → status stays `PENDING`, bot replied "Please share your own phone number".
  - request older than 10 min (set `expiresAt` in past) → `/start` replies expired; `signup/complete` → 409.
  - `signup/complete` twice with same requestId → second 409.
  - status with a different `cs_tg_req` cookie → 404.
  - signup when phone already registered → bot "already has an account", complete → 409.
  - reset: existing user (telegramUserId 777) → start RESET with phone → contact from 777 → `reset/complete` sets new password; old password login 401, new 200; other sessions revoked.
  - reset contact from different Telegram user 888 with same phone → not VERIFIED.
  - webhook without secret header → 401.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit `feat(api): telegram phone verification signup, reset, change phone`**

### Task 5: Storage, image pipeline, public catalog

**Files:**
- Create: `src/storage/types.ts`, `local.ts`, `s3.ts`, `images.ts`, `src/catalog/serializers.ts`, `src/catalog/routes.ts`
- Test: `test/images.test.ts`, `test/catalog.test.ts`; add `MemoryStorage` to helpers

**Interfaces:**
- Produces:
  - `interface StorageAdapter { put(key: string, body: Buffer, contentType: string): Promise<void>; delete(key: string): Promise<void>; url(key: string): string }`; `LocalStorage(dir, publicBaseUrl)` (API serves `dir` at `/uploads` with `Cache-Control: public, max-age=31536000, immutable`); `S3Storage({bucket, region, endpoint?, credentials, publicBaseUrl})` via `@aws-sdk/client-s3`.
  - `IMAGE_WIDTHS = [400, 800, 1200]`; `storeImage(storage, input: Buffer, prefix: 'products' | 'banners'): Promise<{ storageKey: string; width: number; height: number }>` — validates via sharp metadata (format jpeg/png/webp else `AppError(400,'UNSUPPORTED_IMAGE')`), rotates, strips metadata, writes `${prefix}/${uuid}-${w}.webp` for each width (no upscaling); `storageKey` = `${prefix}/${uuid}`. `deleteImage(storage, storageKey)`.
  - `imageUrls(storage, key): { sm: string; md: string; lg: string }`.
  - Serializers: `toProductCard(p)` → `{ id, slug, name, specsLine, priceCents, compareAtCents, isSoldOut (isSoldOut || stock<=0), category: {slug,name}, image: ImageUrls|null, imageCount }`; `toProductDetail(p)` → card + `{ description, stock, specs: {label,value}[], images: (ImageUrls & {width,height})[] }`.
  - Routes: `GET /categories` → sorted by `sortOrder`; `GET /banners` → active, sorted, `{ id, linkUrl, image }`; `GET /products?category=&q=&page=&pageSize=(default 60, max 100)` → active only, sorted `sortOrder, createdAt`, `q` matches name/specsLine/description/category name case-insensitive → `{ items, total, page, pageSize }`; `GET /products/:slug` → detail or 404; `GET /products/by-ids?ids=a,b` → cards for cart refresh (inactive ones omitted).

- [ ] **Step 1: Write failing tests**
  - `images.test.ts`: a 1600×1200 PNG produces 3 webp keys and returns width 1600; a 300px image produces only widths ≤ its own; a text buffer → `UNSUPPORTED_IMAGE`.
  - `catalog.test.ts`: hidden product not in list and `/products/:slug` 404; `q=attack` matches "Attack Shark X11"; `category=mouse` filters; `isSoldOut` true when stock 0; detail returns specs in `sortOrder`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS**
- [ ] **Step 5: Commit `feat(api): image storage pipeline and public catalog`**

### Task 6: Admin catalog management

**Files:**
- Create: `src/admin/index.ts` (router with `requireAuth, requireRole('ADMIN')`), `products.ts`, `categories.ts`, `banners.ts`, `uploads.ts`
- Test: `test/adminCatalog.test.ts`

**Interfaces:**
- Consumes: `productInputSchema` (`name, slug?, categoryId, specsLine, description, priceCents ≥0, compareAtCents?, stock ≥0, isSoldOut, isActive, specs: {label,value}[] ≤40`), storage functions.
- Produces (under `/api/v1/admin`):
  - Products: `GET /products?q=&status=active|hidden|all`, `GET /products/:id`, `POST /products` (slug auto from name via `slugify`, unique — append `-2`, `-3`…), `PATCH /products/:id` (replaces specs when provided), `DELETE /products/:id` → sets `isActive=false` (archive; never hard delete since orders reference it), `POST /products/reorder {ids: uuid[]}` sets `sortOrder` by index.
  - Images: `POST /products/:id/images` multipart `files[]` (multer memory, ≤8 MB, ≤10 files) → appended images; `PATCH /products/:id/images/order {ids}`; `DELETE /products/:id/images/:imageId` (deletes storage files).
  - Categories: CRUD + reorder; delete → 409 `CATEGORY_IN_USE` if products exist.
  - Banners: `POST /banners` multipart `file` + `linkUrl?`, `PATCH /banners/:id {linkUrl, isActive}`, `DELETE`, `POST /banners/reorder`.
  - `slugify(text: string): string` in `src/admin/products.ts`.

- [ ] **Step 1: Write failing tests**: create product → 201 with slug `attack-shark-x11-white`; creating the same name again → slug `attack-shark-x11-white-2`; customer → 403; upload 2 images → detail has 2 in order; reorder images reverses order; delete image removes from MemoryStorage; archive hides from public list; delete category in use → 409; upload a `.txt` → 400 `UNSUPPORTED_IMAGE`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS**
- [ ] **Step 5: Commit `feat(api): admin product, category, banner management`**

### Task 7: Quote, orders, stock, idempotency, payments slot

**Files:**
- Create: `src/checkout/quote.ts`, `src/checkout/payments.ts`, `src/checkout/orders.ts`, `src/checkout/routes.ts`, `src/account/routes.ts`
- Test: `test/checkout.test.ts`

**Interfaces:**
- Consumes: `computeDeliveryFeeCents`, `computePromoDiscountCents`, `quoteSchema`, `createOrderSchema`, `canTransition`.
- Produces:
  - `getDeliverySettings(prisma): Promise<DeliverySettings>` (StoreSetting.delivery merged over defaults).
  - `buildQuote(db: Prisma.TransactionClient | PrismaClient, input: QuoteInput, userId: string, opts?: { lock?: boolean }): Promise<Quote>`; `type Quote = { items: { productId, name, priceCents, quantity, lineTotalCents, image }[]; subtotalCents; deliveryFeeCents; distanceKm: number | null; discountCents; totalCents; promo: { id, code } | null }`. With `lock`, selects products `FOR UPDATE` (raw query on ids, ordered by id to avoid deadlocks). Errors: product missing/inactive → 409 `PRODUCT_UNAVAILABLE` `details: {productIds}`; quantity > stock or sold out → 409 `OUT_OF_STOCK` `details: {items:[{productId, available}]}`; promo unknown/inactive/outside dates/over `maxUses`/over `maxUsesPerUser` (counting the user's non-cancelled orders)/below `minSubtotalCents` → 422 `PROMO_INVALID` `details: {reason}`; GRAB+PROVINCE → 422 `DELIVERY_NOT_AVAILABLE`. Duplicate productIds in input are merged.
  - `interface PaymentProvider { method: PaymentMethod; isAvailable(input: { region: Region }): boolean; createPayment(tx, order): Promise<void> }`; `CodProvider` (available only for PHNOM_PENH, creates `Payment{method:COD,status:UNPAID}`); `KhqrProvider` stub `isAvailable → false`. `getPaymentProvider(method)`.
  - `createOrder(deps, userId, input: CreateOrderInput, idempotencyKey?: string): Promise<Order>` — if `(userId, idempotencyKey)` exists return it; else one `$transaction`: payment availability (422 `PAYMENT_METHOD_UNAVAILABLE`), `buildQuote(tx, …, {lock:true})`, decrement stock, increment promo `usedCount`, create Order + OrderItems (name/price/image key snapshots) + `OrderStatusEvent(null→PENDING)` + payment; after commit fire `notifyNewOrder(deps, order)` (Task 8; in this task a no-op import stub).
  - `cancelOrder(tx, orderId, actorUserId, note?)` — restocks items, decrements promo `usedCount`.
  - Routes: `POST /checkout/quote` (auth) → `Quote`; `POST /orders` (auth, header `Idempotency-Key` optional ≤100 chars) → 201 order; `GET /orders` (mine, newest first, paginated); `GET /orders/:number` (mine only, else 404) → order with items, events, payment; `GET /me` / `PATCH /me {name, defaultAddress?}`.
  - `toOrderDto(order)` in `orders.ts`.

- [ ] **Step 1: Write failing tests in `checkout.test.ts`**
  - quote: 2× $21 + PP/GRAB pin 4 km → subtotal 4200, fee 200, total 4400; PROVINCE/VET → fee 200; promo FIXED 100 → discount 100; expired promo → 422 `PROMO_INVALID`; below min subtotal → 422.
  - quote recomputes from DB: client cannot pass prices (extra fields stripped); after admin changes price to 2500, quote uses 2500.
  - hidden product in cart → 409 `PRODUCT_UNAVAILABLE` with its id.
  - create order COD PP → 201, number matches `/^CS-\d{6}$/`, stock decremented, payment UNPAID, status PENDING.
  - COD with PROVINCE → 422 `PAYMENT_METHOD_UNAVAILABLE`; KHQR → 422 `PAYMENT_METHOD_UNAVAILABLE`.
  - **concurrency:** product stock 1, two users `Promise.all` create order → one 201, one 409 `OUT_OF_STOCK`; final stock 0.
  - **idempotency:** same key twice → same order id, stock decremented once.
  - promo `maxUsesPerUser: 1` → second order with it → 422.
  - `GET /orders/:number` of another user → 404.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS**
- [ ] **Step 5: Commit `feat(api): server-side quote, orders with stock locking and idempotency`**

### Task 8: Admin orders, promos, customers, settings, stats; Telegram order alerts

**Files:**
- Create: `src/admin/orders.ts`, `promos.ts`, `customers.ts`, `settings.ts`, `stats.ts`, `src/telegram/notify.ts`
- Test: `test/adminOps.test.ts`

**Interfaces:**
- Produces (under `/api/v1/admin`):
  - `GET /orders?status=&q=(number or phone)&from=&to=&page=` ; `GET /orders/:id`; `POST /orders/:id/status {status, note?}` → 409 `INVALID_TRANSITION` unless `canTransition`; CANCELLED uses `cancelOrder`; records `OrderStatusEvent` with actor; `POST /orders/:id/payment {status: PaymentStatus}` (sets `paidAt` when PAID).
  - Promos CRUD (`code` uppercased, unique → 409 `CONFLICT`).
  - `GET /customers?q=&page=` (with order count, total spent of DELIVERED orders); `GET /customers/:id`; `POST /customers/:id/disable` / `enable` (disable revokes sessions; admins can't disable themselves → 400).
  - `GET /settings`, `PUT /settings` (`settingsInputSchema`: storeName, delivery settings, telegramNotify).
  - `GET /stats` → `{ today: {orders, revenueCents}, week: {orders, revenueCents}, pendingCount, lowStock: {id,name,stock}[] (stock ≤ 3, active) }` — revenue counts non-cancelled orders; "today"/"week" in `Asia/Phnom_Penh`.
  - `notifyNewOrder(deps, orderId): Promise<void>` — if `config.telegram.adminChatId` and `StoreSetting.telegramNotify`, sends HTML message: order number, customer name, phone, region/service, address, map link `https://maps.google.com/?q=lat,lng` when pinned, items `qty × name — $x`, subtotal/fee/discount/total, payment method, and admin link `${webOrigin[0]}/admin/orders/${id}`; HTML-escapes user text; 3 attempts with 1 s/3 s backoff; never throws.
- [ ] **Step 1: Write failing tests**: status PENDING→CONFIRMED ok and event recorded; DELIVERED→PENDING 409; cancel restocks; promo duplicate code 409; disable customer → their session 401; stats counts today's order and lists product with stock 2; new order sends one Telegram message to admin chat containing the order number and `&lt;b&gt;` when the note contains `<b>`; notify failure (fake throws) still returns 201.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS**
- [ ] **Step 5: Commit `feat(api): admin order ops, promos, customers, settings, stats, telegram alerts`**

### Task 9: Seed from scrape + admin promote CLI

**Files:**
- Create: `apps/api/scripts/seed.ts`, `apps/api/scripts/promote-admin.ts`; copy `scrape/` → `apps/api/seed-data/` (products.json, products/, banners/)
- Test: `test/seed.test.ts`

**Interfaces:**
- Produces:
  - `seed(deps, dataDir: string): Promise<{ products: number; images: number; banners: number }>` — idempotent (skips if any product exists unless `--force`, which truncates catalog tables only). Category map: `keyboard→Keyboards (keyboards)`, `mouse→Mice (mice)`, `deskmat→Mousepads (mousepads)`, `accessories→Accessories (accessories)`, sort in that order. Price parsed from `"$21"` → 2100. Specs from `specs: [label, value][]`. Images matched by filename prefix `NN-` and processed through `storeImage`. Stock 10 each. Slugs via `slugify` with numeric suffix on duplicates. Upserts StoreSetting with `DEFAULT_DELIVERY_SETTINGS`, storeName "Cambo Supply". Creates promo `CAMBOKBSHOP` FIXED 100, active.
  - `promote-admin.ts <phone>`: normalizes phone, sets role ADMIN, prints result; exits 1 if no user.
- [ ] **Step 1: Write failing test**: seeding `seed-data` into test DB → 44 products, 4 categories, 3 banners, product 5 (Aula F75) has 4 images and 10 specs; running again without force → no duplicates.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS; run `npm run db:seed -w apps/api` against dev DB → prints counts**
- [ ] **Step 5: Commit `feat(api): seed catalog from scraped data, admin promote script`**

### Task 10: Web foundation

**Files:**
- Create: `apps/web/package.json` (`@cambo/web`), `index.html`, `vite.config.ts` (react, tailwind, dev proxy `/api` & `/uploads` → `http://localhost:4000`), `tsconfig.json`, `vitest.config.ts` (jsdom), `src/main.tsx`, `src/styles.css`, `src/router.tsx`, `src/lib/api.ts`, `src/lib/queryClient.ts`, `src/lib/strings.ts`, `src/lib/auth.ts`, `src/components/Header.tsx`, `src/components/Drawer.tsx`, `src/components/Toast.tsx`, `src/layouts/StoreLayout.tsx`, `public/logo.jpg` (from current site)
- Test: `src/lib/api.test.ts`

**Interfaces:**
- Produces:
  - `api<T>(path: string, init?: { method?, body?, headers? }): Promise<T>` — base `import.meta.env.VITE_API_URL ?? ''` + `/api/v1`, `credentials: 'include'`, JSON; non-2xx throws `ApiError { status, code, message, details }`.
  - `useMe()` (TanStack Query key `['me']`, returns `PublicUser | null`, 401 → null), `useLogin()`, `useLogout()`; `<RequireAuth>` (redirects to `/login?next=`), `<RequireAdmin>`.
  - Tailwind 4 `@theme` tokens from Global Constraints (`--color-bg`, `--color-surface`, …, `--font-sans`, `--font-display`); `body` background `var(--color-bg)`; `color-scheme: dark`.
  - Routes: `/` Home, `/products/:slug`, `/checkout`, `/orders/:number/success`, `/login`, `/signup`, `/forgot-password`, `/account`, `/account/orders`, `/account/orders/:number`, `/admin/*` (lazy).
  - `Drawer` — bottom sheet <768px, right side panel ≥768px; focus trap, Esc closes, `aria-modal`.
  - `strings.ts` — every user-facing string exported from one object `t`.
- [ ] **Step 1: Install deps (react@19, react-dom@19, vite@7.3.8, @vitejs/plugin-react@5.2.0, react-router@7.18.5, @tanstack/react-query@5, zustand@5, tailwindcss@4.3.5, @tailwindcss/vite, react-hook-form, @hookform/resolvers, vitest, @testing-library/react, jsdom)**
- [ ] **Step 2: Write failing test `api.test.ts`**: 400 response `{error:{code:'VALIDATION_ERROR'}}` → throws `ApiError` with `code 'VALIDATION_ERROR'`; requests include `credentials: 'include'`.
- [ ] **Step 3: Run → FAIL. Step 4: Implement. Step 5: Run → PASS; `npm run build -w apps/web` succeeds**
- [ ] **Step 6: Commit `feat(web): app shell, theme, api client, routing`**

### Task 11: Storefront (home, product detail, cart)

**Files:**
- Create: `src/stores/cart.ts`, `src/components/{BannerCarousel,CategoryChips,ProductCard,ProductGrid,CartDrawer,ImageGallery,Price}.tsx`, `src/pages/Home.tsx`, `src/pages/ProductDetail.tsx`
- Test: `src/stores/cart.test.ts`, `src/components/ProductCard.test.tsx`

**Interfaces:**
- Produces:
  - `useCart` (Zustand + `persist` to localStorage key `cs_cart_v1`, guarded with try/catch storage): state `items: { productId, quantity }[]`; actions `add(productId, qty=1)` (caps at 20), `setQty(productId, qty)` (0 removes), `remove`, `clear`, `count()`.
  - `useCartProducts()` → fetches `/products/by-ids`, returns lines joined with current price/sold-out; drops lines whose product is gone and shows toast `t.cart.itemRemoved`.
  - Home: header (logo, "CAMBO SUPPLY", tagline, cart pill), search (debounced 250 ms, synced to `?q=`), banner carousel (auto-advance 5 s, dots, swipe, pauses on hover), category chips (synced to `?category=`), product count, grid (2 cols <640, 3 ≥640, 4 ≥1024, 5 ≥1280), card per current site (category tag, photo-count badge, sold-out badge, name, specsLine, price, "+ Add").
  - Product detail: page route; gallery with thumbnails + counter `1/4`, spec table, qty stepper, add to cart, disabled when sold out; meta title `${name} — Cambo Supply`.
  - Add → toast "Added {name}" for 2 s.
- [ ] **Step 1: Write failing tests**: cart `add` twice → quantity 2; `add` 25 → 20; `setQty(id, 0)` removes; state survives re-create from localStorage; `ProductCard` with `isSoldOut` shows "Sold Out" and disabled Add button; with `imageCount 4` shows "📷 4".
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS**
- [ ] **Step 5: Commit `feat(web): storefront home, product detail, cart`**

### Task 12: Auth and account pages

**Files:**
- Create: `src/components/PhoneInput.tsx`, `src/pages/{Login,Signup,ForgotPassword}.tsx`, `src/pages/account/{Profile,Orders,OrderDetail}.tsx`, `src/hooks/useTelegramVerification.ts`
- Test: `src/hooks/useTelegramVerification.test.ts`, `src/pages/Login.test.tsx`

**Interfaces:**
- Consumes: auth endpoints from Tasks 3–4, `/orders`, `/me`.
- Produces:
  - `useTelegramVerification(purpose, phone?)` → `{ start(): Promise<void>; deepLink?: string; status: 'idle'|'waiting'|'verified'|'expired'|'error'; requestId?: string; firstName?: string; maskedPhone?: string }` — `start` calls `/auth/telegram/start`, opens `deepLink` via `window.open` (or `Telegram.WebApp.openTelegramLink` when inside Telegram), polls status every 2000 ms, stops on VERIFIED/EXPIRED or after 10 min, cleans up on unmount.
  - Signup page: step 1 button "Sign up with Telegram" + fallback "Open Telegram" link + "Waiting for Telegram…"; step 2 form name (prefilled firstName) + password + confirm → `/auth/signup/complete` → redirect `next` or `/`. Expired → "Link expired, try again".
  - Login: PhoneInput (accepts local format, shows `+855` prefix) + password; error `INVALID_CREDENTIALS` → "Wrong phone number or password"; 429 → "Too many attempts, try again in 15 minutes".
  - Forgot password: phone → Telegram flow (RESET) → new password form → logged in.
  - Account: profile (name edit, masked phone, "Change phone" via CHANGE_PHONE flow, change password, log out all devices); order list; order detail with status timeline and items.
  - After login, cart is kept (it's local).
- [ ] **Step 1: Write failing tests**: hook polls (fake timers, mocked `api`) and transitions waiting → verified; stops polling after verified; unmount stops polling. Login shows "Wrong phone number or password" on `INVALID_CREDENTIALS`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS**
- [ ] **Step 5: Commit `feat(web): telegram signup, login, reset, account pages`**

### Task 13: Checkout

**Files:**
- Create: `src/pages/Checkout.tsx`, `src/pages/OrderSuccess.tsx`, `src/components/MapPicker.tsx`, `src/hooks/useQuote.ts`
- Test: `src/pages/Checkout.test.tsx`

**Interfaces:**
- Consumes: `/checkout/quote`, `/orders`, `createOrderSchema`, `formatUsd`.
- Produces:
  - Checkout (RequireAuth; empty cart → redirect `/`): contact name (prefilled), phone (prefilled from account), region select, delivery service (Grab hidden for Province; switching to Province while Grab selected → VET), "📍 Use my location" (geolocation) + MapPicker (react-leaflet, OSM tiles, draggable marker, lazy-loaded) shown for Phnom Penh, address/note textarea, promo input with Apply/Remove, payment radio COD (disabled with hint for Province) and KHQR "Coming soon" (disabled), summary (items, subtotal, delivery, discount, total) from server quote (refetched on change, debounced 300 ms), Confirm button.
  - Confirm sends `Idempotency-Key` = `crypto.randomUUID()` generated once per checkout visit; on `OUT_OF_STOCK`/`PRODUCT_UNAVAILABLE` shows which items and refreshes cart; on success clears cart → `/orders/:number/success` showing number, total, "We'll contact you on Telegram/phone".
  - `useQuote(input)` → TanStack Query `['quote', input]`.
- [ ] **Step 1: Write failing tests** (mocked api): selecting Province hides Grab and disables COD; promo `PROMO_INVALID` shows "This promo code isn't valid"; confirming twice quickly sends one request (button disabled while pending) with the same Idempotency-Key.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS**
- [ ] **Step 5: Commit `feat(web): checkout with server quote, map pin, COD`**

### Task 14: Admin dashboard UI

**Files:**
- Create: `src/admin/{AdminLayout,Dashboard,Orders,OrderDetail,Products,ProductEdit,Banners,Categories,Promos,Customers,Settings}.tsx`, `src/admin/components/{DataTable,ImageUploader,SpecEditor,SortableList,StatusBadge}.tsx`
- Test: `src/admin/components/SpecEditor.test.tsx`, `src/admin/OrderDetail.test.tsx`

**Interfaces:**
- Consumes: admin endpoints from Tasks 6 and 8.
- Produces:
  - Layout: sidebar on ≥1024px, top bar + menu drawer on mobile; `<RequireAdmin>`.
  - Dashboard: stat tiles (today/week orders and revenue, pending count), low-stock list, latest orders.
  - Orders: table with status filter, search, date range; detail with items, customer, map link, status buttons for allowed next statuses only (via `canTransition`), payment status select, timeline, print packing slip (`window.print` with print CSS).
  - Products: list with search/status filter, drag reorder (`@dnd-kit/sortable`), edit page (all fields, SpecEditor add/remove/reorder rows, ImageUploader multi-upload with previews, reorder, delete), archive.
  - Banners, Categories, Promos (create/edit form, active toggle), Customers (list, detail, disable/enable), Settings (store name, store coordinates via MapPicker, delivery fees/tiers in dollars converted to cents, Telegram alerts toggle).
- [ ] **Step 1: Write failing tests**: SpecEditor add row → onChange with new `{label:'',value:''}`; move up reorders; OrderDetail for PENDING shows "Confirm" and "Cancel" buttons and no "Delivered"; for DELIVERED shows no status buttons.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS; `npm run build -w apps/web` → admin chunk separate from main (check `dist/assets` has an `Admin*` chunk)**
- [ ] **Step 5: Commit `feat(web): admin dashboard`**

### Task 15: Production packaging, CI, docs, smoke test

**Files:**
- Create: `docker/api.Dockerfile` (multi-stage, node:22-alpine, non-root, `prisma migrate deploy && node dist/server.js`), `docker/web.Dockerfile` (build → nginx:alpine serving SPA with fallback, long-cache `/assets`), `docker/nginx.conf`, `docker-compose.yml` (db postgres:17 + api + web for local), `docker-compose.prod.yml` (example with env files, volumes for uploads/db), `.github/workflows/ci.yml` (Node 22, postgres:17 service, `npm ci`, lint, typecheck, test, build, docker build), `README.md`, `apps/api/.env.example`, `apps/web/.env.example`, `apps/web/e2e/smoke.spec.ts`, `apps/web/playwright.config.ts`
- Modify: `apps/api/src/app.ts` — when `config.serveWeb` set, serve built web with SPA fallback (single-box option)

**Interfaces:**
- Consumes: everything.
- Produces: `npm run e2e` runs Playwright against `npm run dev` with test DB seeded; README sections: overview, requirements, local setup (Postgres, env, migrate, seed, create bot with @BotFather, polling mode, promote admin), scripts, env reference, deploy (webhook mode `setWebhook`, R2/S3 storage, domains & cookies), KHQR integration notes (where `KhqrProvider` plugs in), security checklist (rotate old exposed Telegram token and Firebase key).
- [ ] **Step 1: Write `smoke.spec.ts`**: open `/` → sees "Attack Shark X11 White" → add to cart → cart count 1 → go to checkout redirects to `/login`; log in as seeded e2e user (created in Playwright global setup via API test helper `createUser`) → checkout PP/VET/COD → success page shows `CS-`.
- [ ] **Step 2: Run `npm run e2e -w apps/web` → PASS**
- [ ] **Step 3: Run full `npm run lint && npm run typecheck && npm test && npm run build` → all pass**
- [ ] **Step 4: Commit `chore: docker, CI, README, e2e smoke test`**
