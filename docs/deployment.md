# Deployment: ready, not deployed

Everything needed to deploy is prepared and tested locally. Nothing has been deployed. This is the order of work for when a
server is chosen.

## 0. What is already done

- [x] A Dockerfile for each service (`docker/*.Dockerfile`) and a Compose file for local use (`docker-compose.yml`)
      and for a server (`docker-compose.prod.yml`), each service with its own database.
- [x] CI builds and tests everything on every push and publishes five images to GitHub Container Registry on `main` and `v*` tags.
- [x] `deploy.yml`: a manual workflow that pulls the images on a server. Needs the secrets below.
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

Fill in `.env.production`: `PUBLIC_ORIGIN`, `IMAGE_REPO`, the four database passwords, the four service secrets, the
Telegram bot token, username, webhook secret and your chat id, `GRAFANA_ADMIN_PASSWORD`, the Cloudflare Tunnel settings,
and (optionally) the Bakong account and token and the R2 settings. The services refuse to start with short or placeholder secrets.

## 4. First start

```bash
export COMPOSE_PROFILES=tunnel   # only when using the Cloudflare Tunnel
docker compose -f docker-compose.prod.yml --env-file .env.production pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
docker compose -f docker-compose.prod.yml --env-file .env.production ps           # everything healthy
docker compose -f docker-compose.prod.yml --env-file .env.production exec api node dist/seed.js        # optional demo catalog
docker compose -f docker-compose.prod.yml --env-file .env.production exec api node dist/promote-admin.js 012345678   # after you sign up
```

Each service creates its own tables on start. The notification service registers the Telegram webhook at
`PUBLIC_ORIGIN/telegram/webhook` by itself.

Then run the smoke test against the real address from your laptop: `WEB=https://shop.example.com scripts/smoke.sh`
(the parts that reach into Docker need to run on the server: `scripts/smoke.sh` there).

## 5. Later deploys

- By hand: `IMAGE_TAG=sha-1a2b3c4 docker compose -f docker-compose.prod.yml --env-file .env.production pull && … up -d`.
- From GitHub: set the repository secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` and variables `DEPLOY_PATH`,
  `PUBLIC_HOST`, create an environment named `production` (add required reviewers if you want an approval step), then
  Actions → Deploy → Run workflow with the tag to run.
- Roll back by deploying the previous tag.

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
