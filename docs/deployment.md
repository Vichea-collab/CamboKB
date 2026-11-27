# Deployment

This guide covers the DigitalOcean deployment. For provisioning with Terraform and running releases with Jenkins,
see [Jenkins and Terraform](jenkins-terraform.md).

## 0. What is already done

- [x] A Dockerfile for each service (`docker/*.Dockerfile`) and a Compose file for local use (`docker-compose.yml`)
      and for a server (`docker-compose.prod.yml`), each service with its own database.
- [x] CI builds and tests everything on every push and publishes five images to GitHub Container Registry on `main` and `v*` tags.
- [x] `deploy.yml`: deploys after successful CI on `main` when enabled and supports manual rollback.
- [x] `scripts/smoke.sh` proves a running stack is wired up (also run by CI).
- [x] Monitoring (Prometheus, Grafana, Loki, Alloy, cAdvisor) in the same Compose file, with dashboards and alert rules.
- [x] Cloudflare: an optional Tunnel container, nginx reads the visitor's real address from Cloudflare's header (tested).
- [x] DigitalOcean: a backup script (backup and restore tested), capped container logs, a sizing and firewall guide.

## 1. Publish the images

1. Push to `main` (or tag `v1.0.0`). Actions → CI → the *Image* jobs publish
   `ghcr.io/<owner>/cambokb-{api,file,report,notification,web}`.
2. In GitHub → Packages, make the five packages public (simplest), or keep them private and run
   `docker login ghcr.io -u <user>` once on the server with a token that has `read:packages`.
3. Web build settings (repository *variables*, used while building the `web` image): `PUBLIC_ORIGIN` (the https address of
   the shop) and `TELEGRAM_BOT_USERNAME`. The web image bakes them in, so set them **before** the first publish.

## 2. DigitalOcean and Cloudflare

The plan: one **DigitalOcean Droplet** runs Docker Compose; **Cloudflare** is in front (DNS, TLS, caching, protection),
reaching the shop through a **Cloudflare Tunnel** so no port is open to the internet. **Cloudflare R2** (or DigitalOcean
Spaces) can hold the product photos.

### The Droplet

| Setting | Choice | Why |
|---|---|---|
| Image | Ubuntu 24.04 LTS | Docker is easy to install and stays supported |
| Size | 2 vCPU / 4 GB RAM / 80 GB (about USD 24 per month) | Five services, four Postgres and the monitoring use about 2.5 GB; 2 GB is too tight. Leave monitoring out and a 2 GB Droplet with swap works |
| Region | Singapore (`sgp1`) | Nearest to Cambodia for shoppers |
| Extras | Enable **backups** (weekly snapshots) and add your SSH key; no password login | Cheap safety net |
| Cloud Firewall | Inbound: **22 only** (restrict to your IP if you can). With a Tunnel, 80 and 443 stay closed | The Tunnel connects outward; nothing needs to reach the server |

After creating it, on the server: install Docker (`curl -fsSL https://get.docker.com | sh`), add a deploy user to the
`docker` group, turn on `unattended-upgrades`, and create `/opt/cambo-supply`.

> **KHQR and Cambodia.** Bakong's API may refuse requests from outside Cambodia, and Singapore counts as outside. If
> payments say the token is rejected although it is valid, run a tiny relay inside Cambodia and set `BAKONG_API_URL`
> to it (see the KHQR section of the README). Test with a small real payment before announcing.

### Cloudflare

1. **Add the domain** to Cloudflare and point the registrar's nameservers at it.
2. **Tunnel.** From any machine that is logged in to Cloudflare (`cloudflared tunnel login`, pick the domain once):
   ```bash
   cloudflared tunnel create cambokb                              # writes ~/.cloudflared/<tunnel-id>.json (a secret)
   cloudflared tunnel route dns cambokb shop.example.com          # creates the DNS record; TLS is handled by Cloudflare
   ```
   In `.env.production` set `CLOUDFLARE_TUNNEL_ID`, `CLOUDFLARED_CREDENTIALS_FILE` (the path of that JSON file on the
   machine that runs the stack, copy it there if it is a server) and `WEB_BIND=127.0.0.1:80`. Start the stack with
   `export COMPOSE_PROFILES=tunnel` (Compose reads that from your shell, not from the env file; `deploy.yml` sets it
   from the repository variable `COMPOSE_PROFILES`). The container forwards the hostname to `web:80`, so there is
   nothing more to set in the dashboard, except SSL/TLS **Full** and **Always Use HTTPS**. This does not need Zero
   Trust to be switched on. To retire it: `cloudflared tunnel delete cambokb` and remove the DNS record.
3. **The shop's real visitor address.** nginx reads Cloudflare's `CF-Connecting-IP` (`docker/nginx/real-ip.inc.template`;
   tested). Without it the api would see one address for every shopper and its per-address login limit would lock them
   out together.
4. **Let Telegram in.** Telegram's servers call `https://shop.example.com/telegram/webhook`. Cloudflare's bot protection
   can block them. Security → WAF → Custom rules → *Skip* all managed rules and Bot Fight Mode when
   *URI Path equals* `/telegram/webhook`. (The service still checks Telegram's secret header.)
5. **Caching.** Rules → Cache Rules: bypass cache for `/api/*`; cache `/files/*` (the files never change, they are
   served `immutable`). Do not cache `/api/v1/admin/events` (the live admin stream); Cloudflare streams it, and the shop
   sends a heartbeat every 20 s so the connection is not closed as idle.
6. **Protection.** WAF → Rate limiting rule for `/api/v1/auth/*` (for example 20 requests per minute per IP) in addition
   to the shop's own limits.
7. **Private dashboards.** Don't publish Grafana. Reach it with `ssh -L 3001:127.0.0.1:3001 <droplet>`, or add a second
   tunnel hostname protected by **Cloudflare Access** (email login) pointing at `http://grafana:3000`.
8. **Images on R2 (optional).** Create a bucket, an API token with read/write on it, then in `.env.production`:
   `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`,
   `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Photos still come through `/files/…` (cached by Cloudflare), so no CSP
   change is needed. Without R2 they live in the `uploads` Docker volume on the Droplet: include it in your backups.

Without a Tunnel (Cloudflare "proxied" DNS pointing at the Droplet's IP) it also works: leave `WEB_BIND` at its default,
open 80 to Cloudflare's ranges only in the Cloud Firewall, and note Cloudflare would reach your origin over plain HTTP in
"Flexible" mode. The Tunnel is encrypted end to end and recommended.

## 3. Configure

On the server, in a folder such as `/opt/cambo-supply`:

```bash
# copy docker-compose.prod.yml and the observability/ folder there (deploy.yml does this for you)
cp .env.production.example .env.production
openssl rand -base64 36        # run once per secret / password
```

Fill in `.env.production`: `PUBLIC_ORIGIN`, `IMAGE_REPO`, the four database passwords, `REDIS_PASSWORD` (see "Redis" below), the four service secrets, the
Telegram bot token, username, webhook secret, `TELEGRAM_WEBAPP_KEY` (see "Telegram login" below) and your chat id, `GRAFANA_ADMIN_PASSWORD`, the Cloudflare Tunnel settings,
and (optionally) the Bakong account and token and the R2 settings. The services refuse to start with short or placeholder secrets.

### Redis

The api uses a Redis container for two things: a 30-second cache of the public catalogue (categories, banners, the
product list and search) and the rate-limit counters, which then hold across several api copies. It is only a cache:
nothing is saved to disk, the oldest entries are evicted at `REDIS_MAXMEMORY` (default `64mb`; a 1 GB server may use
`32mb`), and the shop keeps working, just a little slower, if Redis stops. Set `REDIS_PASSWORD` to letters and digits
only (`openssl rand -hex 24`), because it is put in the api's `REDIS_URL`. Redis has no published port.

Adding it to a stack that is already running: add the two variables to `.env.production`, then
`docker compose -f docker-compose.prod.yml --env-file .env.production up -d redis api`.

## 4. First start

```bash
export COMPOSE_PROFILES=tunnel   # only when using the Cloudflare Tunnel
docker compose -f docker-compose.prod.yml --env-file .env.production pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
docker compose -f docker-compose.prod.yml --env-file .env.production ps           # everything healthy
docker compose -f docker-compose.prod.yml --env-file .env.production exec api node dist/promote-admin.js 012345678   # after you have logged in with Telegram once
```

Each service creates its own tables on start. The notification service registers the Telegram webhook at
`PUBLIC_ORIGIN/telegram/webhook` by itself.

Check the production catalog with `curl -fsS 'https://shop.example.com/api/v1/products?pageSize=1'`. Run
`scripts/smoke.sh` on a local or CI Compose stack, where it can stop Redis and insert test events.

## 4a. On a 1 GB server

`docker-compose.small.yml` on top of the production file runs the same services on a 1 GB Droplet (about USD 6 per month):
one Postgres holding four databases with four logins, no Grafana, Prometheus or Loki on the server (Alloy sends logs and
metrics to Grafana Cloud's free tier), and memory limits. Measured with made-up data: about 330 MB for the shop at rest,
and no out-of-memory with shoppers, PDFs and a large photo at the same time.

```bash
ssh root@<server> 'bash -s' < scripts/server-setup.sh      # once: swap, updates, firewall, Docker, deploy user
scripts/grafana-cloud-setup.sh                             # once, on your computer: saves .env.grafana
# on the server, as deploy, in /opt/cambo-supply (with API_DB_PASSWORD, REDIS_PASSWORD and the .env.grafana lines in .env.production):
export COMPOSE_FILE=docker-compose.prod.yml:docker-compose.small.yml COMPOSE_PROFILES=tunnel,cloud
docker compose --env-file .env.production up -d
node scripts/grafana-cloud-dashboards.mjs services | pbcopy   # paste into Grafana: Dashboards, New, Import (then: logs)
```

The firewall allows a few SSH connections per half minute, so scripts should reuse one connection.

## 4b. Telegram login

Customers and admins log in only with Telegram (no passwords). Three settings in `.env.production` make that work; the
stack refuses to start (`docker compose … up`) when `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` or
`TELEGRAM_WEBAPP_KEY` is empty, before it touches any running container. `ADMIN_SESSION_TTL_DAYS` is optional (default 1).

| Setting | Used by | What it is |
|---|---|---|
| `TELEGRAM_WEBHOOK_SECRET` | notification | Telegram sends it in the header `X-Telegram-Bot-Api-Secret-Token` on every update. A login tap is trusted only because of it. Make it with `openssl rand -hex 32` (Telegram allows only `A-Z a-z 0-9 _ -`, so not `-base64`) |
| `TELEGRAM_WEBAPP_KEY` | api | The key that checks logins from inside the Telegram Mini App. It is made from the bot token, but it is **not** the token: with it the api can check signatures and cannot control the bot. The api never gets the token |
| `PUBLIC_ORIGIN` | all | Must start with `https://`. Mini Apps only open https pages, and the session cookie is `Secure` (sent over https only) |

**Make or recompute `TELEGRAM_WEBAPP_KEY`.** It is 64 hex characters: HMAC-SHA256 of the bot token, with the key `WebAppData`.
Run this on your own machine or the server. The token is typed at the hidden prompt, so it stays out of the shell history
and out of any file:

```bash
read -rs T; printf %s "$T" | openssl dgst -sha256 -hmac "WebAppData" -hex | awk '{print $NF}'; unset T
```

Paste the output into `.env.production` as `TELEGRAM_WEBAPP_KEY=…`, then restart the api:
`docker compose -f docker-compose.prod.yml --env-file .env.production up -d api`.
**Do it again every time the bot token changes** (a rotation in @BotFather, or a token that leaked). Update
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBAPP_KEY` together, then `up -d notification api`. If you forget, Mini App logins
fail the signature check and customers fall back to the bot link, so nothing locks anyone out, but the silent login is gone.

**Check before a release goes live** (run on the server, in the folder with `.env.production`):

1. *Webhook secret is set and works.* `docker compose -f docker-compose.prod.yml --env-file .env.production config`
   fails with a clear message if a setting is empty. Then, from anywhere, a call with no header must be refused:
   `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://shop.example.com/telegram/webhook -H 'content-type: application/json' -d '{}'`
   prints `401`, never `200`. A `200` means anyone could fake a login tap: stop and fix it.
2. *Telegram has the webhook.* Ask Telegram (the token is read from the shell, not written into a file):
   `read -rs T; curl -s "https://api.telegram.org/bot$T/getWebhookInfo"; unset T` shows the url
   `https://shop.example.com/telegram/webhook`, `has_custom_certificate:false`, no recent `last_error_message`.
   Keep the output to yourself: it names your server.
3. *The site is https end to end.* `curl -sI http://shop.example.com | head -1` shows a redirect (`301`/`308`) to https
   (Cloudflare: SSL/TLS **Full**, **Always Use HTTPS**), and `curl -sI https://shop.example.com/healthz` is `200`.
   After a login, the `cs_session` cookie has `Secure; HttpOnly; SameSite=Lax` (browser dev tools → Application → Cookies).
   If the api is started with `COOKIE_SECURE=false` in production, logins work on plain http and the cookie can be stolen: never set it.
4. *The Mini App opens.* In @BotFather → your bot → Bot Settings → Menu Button (or Configure Mini App), the URL is the
   same `https://shop.example.com`. Open the bot in Telegram, tap the menu button: the shop loads and logs in without a tap.

**Release order (the database changes in two steps, so a rollback is always possible).**

1. **Release 1** (api tasks 2 to 7): `passwordHash` becomes optional and nothing reads it. Before deploying, add
   `TELEGRAM_WEBAPP_KEY` to the server's `.env.production`, and take a backup (`scripts/backup.sh`, see section 6).
   Deploy as in section 5.
2. **Watch it** (at least a day with real traffic): login and sign-up errors in Grafana (Loki, `service=api`, path
   `/auth/`), the count of failed `/auth/telegram/webapp` calls, `login-confirm` calls from the bot, and the `cs_session`
   logins per hour against the days before. A drop to zero is the alarm.
3. **Release 2** (api task 9): the migration that drops `passwordHash`, `passwordChangedAt` and the `RESET` value. It
   cannot be undone by an image rollback, so run `scripts/backup.sh` first and keep that backup until the release has
   run a week.
4. **Rollback.** Before Release 2: deploy the previous image tag only (section 5); the database needs nothing, because
   Release 1 only added a nullable column and a new enum value. After Release 2: restore the backup taken just before it,
   then deploy the Release 1 tag. Customers' orders placed in between are lost with that restore, so decide quickly.

**Owner recovery (lost Telegram account).** There is no password to fall back on. Over SSH, on the server:
`docker compose -f docker-compose.prod.yml --env-file .env.production exec api node dist/unlink-telegram.js <phone>`
(the production form of `npm run admin:unlink-telegram -w api -- <phone>`; npm script `admin:unlink-telegram:prod`). It clears the
Telegram link and ends that account's sessions. The owner then opens the bot, shares their phone number and logs in
with the new Telegram account. Admin sessions last `ADMIN_SESSION_TTL_DAYS` days (default 1) from login and do not extend with use. For a customer, use **Unlink Telegram** on the customer page in Admin.

## 5. Later deploys

- By hand: `IMAGE_TAG=sha-1a2b3c4 docker compose -f docker-compose.prod.yml --env-file .env.production pull && … up -d`.
- **Automatic deploys.** With `DEPLOY_ENABLED=true` and `JENKINS_RELEASE_ENABLED` unset, every push to `main` that passes CI goes
  live: `deploy.yml` asks the server to update itself to that commit. `scripts/server-deploy.sh` (installed there as
  `/usr/local/bin/cambo-deploy`) makes sure the commit is part of `main`, pulls its images, backs up, switches, checks the
  home page, products, a photo, every service, Telegram's route and the public address, and goes back by itself if a
  check fails. GitHub's key can do nothing else on the server: in `~deploy/.ssh/authorized_keys` it is
  `restrict,command="/usr/local/bin/cambo-deploy" ssh-ed25519 ...`. Secrets: `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`,
  `DEPLOY_SSH_KEY`. Install a changed script by hand, as root. To pause: set `DEPLOY_ENABLED` to `false`.
- Roll back: Actions → Deploy → Run workflow with an older commit of `main` (a database migration is not undone).

## 6. Backups

`scripts/backup.sh` dumps all four databases (checked for validity) into `backups/<timestamp>/` and removes old ones.
Run it nightly from cron and copy the folder off the Droplet (R2 or Spaces, with `BACKUP_UPLOAD_CMD`); the script's
header has the exact lines. A restore was tested: `gunzip -c <file> | docker compose … exec -T db psql -U cambo -d cambo_supply`.
Droplet backups (weekly snapshots) are a second layer, not a replacement. The report database can be rebuilt from the
api's data (README → "Rebuilding the report database"). Container logs are capped at 30 MB each on disk
(Loki keeps 7 days).

## 7. Watching it

`ssh -L 3001:127.0.0.1:3001 <server>` then open http://localhost:3001 (user `admin`). Prometheus is on 9090 the same way.
Connect Alertmanager (or Grafana alerting) to be messaged when an alert in `observability/prometheus/alerts.yml` fires.

## 8. Before announcing

See the checklist in the README: TLS, secrets, contact details in Admin → Settings, image storage and backups (all four
databases), rotating any Telegram token that was ever pasted somewhere public.
