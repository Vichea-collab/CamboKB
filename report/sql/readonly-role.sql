-- Read-only access for the report service. Run once per database as its owner
-- (or a superuser), then point REPORT_DATABASE_URL at the cambo_report_login user:
--
--   psql "$DATABASE_URL" -v password='choose-a-strong-password' -f report/sql/readonly-role.sql
--
-- Safe to re-run.

SELECT 'CREATE ROLE cambo_report NOLOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cambo_report') \gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO cambo_report', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO cambo_report;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cambo_report;
-- Tables created by future migrations are readable too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO cambo_report;

SELECT format('CREATE ROLE cambo_report_login LOGIN PASSWORD %L IN ROLE cambo_report', :'password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cambo_report_login') \gexec
