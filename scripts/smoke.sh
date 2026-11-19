#!/usr/bin/env bash
# Checks that the whole Compose stack is wired up: every service answers, each has its own database,
# the services can reach each other with their secrets, metrics are collected, logs arrive in Loki,
# and Grafana has its dashboards. Run it against a running `docker compose --profile observability up`.
#
#   scripts/smoke.sh                 local stack (web on :8080, Grafana on :3001)
#   WEB_PORT=8089 GRAFANA_PORT=3009 PROMETHEUS_PORT=9099 COMPOSE_PROJECT_NAME=other scripts/smoke.sh
set -uo pipefail

WEB="${WEB:-http://localhost:${WEB_PORT:-8080}}"
GRAFANA="${GRAFANA:-http://127.0.0.1:${GRAFANA_PORT:-3001}}"
PROM="${PROM:-http://127.0.0.1:${PROMETHEUS_PORT:-9090}}"
GRAFANA_AUTH="${GRAFANA_AUTH:-admin:${GRAFANA_ADMIN_PASSWORD:-admin}}"
COMPOSE=(docker compose --profile observability)
# The local-stack secrets from docker-compose.yml (development only).
NOTIFICATION_SECRET="${NOTIFICATION_SECRET:-local-compose-notification-secret-7d41c9e0}"
REPORT_SECRET="${REPORT_SECRET:-local-compose-report-secret-5b2e8d90c1f7a346}"

fails=0
pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails + 1)); }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# wait_for "description" seconds command...   (retries until the command succeeds)
wait_for() {
  local what="$1" secs="$2"; shift 2
  local end=$((SECONDS + secs))
  until "$@" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$end" ]; then fail "$what"; return 1; fi
    sleep 3
  done
  pass "$what"
}
# svc_node SERVICE node-code: run a snippet of Node inside a container (Node 22 has fetch)
svc_node() { local svc="$1"; shift; "${COMPOSE[@]}" exec -T "$svc" node -e "$*"; }

section "Every service answers"
wait_for "web (nginx)"          120 curl -fsS "$WEB/healthz"
wait_for "shop API through web" 120 curl -fsS "$WEB/api/v1/products?pageSize=1"
for pair in api:4000 file:4100 report:4200 notification:4300; do
  svc="${pair%%:*}"; port="${pair##*:}"
  wait_for "$svc is ready (and its database answers)" 120 svc_node "$svc" "fetch('http://127.0.0.1:$port/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
done

section "Each service has its own database"
for pair in db:cambo_supply file-db:cambo_files report-db:cambo_reports notification-db:cambo_notifications; do
  c="${pair%%:*}"; d="${pair##*:}"
  if [ "$("${COMPOSE[@]}" exec -T "$c" psql -U cambo -d "$d" -tAc "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null | tr -d '[:space:]')" -gt 0 ] 2>/dev/null; then pass "$c has tables in $d"; else fail "$c has no tables in $d"; fi
done
if "${COMPOSE[@]}" exec -T report-db psql -U cambo -d cambo_reports -tAc 'select 1 from "Order"' >/dev/null 2>&1; then fail "report can see the api's Order table"; else pass "the report database has no copy of the api's tables"; fi

section "Services reach each other, with their secrets"
for t in file:4100 report:4200 notification:4300; do
  wait_for "api -> ${t%%:*} over the private network" 30 svc_node api "fetch('http://$t/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
done
wait_for "notification -> api over the private network" 30 svc_node notification "fetch('http://api:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
svc_node notification "fetch('http://api:4000/internal/telegram/updates',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))" \
  && pass "the api's internal routes refuse calls without the secret" || fail "the api's internal routes are open"

section "A report event and a notification event are accepted"
order_id="5b0f1c4e-6f0d-4d52-9a6e-$(date +%s | awk '{printf "%012d", $1}')"
snapshot="{\"id\":\"$order_id\",\"number\":\"CS-SMOKE-$(date +%s)\",\"status\":\"PENDING\",\"createdAt\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"contactName\":\"Smoke\",\"contactPhone\":\"+85512000000\",\"region\":\"PHNOM_PENH\",\"deliveryService\":\"VET\",\"addressLine\":\"Smoke test\",\"lat\":null,\"lng\":null,\"distanceKm\":null,\"note\":null,\"subtotalCents\":100,\"deliveryFeeCents\":0,\"discountCents\":0,\"totalCents\":100,\"promoCode\":null,\"payment\":{\"method\":\"COD\",\"status\":\"UNPAID\"},\"items\":[{\"productId\":\"8d7a0b3e-3c5a-4e0b-8f6a-0d9a8f1e2b34\",\"name\":\"Smoke item\",\"quantity\":1,\"priceCents\":100,\"lineTotalCents\":100}]}"
event_id() { cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr 'A-Z' 'a-z'; }
post_event() { # service port secret type data
  svc_node "$1" "fetch('http://127.0.0.1:$2/internal/events',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer $3'},body:JSON.stringify({id:'$(event_id)',type:'$4',emittedAt:new Date().toISOString(),data:$5})}).then(async r=>{const b=await r.json();console.log(JSON.stringify(b));process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
}
post_event report 4200 "$REPORT_SECRET" order.snapshot "$snapshot" >/dev/null && pass "report accepted an order snapshot" || fail "report rejected an order snapshot"
today="$(date -u +%Y-%m-%d)"
svc_node report "fetch('http://127.0.0.1:4200/internal/sales/summary?from=$today&to=$today',{headers:{authorization:'Bearer $REPORT_SECRET'}}).then(async r=>{const b=await r.json();process.exit(b.totals&&b.totals.orders>=1?0:1)}).catch(()=>process.exit(1))" \
  && pass "report built its numbers from its own database" || fail "report did not count the snapshot"
post_event notification 4300 "$NOTIFICATION_SECRET" admin.alert '{"text":"Smoke test","adminAlerts":true}' >/dev/null && pass "notification accepted an event" || fail "notification rejected an event"

section "The internal routes and metrics are not public"
if curl -fsS "$WEB/metrics" 2>/dev/null | grep -q process_cpu_seconds_total; then fail "/metrics is reachable through web"; else pass "/metrics is not reachable through web"; fi
if curl -sS -X POST "$WEB/internal/telegram/updates" -H 'content-type: application/json' -d '{}' 2>/dev/null | grep -q '"actions"'; then fail "/internal is reachable through web"; else pass "/internal is not reachable through web"; fi

section "Metrics (Prometheus)"
wait_for "Prometheus is up" 90 curl -fsS "$PROM/-/ready"
for job in api file report notification; do
  wait_for "Prometheus scrapes $job" 90 bash -c "curl -fsS '$PROM/api/v1/query?query=up%7Bjob%3D%22$job%22%7D' | grep -q '\"1\"\\]'"
done
wait_for "request metrics have data" 90 bash -c "curl -fsS '$PROM/api/v1/query?query=http_requests_total' | grep -q '\"status\":\"success\".*\"result\":\\[{'"
wait_for "memory metrics have data"  90 bash -c "curl -fsS '$PROM/api/v1/query?query=process_resident_memory_bytes' | grep -q '\"result\":\\[{'"
if curl -fsS "$PROM/api/v1/query?query=up%7Bjob%3D%22cadvisor%22%7D" 2>/dev/null | grep -q '"1"\]'; then pass "cAdvisor reports container CPU and memory"; else printf '  \033[33mwarn\033[0m cAdvisor is not up (Docker Desktop on macOS can not always run it; fine on Linux)\n'; fi

section "Logs (Loki)"
wait_for "Loki is ready" 90 "${COMPOSE[@]}" exec -T grafana wget -qO- http://loki:3100/ready
# Ask Loki (from inside the Docker network) whether a service has any log lines.
loki_has() { "${COMPOSE[@]}" exec -T grafana wget -qO- "http://loki:3100/loki/api/v1/query_range?query=%7Bservice%3D%22$1%22%7D&limit=1" | grep -q '"values"'; }
for svc in api file report notification; do
  wait_for "$svc logs arrive in Loki" 120 loki_has "$svc"
done
wait_for "log lines carry a level label (error/warn/info can be filtered)" 60 bash -c "$(printf '%q ' "${COMPOSE[@]}") exec -T grafana wget -qO- http://loki:3100/loki/api/v1/label/level/values | grep -q info"

section "Dashboards (Grafana)"
wait_for "Grafana is healthy" 90 curl -fsS "$GRAFANA/api/health"
wait_for "both Cambo Supply dashboards are provisioned" 60 bash -c "[ \"\$(curl -fsS -u '$GRAFANA_AUTH' '$GRAFANA/api/search?query=Cambo' | grep -o '\"uid\":\"cambo-[a-z]*\"' | wc -l)\" -ge 2 ]"
wait_for "Grafana can query Prometheus and Loki" 60 bash -c "curl -fsS -u '$GRAFANA_AUTH' '$GRAFANA/api/datasources' | grep -q prometheus && curl -fsS -u '$GRAFANA_AUTH' '$GRAFANA/api/datasources' | grep -q loki"

printf '\n'
if [ "$fails" -gt 0 ]; then printf '\033[31m%d check(s) failed\033[0m\n' "$fails"; exit 1; fi
printf '\033[32mAll checks passed\033[0m\n'
