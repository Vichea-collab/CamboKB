# 10-minute presentation and demo

Order follows the brief: overview → services → architecture → implementation → DevOps workflow → observability.
Everyone should be able to explain the whole picture; split the speaking by section.

| Min | Section | Say | Show |
|---|---|---|---|
| 0:00 | **Overview** | A shop for keyboards in Cambodia. Telegram sign-up, KHQR payments, owner alerts. Users: shoppers and the owner. | The shop on a phone-sized window |
| 1:00 | **Services** | Five services, each with one job and its own database. Why: orders must be atomic; images, PDFs and Telegram are slow or heavy and must never block a sale. | `docs/architecture.md` table |
| 2:30 | **Architecture** | Public path through nginx; private `/internal` calls; events with an outbox. | The Mermaid diagram, then the "order placed" sequence |
| 4:00 | **Implementation** | zod contracts shared by all services; at-least-once events + idempotent receivers; per-service migrations; request id everywhere. | `shared/src/events.ts`, the `ServiceEvent` table |
| 5:00 | **DevOps workflow** | Dockerfile per service; Compose with a Postgres each; CI tests + builds + publishes to GHCR; manual deploy workflow. | `docker compose up`, `scripts/smoke.sh` output, the Actions run, the Packages page |
| 6:30 | **Observability** | Metrics and central logs. | Grafana *services* dashboard, then *logs* |
| 7:30 | **Demo: a service goes down** | Stop notification, place an order, nothing lost. | `docker compose stop notification` → order works → "Events waiting" climbs → `start` → drains, Telegram messages arrive |
| 9:00 | **Demo: investigate an error** | Find the cause from the logs. | Errors panel → request id → *Follow one request* → explain → fix |
| 9:45 | **Wrap up** | What we'd do next: deploy, payment service split, Alertmanager. | Links slide |

## Demo checklist (do this 10 minutes before)

```bash
docker compose --profile observability up -d --build --wait
scripts/smoke.sh                       # must end with "All checks passed"
npm run db:seed -w @cambo/api          # optional: a catalogue to show (needs the file service)
```

- Log in to Grafana (admin / admin), open both dashboards, set the time range to the last 15 minutes.
- Have a signed-in customer in one browser and the owner's Telegram chat open next to it.
- To have an error to investigate: send the report service a clashing order number (see `docs/observability.md`, demo 1).
- Plan B if Telegram is unreachable: `TELEGRAM_MODE=off` still logs every message the notification service would send; show them in the logs.
