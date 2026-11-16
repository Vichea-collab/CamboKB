import { execSync } from 'node:child_process';

/** The report service reads the api's schema: create the test DB if needed and migrate it. */
export default function setup() {
  const url = process.env.DATABASE_URL_TEST!;
  const dbName = new URL(url).pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  try {
    execSync(
      `psql "${adminUrl}" -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'" | grep -q 1 || psql "${adminUrl}" -c 'CREATE DATABASE "${dbName}"'`,
      { stdio: 'pipe', shell: '/bin/sh' },
    );
  } catch {
    // CI provides the database.
  }
  execSync('npx prisma migrate deploy --schema ../api/prisma/schema.prisma', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}
