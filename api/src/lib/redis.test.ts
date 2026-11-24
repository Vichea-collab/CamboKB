import { afterEach, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { createLogger } from './logger';
import { createRedis, waitUntilReady } from './redis';

describe('waitUntilReady', () => {
  const open: Redis[] = [];
  afterEach(() => {
    for (const r of open.splice(0)) r.disconnect();
  });

  it('gives up with false when Redis is unreachable, within the timeout', async () => {
    const redis = createRedis('redis://127.0.0.1:1', createLogger('silent'));
    open.push(redis);
    const started = Date.now();
    expect(await waitUntilReady(redis, 300)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it.skipIf(!process.env.REDIS_URL_TEST)('resolves true once a reachable Redis is connected', async () => {
    const redis = createRedis(process.env.REDIS_URL_TEST!, createLogger('silent'));
    open.push(redis);
    expect(await waitUntilReady(redis, 3000)).toBe(true);
    expect(await waitUntilReady(redis, 10)).toBe(true); // already ready: no waiting
  });
});
