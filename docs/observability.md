# Observability: logs and metrics

Everything here runs with `docker compose --profile observability up --build` (always on in `docker-compose.prod.yml`).

| What | Where | Port |
|---|---|---|
| Grafana (dashboards, log search) | http://localhost:3001 (login `admin` / `admin` locally) | 3001 |
| Prometheus (metrics, alerts) | http://localhost:9090 | 9090 |
| Loki (log storage) | inside the network, queried by Grafana | – |
| Alloy (log collector) | inside the network | – |
| cAdvisor (container CPU and memory) | inside the network, scraped by Prometheus | – |

## Metrics

Each service exposes `GET /metrics` (Prometheus text format) on its own port; nginx never routes it. Prometheus scrapes every
15 s (`observability/prometheus/prometheus.yml`). Check http://localhost:9090/targets: every job should be UP.

| Question | Metric | Dashboard panel |
|---|---|---|
| Is it up? | `up{job=…}` | Availability |
| How busy is it? | `http_requests_total` (by service, method, route, status) | Request rate, busiest routes |
| Is it failing? | the same with `status=~"5.."` | Error rate |
| Is it slow? | `http_request_duration_seconds` (histogram) | Response time p95, slowest routes |
| CPU and memory | `process_cpu_seconds_total`, `process_resident_memory_bytes`; cAdvisor `container_*` | CPU and memory |
| Is Node.js struggling? | `nodejs_eventloop_lag_*`, `nodejs_heap_size_used_bytes` | Event loop lag, Heap |
| Are the services talking? | `service_events_pending`, `service_events_failed`, `service_events_delivered_total`, `service_events_oldest_pending_age_seconds` | Events waiting, deliveries |
| Is Telegram getting through? | `telegram_messages_total{result}`, `notification_outbox_pending` | Telegram messages |
| Is the cache working? | `cache_requests_total{cache="catalog",result="hit\|miss\|error"}` | Cache hit ratio, Cache requests by result |
| Business | `orders_created_total`, `khqr_payments_total`, `report_orders`, `file_assets` | The shop and how the services talk |

**The cache.** The api caches the public catalogue in Redis for 30 seconds and counts every lookup:
`hit` (answered from Redis), `miss` (read from PostgreSQL and stored) and `error` (Redis failed, so the api read
PostgreSQL). A healthy shop shows mostly hits; a run of `error` means Redis is down, which slows the shop down a little but
does not break it. The two panels at the bottom of *Cambo Supply: services* show the hit ratio over 5 minutes and the
requests by result. Redis itself has no exporter: its health is its container health check and the `error` counter.

Alert rules (`observability/prometheus/alerts.yml`, see Prometheus → Alerts): ServiceDown, HighErrorRate, SlowRequests,
EventsBacklog, EventsGivenUp, TelegramBacklog, TelegramMessagesFailing, ContainerMemoryHigh.

> Per-container CPU and memory (cAdvisor) need a Linux host. On Docker Desktop for Mac only the whole VM is visible; the
> per-service process panels work everywhere.

## Logs

Every service writes one JSON object per line to stdout:

```json
{"level":"error","time":"2026-11-19T02:26:30.492Z","service":"report","requestId":"124a65d6-…","msg":"unhandled error","err":{…}}
```

Alloy reads the logs of every container of the Compose project, turns `service` and `level` into labels and ships them to
Loki. In Grafana → **Cambo Supply: logs**:

- *Errors, from every service*: the first place to look.
- *Follow one request across services*: paste a request id (from an error line, or from the `x-request-id` response
  header) and see every line from the api, report and notification service for that request.
- *All logs*: filter by service and a word.

In Grafana **Explore** (Loki) the same with LogQL:

```
{service="api", level="error"}
{service=~"api|report|notification"} |= "<request id>"
sum by (service) (count_over_time({service=~".+", level=~"warn|error"}[5m]))
```

## Demo 1: investigate an error with the central logs

A real example that happened while building this: the smoke test sent the report service an order whose number already
existed, and the report service failed.

1. **Notice it.** *Cambo Supply: logs* shows "Errors (last hour): 2" and the line in *Errors, from every service*.
2. **Read it.** The line says `service: report`, `url: /internal/events`, and
   `duplicate key value violates unique constraint "orders_number_key"` with the number that clashed.
3. **Follow it.** Copy its `requestId`, paste it into *Follow one request across services*: the api's line that sent the
   event and the report's line that failed are side by side.
4. **Explain it.** Same order number, different order: the shop's database was reset while the report database kept its
   rows. The service now answers a clear `409 ORDER_NUMBER_CONFLICT` (final, not retried) and the alert *EventsGivenUp*
   fires.
5. **Fix it.** Empty the report database and run `docker compose exec api node dist/events.js backfill`.

## Demo 2: a service goes down and nothing is lost

```bash
docker compose stop notification                 # Telegram part of the shop is now down
# place an order on the site: it works. Then look at Grafana "services":
#   "Events waiting" turns yellow, "Events waiting, by target" climbs for notification only,
#   the report service still receives its snapshot (Orders in report db goes up).
docker compose start notification
#   within seconds "Events waiting" drops to zero and the customer's and the owner's Telegram messages arrive.
```

Prometheus alert *EventsBacklog* fires if it stays down more than 5 minutes.

## Demo 3: the numbers

Open *Cambo Supply: services*, run `for i in $(seq 200); do curl -s localhost:8080/api/v1/products >/dev/null; done` and watch
request rate, response time p95 and the busiest routes react; `/metrics` of the api shows the same counters:
`docker compose exec api node -e "fetch('http://127.0.0.1:4000/metrics').then(r=>r.text()).then(t=>console.log(t))"`.
