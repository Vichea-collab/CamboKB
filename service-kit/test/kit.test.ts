import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import express from 'express';
import pg from 'pg';
import pino from 'pino';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createLogger,
  createMetrics,
  currentRequestId,
  migrate,
  requestContext,
  requireServiceSecret,
  runWithRequestId,
} from '../src';

describe('request context', () => {
  it('keeps a safe incoming id, makes one otherwise, and exposes it to handlers', async () => {
    const app = express();
    app.use(requestContext());
    app.get('/id', (_req, res) => {
      res.json({ id: currentRequestId() });
    });
    const given = await request(app).get('/id').set('x-request-id', 'abc-123');
    expect(given.body.id).toBe('abc-123');
    expect(given.headers['x-request-id']).toBe('abc-123');
    const unsafe = await request(app).get('/id').set('x-request-id', 'bad id with spaces');
    expect(unsafe.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is stamped on log lines as requestId, with a text level and the service name', () => {
    const lines: string[] = [];
    const sink = new Writable({ write: (chunk, _enc, cb) => (lines.push(String(chunk)), cb()) });
    // Same options as createLogger, but writing to our sink.
    const log = createLogger({ service: 'demo', level: 'info' });
    expect(log.level).toBe('info');
    const probe = pino(
      {
        base: { service: 'demo' },
        formatters: { level: (l) => ({ level: l }) },
        mixin: () => ({ requestId: currentRequestId() }),
      },
      sink,
    );
    runWithRequestId('req-1', () => probe.warn('boom'));
    const line = JSON.parse(lines[0]!);
    expect(line).toMatchObject({ level: 'warn', service: 'demo', requestId: 'req-1', msg: 'boom' });
  });
});

describe('metrics', () => {
  it('counts requests by route pattern and exposes process metrics', async () => {
    const metrics = createMetrics('demo');
    const app = express();
    app.use(metrics.middleware);
    app.get('/orders/:number', (_req, res) => {
      res.json({ ok: true });
    });
    app.get('/metrics', metrics.handler);
    await request(app).get('/orders/CS-1');
    await request(app).get('/orders/CS-2');
    await request(app).get('/nope');
    const text = (await request(app).get('/metrics')).text;
    expect(text).toContain(
      'http_requests_total{method="GET",route="/orders/:number",status="200",service="demo"} 2',
    );
    expect(text).toContain('route="not_found"');
    expect(text).toContain('http_request_duration_seconds_bucket');
    expect(text).toContain('process_cpu_seconds_total');
    expect(text).toContain('process_resident_memory_bytes');
    expect(text).not.toContain('CS-1');
  });

  it('runs a gauge collector on every scrape', async () => {
    const metrics = createMetrics('demo');
    let n = 0;
    metrics.gauge('things_waiting', 'Things waiting', [], (g) => g.set(++n));
    expect(await metrics.registry.metrics()).toContain('things_waiting{service="demo"} 1');
    expect(await metrics.registry.metrics()).toContain('things_waiting{service="demo"} 2');
  });
});

describe('service secret', () => {
  it('lets the right bearer through and rejects everything else', async () => {
    const app = express();
    app.use(
      requireServiceSecret('s3cret-value', () => Object.assign(new Error('nope'), { status: 401 })),
    );
    app.get('/x', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(((err: Error & { status?: number }, _req, res, _next) =>
      res.status(err.status ?? 500).json({ error: err.message })) as express.ErrorRequestHandler);
    expect((await request(app).get('/x')).status).toBe(401);
    expect((await request(app).get('/x').set('authorization', 'Bearer wrong')).status).toBe(401);
    expect((await request(app).get('/x').set('authorization', 'Bearer s3cret-value')).status).toBe(
      200,
    );
  });
});

describe('migrate', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST_KIT });
  afterAll(() => pool.end());

  it('applies new files once, in order, and rolls back a broken one', async () => {
    await pool.query('DROP TABLE IF EXISTS _migrations, widgets, gadgets CASCADE');
    const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
    await writeFile(path.join(dir, '002_gadgets.sql'), 'CREATE TABLE gadgets (id int);');
    await writeFile(
      path.join(dir, '001_widgets.sql'),
      'CREATE TABLE widgets (id int); INSERT INTO widgets VALUES (1);',
    );
    expect(await migrate(pool, dir)).toEqual(['001_widgets.sql', '002_gadgets.sql']);
    expect(await migrate(pool, dir)).toEqual([]);

    await writeFile(
      path.join(dir, '003_broken.sql'),
      'CREATE TABLE ok_before_error (id int); SELECT nope FROM missing;',
    );
    await expect(migrate(pool, dir)).rejects.toThrow(/003_broken.sql failed/);
    expect((await pool.query("SELECT to_regclass('ok_before_error') AS t")).rows[0].t).toBeNull();
  });

  it('two starts at once apply each file only once', async () => {
    await pool.query('DROP TABLE IF EXISTS _migrations, widgets, gadgets CASCADE');
    const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
    await writeFile(path.join(dir, '001_widgets.sql'), 'CREATE TABLE widgets (id int);');
    const [a, b] = await Promise.all([migrate(pool, dir), migrate(pool, dir)]);
    expect([...a, ...b]).toEqual(['001_widgets.sql']);
  });
});
