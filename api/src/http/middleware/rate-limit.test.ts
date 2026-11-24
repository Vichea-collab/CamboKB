import { createMetrics } from '@cambo/service-kit';
import express from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCache, RedisCacheStore } from '../../lib/cache';
import { createLogger } from '../../lib/logger';
import { createRedis } from '../../lib/redis';
import { limiter } from './rate-limit';

const logger = createLogger('silent');
const noRedis = () => ({ cache: createCache({ store: null, metrics: createMetrics('api'), logger }) });
const withRedis = (url: string) => {
  const redis = createRedis(url, logger);
  return { redis, deps: { cache: createCache({ store: new RedisCacheStore(redis), redis, metrics: createMetrics('api'), logger }) } };
};
/** Resolves when the client is connected (it has no offline queue, so commands sent earlier are refused). */
const ready = (redis: Redis) =>
  redis.status === 'ready' ? Promise.resolve() : new Promise<void>((resolve) => redis.once('ready', () => resolve()));
/** A tiny app with one route allowed 3 requests a minute. */
const appWith = (deps: Parameters<typeof limiter>[0], name = 'test') => {
  const app = express();
  app.get('/x', limiter(deps, 3, 60_000, { name }), (_req, res) => res.json({ ok: true }));
  return app;
};

describe('rate limiter', () => {
  const open: Redis[] = [];
  afterEach(() => {
    for (const r of open.splice(0)) r.disconnect();
  });

  it('without Redis the 4th request in the window is 429 with code RATE_LIMITED', async () => {
    const app = appWith(noRedis());
    for (let i = 0; i < 3; i++) expect((await request(app).get('/x')).status).toBe(200);
    const res = await request(app).get('/x');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('with an unreachable Redis requests still pass and never return 500', async () => {
    const { redis, deps } = withRedis('redis://127.0.0.1:1');
    open.push(redis);
    const app = appWith(deps);
    for (let i = 0; i < 6; i++) expect((await request(app).get('/x')).status).toBe(200);
  });

  it('two limiters with different names do not share a count', async () => {
    const deps = noRedis();
    const app = express();
    app.get('/a', limiter(deps, 1, 60_000, { name: 'a' }), (_q, res) => res.json({ ok: true }));
    app.get('/b', limiter(deps, 1, 60_000, { name: 'b' }), (_q, res) => res.json({ ok: true }));
    expect((await request(app).get('/a')).status).toBe(200);
    expect((await request(app).get('/b')).status).toBe(200);
    expect((await request(app).get('/a')).status).toBe(429);
  });

  describe.skipIf(!process.env.REDIS_URL_TEST)('with a real Redis (REDIS_URL_TEST)', () => {
    let a: ReturnType<typeof withRedis>;
    let b: ReturnType<typeof withRedis>;
    beforeEach(async () => {
      a = withRedis(process.env.REDIS_URL_TEST!);
      b = withRedis(process.env.REDIS_URL_TEST!);
      open.push(a.redis, b.redis);
      await Promise.all([ready(a.redis), ready(b.redis)]);
      await a.redis.flushdb();
    });

    it('two api instances sharing one Redis count together', async () => {
      const appA = appWith(a.deps);
      const appB = appWith(b.deps);
      expect((await request(appA).get('/x')).status).toBe(200);
      expect((await request(appA).get('/x')).status).toBe(200);
      expect((await request(appB).get('/x')).status).toBe(200);
      expect((await request(appB).get('/x')).status).toBe(429);
    });

    it('limiters with different names keep separate counts in Redis', async () => {
      const appX = appWith(a.deps, 'x');
      const appY = appWith(b.deps, 'y');
      for (let i = 0; i < 3; i++) expect((await request(appX).get('/x')).status).toBe(200);
      expect((await request(appX).get('/x')).status).toBe(429);
      expect((await request(appY).get('/x')).status).toBe(200);
    });
  });
});
