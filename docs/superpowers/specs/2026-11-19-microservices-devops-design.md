# Microservices and DevOps readiness: design

Date: 2026-11-19. Status: approved by the owner ("go with B"), building now.

## Intent and why

The course brief ("DevOps Project: Microservices Application", `DevOps_Project 2026.pdf`) asks for a small
application made of independent services that each **own their data and database**, talk over REST, run in
Docker Compose, build and publish images through CI/CD, deploy to a host, and are watched with **centralized
logs and metrics**. The shop already has the services (`api`, `file`, `report`, `web`) and Docker/CI basics, but:

1. `report` reads the api's database directly, and `file` has no database: the data-ownership rule is broken.
2. CI builds images but never publishes them.
3. There is no metrics, no log collection, no dashboards.
4. There is no report, diagram or demo script.

Goal: satisfy every requirement in the PDF, so the project can be demonstrated end to end, and be **ready to
deploy** (everything prepared, nothing deployed).

## Goals / non-goals / anti-goals

Goals
- Four independent services, each with its own database, Dockerfile and REST API, plus the web front end.
- A real Notification Service (Telegram) split out of the api (approach B).
- Durable, observable service-to-service communication (nothing lost when a service is down).
- Metrics (Prometheus + Grafana) and centralized logs (Loki + Grafana Alloy) with dashboards and alert rules.
- CI that tests and builds, and publishes images to GHCR on `main` and tags; a manual deploy workflow, unused for now.
- Documents for the submission: architecture, report draft (4-5 pages), presentation outline, runbook.

Non-goals
- Deploying anywhere. No cloud account, DNS, server or secrets are touched.
- Splitting payments out of the api (approach C): payment creation runs inside the order transaction.
- Kubernetes, service mesh, a message broker. Postgres-backed outboxes are enough at this size.

Anti-goals (would make this a failure even if it "works")
- Losing orders, payments or Telegram messages because a helper service is down.
- Shop behaviour changing for customers or admins.
- Secrets in the repo; internal routes or `/metrics` reachable from the internet.

## Approaches considered

- **A. Minimal.** Give `report` and `file` their own databases and leave the Telegram bot in the api.
  Cheapest, but only two thin services and a weak "independent services" story.
- **B. Split out Notification (chosen).** A + a Notification Service owning the Telegram bot and its message
  queue. Matches the brief's own example list ("Notification Service") and is a clean seam: the outbox already
  existed as a self-contained component.
- **C. Also split out Payment.** Strongest, but order creation calls `createPayment` inside one database
  transaction; separating it needs distributed-transaction work and risks money bugs. Rejected for now.

## Architecture

```
browser ─► web (nginx) ─┬─ /api/*            ─► api ──► api-db (Postgres)
                        ├─ /files/*          ─► file ─► file-db  + blob storage (disk or S3)
                        └─ /telegram/webhook ─► notification ─► notification-db
Telegram ─────────────────────────────────────┘

api ──REST /internal/*──► file          (store / delete image)
api ──events (outbox)───► notification  (order placed / status / paid / alerts)
api ──events (outbox)───► report        (order snapshots)  ──► report-db
api ──REST──────────────► report        (invoice PDF, sales reports)   [report reads only its own db]
notification ──REST /internal/*──► api  (bot messages that need shop data; order buttons)

Prometheus ─scrapes /metrics─► api, file, report, notification, cAdvisor
Alloy ─reads container logs (docker socket)─► Loki ─► Grafana (also reads Prometheus)
```

| Service | Responsibility | Own data |
|---|---|---|
| `api` | Accounts and sessions, catalog, pricing, orders, KHQR payments, admin | `api-db` (Prisma) |
| `file` | Image processing and storage, public file serving | `file-db` (asset registry) + blobs |
| `report` | Sales reports, CSV, invoice PDFs | `report-db` (read model of orders) |
| `notification` | Telegram: delivery queue, retries and rate limits, order alerts, owner's order buttons | `notification-db` (outbox, received events) |
| `web` | SPA and reverse proxy | none |

### Rules for service-to-service communication

- Internal REST lives under `/internal/*` with a per-service bearer secret, on the private Docker network.
  nginx never proxies `/internal` or `/metrics`.
- **State that other services need is pushed as events from the api**, written to a `ServiceEvent` outbox table in
  the same moment the change happens, then delivered by a worker (immediately, then with backoff) to
  `POST /internal/events` of the target. Delivery is at-least-once; receivers are idempotent:
  - report keeps the newest snapshot per order (`emittedAt` compared), so late or repeated events do nothing;
  - notification de-duplicates on a key per event (`order:<id>:customer:<status>`).
- Events are described once, as zod schemas in `@cambo/shared` (`events.ts`), used by sender and receivers.
- Every request carries `x-request-id`; it is forwarded through events too, and every log line includes it, so one
  customer action can be followed across services in Loki.

### Notification service (new)

- Receives events, renders the Telegram messages (customer and owner), stores them in its outbox, sends right
  away, retries with backoff, honours Telegram's rate limit, never retries a blocked user. (The outbox logic written
  earlier moves here unchanged in behaviour.)
- Owns the bot token, the admin chat id, the webhook (`POST /webhook`, secret header) and long polling in
  development, and the bot's command menu.
- Inline order buttons: it checks the presser is the owner's chat, then calls `POST /internal/orders/:id/status`
  on the api (which owns orders and decides if the move is valid).
- Customer chat messages (sign-up verification, `/orders`, `/shop`, `/help`) need accounts and orders, so the update
  is forwarded to `POST /internal/telegram/updates` on the api, which answers with a list of actions to perform.
  The api no longer talks to Telegram at all.

### Report service (own database)

- `POST /internal/events` upserts order snapshots into `orders` and `order_items`.
- Sales queries and invoices read only these tables. The old read-only login to the api database is removed.
- A one-off `events:backfill` command in the api replays every existing order as a snapshot.

### File service (own database)

- `assets` table records every stored image/file (key, kind, type, size, dimensions). It is a registry used for
  stats and metrics; serving never depends on it.

### Observability

- Every service exposes `/metrics` (prom-client): default process metrics (CPU, memory, event loop), HTTP
  request count and duration histogram by route, plus business metrics (orders created, outbox backlog by target,
  Telegram sends by result, events applied).
- Prometheus (+ alert rules: service down, 5xx rate, p95 latency, outbox backlog, memory), cAdvisor for container
  CPU and memory, Grafana with provisioned datasources and two dashboards (Services, Logs).
- Logs: pino JSON on stdout with `service`, string `level`, `requestId`. Grafana Alloy reads container logs from the
  Docker socket and ships them to Loki (Promtail is end-of-life). Retention 7 days.

### CI/CD

- `ci.yml`: lint, typecheck, tests for all services (each with its own test database), builds; on `main` and tags
  also builds and **pushes** five images to GHCR (`ghcr.io/<owner>/cambokb-<service>`, tags `sha-…`, `latest`, semver);
  pull requests build without pushing. A job brings the whole Compose stack up and runs `scripts/smoke.sh`.
- `deploy.yml`: manual (`workflow_dispatch`) only; SSHes to a server and runs `docker compose pull && up -d`.
  Needs repository secrets that do not exist yet, so it cannot run by accident.

### Shared code

A new workspace `@cambo/service-kit` (Node only) holds what every service repeats: logger with request-id
context, metrics registry and middleware, service-secret middleware, SQL migration runner. Services stay
independently deployable; they share a library, not a database.

## Decisions I made (not asked)

- One Postgres **container per service** in Compose (clear "own database", small cost).
- Plain SQL migrations for file, report and notification (tiny runner in service-kit); Prisma stays for the api.
- GHCR as the registry (no extra secrets needed in GitHub Actions); Docker Hub can be added later.
- Grafana Alloy instead of Promtail; Loki single-binary on local disk.
- Telegram webhook path moves to `/telegram/webhook` (served by notification). The old path under `/api/v1` is removed.
- Telegram settings (`TELEGRAM_*`) move from the api's environment to the notification service's; the api keeps only
  `TELEGRAM_BOT_USERNAME` for the sign-up link.

## What is left to the builder

Dashboard layout details, alert thresholds, exact metric names, file layout inside each service, test data.

## Build order

1. service-kit + event contracts. 2. file-db. 3. report-db and events. 4. api outbox, internal routes, remove Telegram.
5. notification service. 6. Metrics and logging in all services. 7. Observability stack, Dockerfiles, Compose, nginx.
8. CI/CD and smoke script. 9. Documents. 10. Verify: all tests, builds, and the full stack running in Docker.
