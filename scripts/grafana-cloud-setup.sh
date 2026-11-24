#!/usr/bin/env bash
# Asks for the Grafana Cloud connection details, checks that they work, and saves them in .env.grafana (git-ignored,
# readable only by you). Run it in a terminal; the token is not shown while you paste it. Nothing is sent except the
# two checks to Grafana.
set -euo pipefail
cd "$(dirname "$0")/.."
git check-ignore -q .env.grafana || { echo ".env.grafana is not git-ignored, stopping"; exit 1; }

trim() { printf '%s' "$1" | tr -d '[:space:]"'; }
read -rp  'Prometheus remote write URL: ' PROM_URL;  PROM_URL=$(trim "$PROM_URL")
read -rp  'Prometheus username (a number): ' PROM_USER; PROM_USER=$(trim "$PROM_USER")
read -rp  'Loki URL: ' LOKI_URL;                     LOKI_URL=$(trim "$LOKI_URL")
read -rp  'Loki user (a number): ' LOKI_USER;        LOKI_USER=$(trim "$LOKI_USER")
read -rsp 'Token (hidden, paste and press Enter): ' TOKEN; TOKEN=$(trim "$TOKEN"); echo

case "$PROM_URL" in https://*/api/prom/push) ;; https://*/api/prom) PROM_URL="$PROM_URL/push" ;; https://*) PROM_URL="${PROM_URL%/}/api/prom/push" ;; *) echo "The Prometheus URL must start with https://"; exit 1 ;; esac
case "$LOKI_URL" in https://*/loki/api/v1/push) ;; https://*) LOKI_URL="${LOKI_URL%/}/loki/api/v1/push" ;; *) echo "The Loki URL must start with https://"; exit 1 ;; esac
for n in "$PROM_USER" "$LOKI_USER"; do case "$n" in ''|*[!0-9]*) echo "The usernames must be numbers"; exit 1 ;; esac; done
[ -n "$TOKEN" ] || { echo "The token is empty"; exit 1; }

# An empty message: a wrong login answers 401 or 403, a right one answers anything else. Credentials go in through
# standard input so they are not visible in the process list.
check() { # name, url, user, content type, body
  local code
  code=$(printf 'user = "%s:%s"\n' "$3" "$TOKEN" | curl -sS -K - -o /dev/null -w '%{http_code}' --max-time 20 -X POST -H "content-type: $4" --data-binary "$5" "$2") || { echo "$1: cannot reach the address"; return 1; }
  case "$code" in
    401|403) echo "$1: login refused ($code). Check the number and the token's permissions."; return 1 ;;
    404|5??) echo "$1: unexpected answer ($code). Check the URL."; return 1 ;;
    *) echo "$1: OK" ;;
  esac
}
ok=1
check "Metrics (Prometheus)" "$PROM_URL" "$PROM_USER" application/x-protobuf '' || ok=0
check "Logs (Loki)" "$LOKI_URL" "$LOKI_USER" application/json '{"streams":[]}' || ok=0
[ $ok = 1 ] || { echo "Nothing saved. Fix the line above and run this again."; exit 1; }

umask 077
cat > .env.grafana <<OUT
GRAFANA_CLOUD_LOKI_URL=$LOKI_URL
GRAFANA_CLOUD_LOKI_USER=$LOKI_USER
GRAFANA_CLOUD_PROM_URL=$PROM_URL
GRAFANA_CLOUD_PROM_USER=$PROM_USER
GRAFANA_CLOUD_TOKEN=$TOKEN
OUT
chmod 600 .env.grafana
echo "Saved to .env.grafana. Both checks passed."
