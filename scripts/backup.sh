#!/usr/bin/env bash
# Back up all four databases (api, file, report, notification) into backups/<timestamp>/*.sql.gz and delete
# backups older than KEEP_DAYS (default 14). Run it on the server, from cron, e.g. every night at 03:00:
#
#   0 3 * * *  cd /opt/cambo-supply && scripts/backup.sh >> backups/backup.log 2>&1
#
# Copy the folder off the server too (a Droplet's own disk is not a backup): set BACKUP_UPLOAD_CMD to a command that
# receives the new folder as $1, for example with rclone configured for Cloudflare R2 or DigitalOcean Spaces:
#   BACKUP_UPLOAD_CMD='rclone copy "$1" r2:cambo-backups/$(basename "$1")'
#
# Restore one database:  gunzip -c backups/<timestamp>/cambo_supply.sql.gz | docker compose -f docker-compose.prod.yml \
#                          --env-file .env.production exec -T db psql -U "$POSTGRES_USER" -d cambo_supply
# On a small server restore as the service's own login, so it owns its tables: psql -U cambo_api -d cambo_supply
# (cambo_file/cambo_files, cambo_report/cambo_reports, cambo_notification/cambo_notifications).
# The report database can also simply be rebuilt: see the README ("Rebuilding the report database").
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE_CMD="${COMPOSE_CMD:-docker compose -f docker-compose.prod.yml --env-file .env.production}"
if [ -z "${POSTGRES_USER:-}" ]; then
  POSTGRES_USER="$(grep -E '^POSTGRES_USER=' .env.production 2>/dev/null | head -1 | cut -d= -f2- || true)"
  POSTGRES_USER="${POSTGRES_USER:-cambo}"
fi
KEEP_DAYS="${KEEP_DAYS:-14}"
OUT="${BACKUP_DIR:-backups}/$(date -u +%Y-%m-%dT%H%M%SZ)"
mkdir -p "$OUT"

# service:database, as in the Compose files. On a small server (docker-compose.small.yml) one Postgres holds all four.
# shellcheck disable=SC2086
if [ -n "$($COMPOSE_CMD ps -q file-db 2>/dev/null)" ]; then
  PAIRS="db:cambo_supply file-db:cambo_files report-db:cambo_reports notification-db:cambo_notifications"
else
  PAIRS="db:cambo_supply db:cambo_files db:cambo_reports db:cambo_notifications"
fi
for pair in $PAIRS; do
  svc="${pair%%:*}"; name="${pair##*:}"
  echo "backing up $name ($svc)"
  # shellcheck disable=SC2086
  $COMPOSE_CMD exec -T "$svc" pg_dump -U "$POSTGRES_USER" -d "$name" --no-owner --clean --if-exists | gzip > "$OUT/$name.sql.gz"
  gzip -t "$OUT/$name.sql.gz"
  [ "$(gunzip -c "$OUT/$name.sql.gz" | wc -c)" -gt 200 ] || { echo "backup of $name looks empty"; exit 1; }
done
echo "backup written to $OUT"

if [ -n "${BACKUP_UPLOAD_CMD:-}" ]; then
  echo "uploading"
  bash -c "$BACKUP_UPLOAD_CMD" _ "$OUT"
fi

find "$(dirname "$OUT")" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true
