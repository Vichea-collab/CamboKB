// Copy the live shop's catalog (categories, products, specs, photos, banners) into your LOCAL database,
// so development always runs on the real products. Read-only on the live side; refuses a non-local target.
//
//   npm run db:sync-live
//
// Needs: Docker running with the live stack (docker-compose.prod.yml), the local api database up
// (`docker compose up -d db`) and migrated (`npm run prisma:migrate -w @cambo/api`), and `psql` on the PATH.
// Orders, customers, payments and sessions are NOT copied: they stay on the live shop.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE_DB = process.env.LIVE_DB_CONTAINER ?? 'cambokb-prod-db-1';
const LIVE_FILES = process.env.LIVE_FILE_CONTAINER ?? 'cambokb-prod-file-1';
const LIVE_DB_NAME = 'cambo_supply';
const TABLES = ['Category', 'Product', 'ProductSpec', 'ProductImage', 'Banner'];

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });

function envValue(file, key) {
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`));
  return line
    ?.slice(key.length + 1)
    .trim()
    .replace(/^"|"$/g, '');
}

// 1. The target must be a local database, whatever is in the env file.
const dbUrl = process.env.DATABASE_URL ?? envValue(path.join(root, 'api/.env'), 'DATABASE_URL');
if (!dbUrl) fail('No DATABASE_URL. Create api/.env from api/.env.example.');
const target = new URL(dbUrl);
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname))
  fail(`Refusing to overwrite ${target.hostname}: this only fills a local database.`);

const uploads = path.resolve(
  root,
  'file',
  envValue(path.join(root, 'file/.env'), 'UPLOADS_DIR') ?? './uploads',
);

// 2. Read the live catalog (pg_dump only reads).
console.log(`→ reading the live catalog from ${LIVE_DB}`);
const dump = run('docker', [
  'exec',
  LIVE_DB,
  'sh',
  '-c',
  `pg_dump -U "$POSTGRES_USER" -d ${LIVE_DB_NAME} --data-only --column-inserts --no-owner ${TABLES.map(
    (t) => `-t '"${t}"'`,
  ).join(' ')}`,
]);
if (dump.status !== 0 || !dump.stdout.includes('INSERT INTO'))
  fail(`Could not read the live database (is ${LIVE_DB} running?)\n${dump.stderr.trim()}`);

// 3. Replace the local catalog in one transaction: all or nothing.
console.log(`→ replacing the local catalog in ${target.pathname.slice(1)} on ${target.hostname}`);
const sql = [
  'BEGIN;',
  `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE;`,
  // Newer pg_dump adds \restrict lines that older psql versions reject.
  dump.stdout.replace(/^\\.*$/gm, ''),
  'COMMIT;',
].join('\n');
const load = run('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-q', '-o', '/dev/null'], { input: sql });
if (load.status !== 0)
  fail(
    `Local database not changed.\n${load.stderr.trim()}\nDid you run: npm run prisma:migrate -w @cambo/api ?`,
  );

// 4. Mirror the photos from the live file service into the local uploads folder.
console.log(`→ copying photos from ${LIVE_FILES} into ${path.relative(root, uploads)}`);
rmSync(uploads, { recursive: true, force: true });
mkdirSync(uploads, { recursive: true });
const copy = run('docker', ['cp', `${LIVE_FILES}:/data/uploads/.`, uploads]);
if (copy.status !== 0) fail(`Catalog copied but photos were not: ${copy.stderr.trim()}`);

const count = (t) => run('psql', [dbUrl, '-tAc', `SELECT count(*) FROM "${t}"`]).stdout.trim();
console.log(
  `✓ ${count('Product')} products, ${count('Category')} categories, ${count('ProductImage')} photos, ${count('Banner')} banners. Restart \`npm run dev\` if it was running.`,
);
