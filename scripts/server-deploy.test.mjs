// Runs scripts/server-deploy.sh in a temporary folder with stand-ins for docker, curl and flock, so every way it can go
// wrong is tried without a server.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./server-deploy.sh', import.meta.url));
const SHA = 'a'.repeat(7) + 'b'.repeat(33);
const NEW = 'sha-aaaaaaa';
const OLD = 'sha-0000000';
let dir, app;

const put = (path, text, mode) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  if (mode) chmodSync(path, mode);
};
const FILES = ['docker-compose.prod.yml', 'docker-compose.small.yml', 'docker/postgres/service-databases.sh', 'observability/alloy/cloud.alloy', 'scripts/backup.sh'];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cambo-deploy-'));
  app = join(dir, 'app');
  for (const f of FILES) {
    put(join(app, f), `old ${f}\n`);
    put(join(dir, 'src/repo', f), `new ${f}\n`);
  }
  put(join(app, 'scripts/backup.sh'), '#!/bin/sh\necho backup >> "$LOG"\n[ ! -e "$FAIL/backup" ]\n', 0o755);
  put(join(app, '.env.production'), `POSTGRES_PASSWORD=keep=me$x\nIMAGE_TAG=${OLD}\nPUBLIC_ORIGIN=https://shop.example\n`, 0o600);
  mkdirSync(join(dir, 'fail'));
  const tar = spawnSync('tar', ['-czf', join(dir, 'src.tar.gz'), '-C', join(dir, 'src'), 'repo']);
  assert.equal(tar.status, 0);

  put(join(dir, 'bin/flock'), '#!/bin/sh\nexit 0\n', 0o755);
  put(
    join(dir, 'bin/curl'),
    `#!/bin/sh
echo "curl $*" >> "$LOG"
case "$*" in
  *api.github.com*) [ -e "$FAIL/not-main" ] && s=diverged || s=ahead; printf '{\\n  "status": "%s",\\n}\\n' "$s" ;;
  *codeload*) while [ "$1" != -o ]; do shift; done; cp "${dir}/src.tar.gz" "$2" ;;
  *shop.example*) [ ! -e "$FAIL/public-$(sed -n 's/^IMAGE_TAG=//p' "$CAMBO_APP/.env.production")" ] ;;
esac
`,
    0o755,
  );
  put(
    join(dir, 'bin/docker'),
    `#!/bin/sh
echo "docker[$IMAGE_TAG] $*" >> "$LOG"
fails() { [ -e "$FAIL/$1" ] || [ -e "$FAIL/$1-$IMAGE_TAG" ]; }
case "$*" in
  *" config -q"*) fails config && exit 1; exit 0 ;;
  *" pull -q"*) fails pull && exit 1; exit 0 ;;
  *" up -d"*) fails up && exit 1; exit 0 ;;
  *"post-data"*) fails telegram && echo "  HTTP/1.1 502 Bad Gateway" || echo "  HTTP/1.1 401 Unauthorized"; exit 1 ;;
  *"wget -S"*/files/*) fails photo && echo "  HTTP/1.1 502 Bad Gateway" || echo "  HTTP/1.1 200 OK" ;;
  *readyz*) fails ready && exit 1; echo ok ;;
  *api/v1/products*) echo '{"items":[{"image":"https://shop.example/files/products/a.webp"}]}' ;;
  *"http://web/"*) fails home && echo nothing || echo '<div id="root"></div>' ;;
  "images "*) echo "ghcr.io/x/cambokb-api:${NEW}"; echo "ghcr.io/x/cambokb-api:${OLD}"; echo "ghcr.io/x/cambokb-api:sha-1111111"; echo "postgres:17" ;;
esac
exit 0
`,
    0o755,
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const fail = (...names) => names.forEach((n) => put(join(dir, 'fail', n), ''));
const run = (request = `deploy ${SHA}`, viaArgs = false) => {
  const r = spawnSync('bash', viaArgs ? [SCRIPT, ...request.split(' ')] : [SCRIPT], {
    encoding: 'utf8',
    env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, HOME: dir, LOG: join(dir, 'log'), FAIL: join(dir, 'fail'), CAMBO_APP: app, ...(viaArgs ? {} : { SSH_ORIGINAL_COMMAND: request }) },
  });
  return { ...r, log: existsSync(join(dir, 'log')) ? readFileSync(join(dir, 'log'), 'utf8') : '' };
};
const tag = () => readFileSync(join(app, '.env.production'), 'utf8').match(/^IMAGE_TAG=(.*)$/m)[1];
const file = (f) => readFileSync(join(app, f), 'utf8');
const untouched = () => {
  assert.equal(tag(), OLD);
  assert.equal(file('docker-compose.prod.yml'), 'old docker-compose.prod.yml\n');
};

test('deploys the commit: files, tag and images, after a backup', () => {
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK: the shop runs sha-aaaaaaa \(was sha-0000000\)/);
  assert.equal(tag(), NEW);
  for (const f of FILES.slice(0, 4)) assert.equal(file(f), `new ${f}\n`);
  assert.ok(r.log.indexOf('backup') < r.log.indexOf(' up -d'), 'the backup comes first');
  assert.ok(r.log.indexOf('pull -q') < r.log.indexOf('backup'));
});

test('changes nothing else in the settings, and keeps them private', () => {
  run();
  assert.match(file('.env.production'), /^POSTGRES_PASSWORD=keep=me\$x$/m);
  assert.equal(statSync(join(app, '.env.production')).mode & 0o777, 0o600);
});

test('restarts the log shipper when its configuration changed', () => {
  assert.match(run().log, /restart alloy/);
});

test('removes old images but keeps this version and the one before', () => {
  const rmi = run().log.split('\n').find((l) => l.includes(' rmi ')) ?? '';
  assert.match(rmi, /sha-1111111/);
  assert.doesNotMatch(rmi, /sha-aaaaaaa|sha-0000000|postgres/);
});

for (const bad of ['', 'bash', 'deploy', 'deploy main', `deploy ${SHA}; rm -rf /`, `deploy ${SHA} extra`, `deploy ${SHA.toUpperCase()}`, `deploy ../${SHA}`, `deploy ${SHA}\nid`, 'cat /opt/cambo-supply/.env.production'])
  test(`refuses anything but a commit: ${JSON.stringify(bad).slice(0, 40)}`, () => {
    const r = run(bad);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /only "deploy <commit>" is allowed/);
    assert.equal(r.log, '', 'nothing was run');
    untouched();
  });

test('an SSH request is what counts, not arguments', () => {
  const r = spawnSync('bash', [SCRIPT, 'deploy', SHA], { encoding: 'utf8', env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, LOG: join(dir, 'log'), FAIL: join(dir, 'fail'), CAMBO_APP: app, SSH_ORIGINAL_COMMAND: 'id' } });
  assert.equal(r.status, 1);
  untouched();
});

test('can be run by hand on the server', () => {
  assert.equal(run(`deploy ${SHA}`, true).status, 0);
  assert.equal(tag(), NEW);
});

for (const [what, flag] of [['a commit that is not part of main (a fork)', 'not-main'], ['invalid Compose files', 'config'], ['images that cannot be pulled', 'pull'], ['a failed backup', 'backup']])
  test(`stops before touching anything: ${what}`, () => {
    fail(flag);
    const r = run();
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.log, / up -d/);
    untouched();
  });

for (const [what, flag] of [['the services do not become healthy', `up-${NEW}`], ['the home page fails', `home-${NEW}`], ['a photo does not load', `photo-${NEW}`], ['a service is not ready', `ready-${NEW}`], ['the Telegram route is broken', `telegram-${NEW}`], ['the public address does not answer', `public-${NEW}`]])
  test(`goes back by itself when ${what}`, () => {
    fail(flag);
    const r = run();
    assert.equal(r.status, 1, 'the run is still a failure, so the team is told');
    assert.match(r.stdout, /the shop is back on sha-0000000/);
    untouched();
    assert.match(r.log, /docker\[sha-0000000\].* up -d/);
  });

test('the log shipper gets its old configuration back as well', () => {
  fail(`home-${NEW}`);
  const restarts = run().log.split('\n').filter((l) => l.includes('restart alloy'));
  assert.deepEqual(restarts.map((l) => l.slice(0, 19)), ['docker[sha-aaaaaaa]', 'docker[sha-0000000]']);
  assert.equal(file('observability/alloy/cloud.alloy'), 'old observability/alloy/cloud.alloy\n');
});

test('says so when going back does not work either', () => {
  fail('up');
  const r = run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /going back to sha-0000000 did not work: log in to the server/);
});
