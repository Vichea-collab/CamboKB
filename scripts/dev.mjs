// Runs every service's dev script in parallel with prefixed output. Ctrl+C stops all.
// Each service has its own database: the extra ones are created first if your Postgres is reachable.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/** Create a database named in `service/.env` if it does not exist yet (needs `psql` on the PATH). */
function ensureDatabase(service, key) {
  const file = `${service}/.env`;
  if (!existsSync(file)) return;
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`));
  const url = line
    ?.slice(key.length + 1)
    .trim()
    .replace(/^"|"$/g, '');
  if (!url) return;
  const name = new URL(url).pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const exists = spawnSync(
    'psql',
    [admin.toString(), '-tAc', `SELECT 1 FROM pg_database WHERE datname='${name}'`],
    { encoding: 'utf8' },
  );
  if (exists.error || exists.status !== 0) return; // no psql or no server: the service will say what is wrong
  if (!exists.stdout.includes('1')) {
    const made = spawnSync('psql', [admin.toString(), '-c', `CREATE DATABASE "${name}"`], {
      encoding: 'utf8',
    });
    console.log(
      made.status === 0
        ? `created database ${name}`
        : `could not create database ${name}: ${made.stderr.trim()}`,
    );
  }
}
ensureDatabase('file', 'FILE_DATABASE_URL');
ensureDatabase('report', 'REPORT_DATABASE_URL');
ensureDatabase('notification', 'NOTIFICATION_DATABASE_URL');

const services = ['file', 'report', 'notification', 'api', 'web'].filter((s) =>
  existsSync(`${s}/package.json`),
);
const colors = { file: 35, report: 36, notification: 34, api: 33, web: 32 };
const children = services.map((s) => {
  const child = spawn('npm', ['run', 'dev', '--workspace', s], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = `\x1b[${colors[s]}m[${s}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (d) => out.write(d.toString().replace(/^(?=.)/gm, prefix)));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
});
const stop = () => children.forEach((c) => c.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
