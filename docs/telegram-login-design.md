# Telegram-only login

_Status: proposed, 2026-11-21. Author: Architect Jim. Design only; no code changed._

**Goal.** Customers log in only with their Telegram account. No password, no forgot-password. One button on the
website: **Continue with Telegram**. It logs in an existing customer and signs up a new one.

## (a) How the website learns who you are

Two ways in, picked by where the page is open. Both end in the same server-side session.

| Where | Method | Proof the api checks |
|---|---|---|
| Normal browser (phone or desktop) | **Bot deep link** `t.me/<bot>?start=<token>`, then a **Log me in** button in the bot | Telegram delivered the `/start` and the button tap from user `from.id` (webhook secret header checked by `notification`, service secret checked by `api`). The token is single use and tied to the browser that asked for it |
| Inside Telegram (store opened as a Mini App) | **Mini App `initData`**, sent once when the app loads | HMAC-SHA256 signature checked on the server, `auth_date` no older than 5 minutes (and not more than 30 s in the future), each `hash` accepted once |

Why not the **Telegram Login Widget**: it loads an iframe from telegram.org (we already moved telegram.org off the
critical path because it is slow or blocked for some visitors), it needs one fixed domain set in BotFather (no
localhost, no staging), and it behaves badly inside Telegram's own in-app browser. The deep link already exists in
our code (`TelegramAuthRequest`, `/telegram/start`, the browser-binding cookie `cs_tg_req`, status polling), so we
reuse it.

**Deep-link flow.**
1. Web `POST /auth/telegram/start {purpose: LOGIN}` → request (5 min life), `deepLink`, and a 2-digit match code.
   The cookie `cs_tg_req` ties the request to this browser.
2. The customer taps the link; the bot gets `/start <token>`.
   - Telegram id is linked to an account → the bot says *"Log in to Cambo Supply as <name>? Started from <browser>
     at <time>, code <NN>. Only tap if you are doing this right now."* with **✅ Log me in** / **Not me**.
     This button stops a phishing link from logging an attacker's browser into the victim's account.
   - Not linked → the bot asks the customer to share their phone (the sign-up and linking flow, part b).
3. The tap marks the request VERIFIED with `userId`. The web page, polling `/telegram/:id/status`, calls
   `POST /auth/login/complete {requestId}`. The api uses the request once (it already has `consumeVerifiedRequest`)
   and starts a session.

**Mini App flow.** On load, if `isTelegramMiniApp()` and no session: `POST /auth/telegram/webapp {initData}`.
The api builds the data-check string (every field except `hash`, sorted, joined with `\n`), checks
`HMAC_SHA256(key = HMAC_SHA256("WebAppData", bot_token), data)` with a constant-time compare, checks `auth_date`,
then finds the user by `user.id`. Not linked, or stale data → fall back to the deep link (inside Telegram it opens
the bot chat directly). The api gets only the **derived key** (`TELEGRAM_WEBAPP_KEY`), not the bot token, so it can
check signatures but cannot control the bot.

## (b) Existing accounts

- Accounts that signed up through the bot already have `telegramUserId` set; they log in at once. Nothing to migrate.
- Accounts without one (created by an admin in **Customers**, or seed data) get linked the first time they press
  Continue: the bot asks for their phone, the shared contact must be their own (`contact.user_id === from.id`,
  as today), and if that phone belongs to an account with no Telegram link, we link it and log them in.
- That phone is already linked to a *different* Telegram account → refuse, and the bot says "contact the shop".
  There is no self-service way to move an account to a new Telegram account.
- **Recovery replaces forgot-password.** An admin presses **Unlink Telegram** on the customer page. This clears the
  link and ends all of that customer's sessions. The customer then links again by sharing their phone.
- Changing phone number (`CHANGE_PHONE`) stays as it is.

## (c) Sessions after login

Keep what we have: an opaque random token in the `cs_session` cookie (httpOnly, Secure, SameSite=Lax), only its
sha256 stored in `Session`, expiry pushed forward at most once a day, logout and log-out-everywhere. No JWTs.
The Mini App is served from our own domain, so the cookie is first-party there too. Existing sessions stay valid
through the switch. Unlinking Telegram or disabling a user ends all their sessions.

## (d) What we delete

- **api:** `POST /login` (phone + password), `/change-password`, `/reset/complete`, the `RESET` purpose and its bot
  branch, `auth/password.ts` and the `argon2` dependency, the password in admin **create customer**, the
  "choose your password" text of the bot-first sign-up (its link now logs the customer in straight away).
- **shared:** `loginSchema`, `resetCompleteSchema`, `changePasswordSchema`, `passwordSchema`, `password` in
  `signupCompleteSchema` and the admin customer schema.
- **db:** two migrations. Release 1: `passwordHash` becomes nullable and nothing reads it (so we can roll back).
  Release 2: drop `passwordHash` and `passwordChangedAt`, delete `RESET` rows, drop the `RESET` enum value, add `LOGIN`.
- **web:** `ForgotPasswordPage`, the `/forgot-password` route, `passwordCheck.ts`, the password parts of
  `LoginPage` / `SignupPage` (merge them into one page; `/signup` redirects to `/login`), the change-password part of
  `ProfilePage`, the password field in admin `Customers`, the password strings, `forgot-password` in `BottomNav` and robots.txt.
- **tests and docs:** the password cases in `auth.test.ts`, `telegram-verification.test.ts`, `schemas.test.ts`,
  `LoginPage.test.tsx`, `SignupPage.test.tsx`; README, `architecture.md`, `deployment.md`, and a dated note in the
  rebuild spec.

## (e) Admin login: open question for the human

Admins today are normal users with `role = ADMIN` who use the same login. Not decided; the human must answer:
1. Do admins also log in only with Telegram? *Proposed: yes, same flow. The owner's Telegram is already linked for
   the order buttons, and keeping one password path alive keeps all the code we are deleting.*
2. If the owner loses their Telegram account, how do they get back in? *Proposed: a server command
   `npm run admin:unlink-telegram -w api -- <phone>`, run over SSH, the same way as `admin:promote`.*
3. Should admin sessions be shorter (for example 1 day instead of the customer setting)?

Until this is answered, tasks marked **[admin-gated]** wait.

## Tasks, in order

**api: Builder Oscar** (bot code in `notification` included)
1. Count users with `telegramUserId IS NULL`, split by role, and report the numbers (they show how many people
   need linking).
2. Migration 1: `passwordHash` nullable; add `LOGIN` to `TelegramAuthPurpose`.
3. `POST /auth/telegram/start` accepts `LOGIN` (5 min life, match code, the user's browser and the time stored on the
   request); `POST /auth/login/complete`.
4. Bot `/start` for LOGIN: the linked account gets the confirm message; an unlinked one goes to the phone share, which
   links the phone or signs up (no password). `notification`: send `login:<requestId>:y|n` button taps to a new
   `POST /internal/telegram/login-confirm`, which checks that `cq.from.id` matches the request.
5. `POST /auth/telegram/webapp`: HMAC check, `auth_date` window, single-use `hash`, using `TELEGRAM_WEBAPP_KEY`.
6. Admin **Unlink Telegram** endpoint (ends sessions); drop the password from admin create customer.
7. Delete the password routes, the `RESET` flow, `password.ts`, `argon2`, and the password schemas in `shared`.
8. **[admin-gated]** `admin:unlink-telegram` CLI; admin session length if the human wants it shorter.
9. Migration 2 (contract), shipped in the release *after* 2–7 are live.

**web: Frontend Developer**
1. One **Continue with Telegram** page: deep link button, the match code, a "waiting for Telegram…" state, and
   picking up again after a reload (reuse `useTelegramVerification` / `TelegramStep`). `/signup` → `/login`.
2. Mini App: silent `initData` login on load, falling back to the deep link.
3. Remove `ForgotPasswordPage`, the route, `passwordCheck.ts`, change-password in Profile, the password field in
   admin Customers, and the unused strings; add the **Unlink Telegram** button on the customer detail page.

**tests: Reviewer Angela**
1. initData: valid passes; wrong hash, edited field, `auth_date` older than 5 min or in the future, and a reused
   `hash` all fail.
2. Deep link: expired token, a token used twice, a confirm tap from a different Telegram id, **Not me**, completing
   without the `cs_tg_req` cookie, a disabled user.
3. Linking: an unlinked phone links; a phone linked to another Telegram id is refused; a forwarded contact is refused.
4. Unlink ends sessions; the old routes (`/login`, `/reset/complete`, `/change-password`) answer 404.
5. Delete or rewrite the password tests listed in (d); web tests for the new login page and the Mini App fallback.

**deploy/env: DevOps Kevin**
1. Add `TELEGRAM_WEBAPP_KEY` (= hex of `HMAC_SHA256("WebAppData", bot token)`) to the api's production secrets and
   the k8s/compose wiring; document how to recompute it when the bot token changes. Do not give the api the bot token.
2. Check the webhook secret is set in production (the deep-link proof depends on it) and that the site is https
   (Mini Apps need it).
3. Release 1 → check logins in the logs and Grafana → Release 2 (migration 2). Rollback: before migration 2, roll
   back the image only.
4. Update `deployment.md` and the env examples (without reading or committing any real `.env` file).
