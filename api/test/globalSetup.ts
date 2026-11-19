import { execSync } from 'node:child_process';

/** Create the test database if needed and apply migrations to it. */
export default function setup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set');
  // The integration test also needs the report and notification services' own databases.
  for (const u of [
    url,
    process.env.REPORT_DATABASE_URL_TEST,
    process.env.NOTIFICATION_DATABASE_URL_TEST,
  ]) {
    if (!u) continue;
    const dbName = new URL(u).pathname.slice(1);
    const adminUrl = new URL(u);
    adminUrl.pathname = '/postgres';
    try {
      execSync(
        `psql "${adminUrl.toString()}" -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'" | grep -q 1 || psql "${adminUrl.toString()}" -c 'CREATE DATABASE "${dbName}"'`,
        { stdio: 'pipe', shell: '/bin/sh' },
      );
    } catch {
      // CI creates the databases through the Postgres service container.
    }
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}
