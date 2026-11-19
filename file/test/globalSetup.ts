import { execSync } from 'node:child_process';

/** Create the file service's test database if needed. The tests migrate it themselves. */
export default function setup() {
  const url = process.env.FILE_DATABASE_URL_TEST!;
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
