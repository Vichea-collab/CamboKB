import { execSync } from 'node:child_process';

/** Create the scratch database the migration test uses. */
export default function setup() {
  const url = process.env.DATABASE_URL_TEST_KIT!;
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
}
