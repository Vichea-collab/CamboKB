#!/bin/sh
# Runs once, when the Postgres of docker-compose.small.yml starts with an empty volume: one server, four databases.
# Each service gets its own database and its own login, and no login can open another service's database. The
# server's admin login (POSTGRES_USER) is used by no service.
set -eu
for v in API_DB_PASSWORD FILE_DB_PASSWORD REPORT_DB_PASSWORD NOTIFICATION_DB_PASSWORD; do
  eval "[ -n \"\${$v:-}\" ]" || { echo "$v is empty: set it in .env.production"; exit 1; }
done

add() { # login, database, password
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -v login="$1" -v db="$2" -v pw="$3" <<'SQL'
CREATE ROLE :"login" LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
SELECT format('CREATE DATABASE %I', :'db') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
ALTER DATABASE :"db" OWNER TO :"login";
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
SQL
}
add cambo_api          cambo_supply        "$API_DB_PASSWORD"
add cambo_file         cambo_files         "$FILE_DB_PASSWORD"
add cambo_report       cambo_reports       "$REPORT_DB_PASSWORD"
add cambo_notification cambo_notifications "$NOTIFICATION_DB_PASSWORD"
# Nor the built-in ones.
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c 'REVOKE ALL ON DATABASE postgres FROM PUBLIC' -c 'REVOKE ALL ON DATABASE template1 FROM PUBLIC'
