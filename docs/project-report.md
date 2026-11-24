# DevOps Project: Cambo Supply, a microservices shop

> Draft of the 4–5 page report. Fill in the names, the links in section 8 and the screenshots (marked 📷) before submitting.

**Team:** _names and contributions_  ·  **Course:** DevOps 2026

## 1. Overview

Cambo Supply is an online shop for mechanical keyboards, mice and desk accessories in Cambodia. Customers browse a catalogue,
sign up by sharing their phone number with the shop's Telegram bot, pay with cash on delivery or by scanning a **KHQR** code
with any Cambodian bank app, and follow their order by Telegram messages. The owner runs the shop from an admin site
(products, orders, customers, reports, invoices) and can **confirm, pack and ship an order straight from a Telegram
button**.

The problem it solves: a small shop that took orders by chat needs a reliable catalogue, correct prices, stock that never
goes below zero, payments it can trust, and an owner who is told about every order immediately.

Intended users: shoppers in Phnom Penh and the provinces (mostly on phones), and the shop owner/staff.

## 2. Services and why the application is divided this way

| Service | Responsibility | Why separate |
|---|---|---|
| **api** | Accounts, catalogue, pricing, orders, payments, admin data | The business core: an order, its stock and its payment must commit together |
| **file** | Resize and store product photos, serve them | CPU-heavy image work and object storage have their own scaling and failure profile |
| **report** | Sales reports, CSV, invoice PDFs (headless Chrome) | Heavy, and reporting must never slow down checkout |
| **notification** | Telegram: queue, retries, alerts, the owner's order buttons | A slow or unreachable third party must never block an order |
| **web** | React app + nginx, the single public entry point | Static files and routing |

Each service has **its own database** (four PostgreSQL instances), its own Dockerfile, REST API, tests and CI job.
Nothing reads another service's database. 📷 _architecture diagram (docs/architecture.md)_

## 3. Technology stack

TypeScript everywhere, Node.js 22, Express 5; React 19 + Vite + Tailwind for the front end; PostgreSQL 17 with Prisma (api) and
plain SQL migrations (other services); zod for validation and for the **event contracts shared by all services**; sharp (images),
jsreport + Chromium (PDFs); Redis (a 30-second cache of the public catalogue and shared rate limits); Telegram Bot API; Bakong KHQR; Vitest + Supertest for tests; Docker and Docker Compose;
GitHub Actions and GitHub Container Registry; Prometheus, Grafana, Loki, Grafana Alloy and cAdvisor.

## 4. Implementation

**REST APIs.** Each service exposes a small REST API. Public routes go through nginx (`/api`, `/files`, `/telegram/webhook`);
service-to-service routes live under `/internal`, need a per-service bearer secret and are never routed by nginx
(the smoke test checks this).

**Service-to-service communication.** Two styles, chosen deliberately:

- *Request/response* when the caller needs the answer now: api → file (store an image), api → report (an invoice PDF),
  notification → api (what to reply to a chat message, apply an order button).
- *Events* when other services only need to know what happened: the api writes an event in the **same database
  transaction** as the change (`ServiceEvent` table), delivers it immediately, and retries with backoff if the target is
  down. Delivery is at-least-once, so the receivers are idempotent: `report` keeps the newest snapshot of each order,
  `notification` records every event id it handled. The shop keeps selling while Telegram or the report service is down and
  nothing is lost.

**Data ownership.** `report` used to read the api's tables; it now keeps its own copy of the order facts it needs, filled by
`order.snapshot` events and rebuilt with a one-line command. `file` records every stored asset in its own database, and
undoes an upload it cannot record.

**Quality.** About 400 automated tests, including a test that starts the api, report and notification service as real HTTP
servers with their own databases and follows an order through all three (and through "notification service down, then back").
A `scripts/smoke.sh` checks the whole Docker stack: every service and database, secrets between services, metrics, logs and dashboards.

## 5. DevOps workflow

**Docker and Compose.** One multi-stage Dockerfile per service (small final images, non-root user, health checks, `tini`).
`docker compose up` starts everything with a Postgres per service; `--profile observability` adds monitoring.
`docker-compose.prod.yml` is the server version: images from the registry, secrets from an env file, only nginx public.

**CI/CD** (`.github/workflows/ci.yml`). On every push and pull request: lint, type-check, the tests of every service (each against its own
test database), builds, and a job that starts the full Compose stack and runs the smoke test. On `main` and version tags it
**publishes five images** to GitHub Container Registry (`sha-<commit>`, `latest`, semver tags, layer cache).
`deploy.yml` is a manual workflow that pulls a chosen tag on the server and restarts, then checks the site answers.
📷 _Actions run, Packages page_

**Deployment.** Planned for a **DigitalOcean Droplet** (Docker Compose) behind **Cloudflare** (DNS, TLS and protection
through a Cloudflare Tunnel, so no port is open to the internet; R2 optionally for photos). Prepared and rehearsed locally:
the whole stack runs in Docker, nginx reads visitors' real addresses from Cloudflare, backups and restores are tested.
The step-by-step is in `docs/deployment.md`. _Add the URL here once deployed._

## 6. Observability

**Metrics.** Every service exposes Prometheus metrics: availability (`up`), request rate, errors and a response-time
histogram per route, CPU, memory, event-loop lag, plus business and communication metrics (orders, KHQR outcomes, events
waiting per target, Telegram messages by result, orders held by the report service). Grafana's *Services* dashboard shows
them; alert rules cover a service being down, error rate, slow responses, a backlog of undelivered events and failing
Telegram messages; a *cache hit ratio* panel shows how much of the catalogue Redis answers. 📷 _services dashboard_

**Centralized logging.** Every service logs one JSON line per event with its name, level and a request id that follows the
request across services. Grafana Alloy collects every container's logs into Loki; the *Logs* dashboard shows errors from all
services, lets you search, and **follow one request across the api, report and notification services**. 📷 _logs dashboard_

**What they revealed.** While building the smoke test, the report service logged
`duplicate key value … orders_number_key`. Following the request id in Loki showed the api's event and the report's failure
side by side: an order number reused after a reset. The service now answers a final `409 ORDER_NUMBER_CONFLICT`, the
backlog alert covers it, and the fix is one command. A second demonstration stops the notification service, places an order
(it succeeds), shows "events waiting" climbing for that target only, then restarts it and watches the queue drain.

## 7. Lessons and limits

- A shared database would have been simpler, but then the services would not be independent; events with an outbox gave
  independence without losing data.
- Redis now keeps the catalogue cache and the rate-limit counters, so those no longer tie the api to one process. The
  in-process live-update stream for admins still does: scaling out would also need Postgres `LISTEN/NOTIFY` or Redis pub/sub.
- Splitting payments out of the api was considered and rejected for now: order creation takes the payment inside one
  transaction.

## 8. Links

| | |
|---|---|
| Source code | https://github.com/Vichea-collab/CamboKB |
| Container images | `ghcr.io/vichea-collab/cambokb-api`, `-file`, `-report`, `-notification`, `-web` (GitHub → Packages) |
| CI/CD runs | https://github.com/Vichea-collab/CamboKB/actions |
| Deployed application | _not deployed yet, add the URL_ |
| Grafana (dashboards, logs) | _server only; screenshots above_ |
| Documentation | `README.md`, `docs/architecture.md`, `docs/observability.md`, `docs/deployment.md` |
