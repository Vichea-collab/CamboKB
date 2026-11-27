#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

run_dir=$(mktemp -d)
project="cambo-ci-$(basename "$run_dir" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"
checks=(docker compose -p "${project}-checks" -f jenkins/checks.compose.yml)
export COMPOSE_PROJECT_NAME="${project}-smoke"
export COMPOSE_FILE="docker-compose.yml:jenkins/smoke.compose.yml"
export WEB_PORT="${JENKINS_SMOKE_WEB_PORT:-18080}" DB_PORT="${JENKINS_SMOKE_DB_PORT:-15432}"
export GRAFANA_PORT="${JENKINS_SMOKE_GRAFANA_PORT:-13001}" PROMETHEUS_PORT="${JENKINS_SMOKE_PROMETHEUS_PORT:-19090}"
export TELEGRAM_MODE=off TELEGRAM_BOT_TOKEN='' TELEGRAM_ADMIN_CHAT_ID='' TELEGRAM_BOT_USERNAME=''
smoke=(docker compose --profile observability)

cleanup() {
  local status=$?
  if (( status != 0 )); then
    "${checks[@]}" logs --no-color --tail 50 || true
    "${smoke[@]}" logs --no-color --tail 100 || true
  fi
  "${smoke[@]}" down -v || true
  "${checks[@]}" down -v || true
  rmdir "$run_dir"
}
trap cleanup EXIT

"${checks[@]}" up -d --wait --wait-timeout 90
pg_address=$("${checks[@]}" port postgres 5432)
redis_address=$("${checks[@]}" port redis 6379)
test_db="postgresql://postgres:postgres@$pg_address"
export DATABASE_URL_TEST="$test_db/cambo_supply_test"
export DATABASE_URL_TEST_KIT="$test_db/cambo_kit_test"
export FILE_DATABASE_URL_TEST="$test_db/cambo_file_test"
export REPORT_DATABASE_URL_TEST="$test_db/cambo_report_test"
export NOTIFICATION_DATABASE_URL_TEST="$test_db/cambo_notification_test"
export REDIS_URL_TEST="redis://$redis_address/1"

npm ci
npx prisma generate --schema api/prisma/schema.prisma
npm run lint
npm run typecheck
npm test
npm run build
"${checks[@]}" down -v

"${smoke[@]}" up -d --build --wait --wait-timeout 600
scripts/smoke.sh
