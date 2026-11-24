import { createMetrics, type Metrics } from '@cambo/service-kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCache, MemoryCacheStore, type CacheStore } from './cache';
import { createLogger } from './logger';

/** A store whose every call fails, like a Redis that is down. */
class FailingStore implements CacheStore {
  async get(): Promise<string | null> {
    throw new Error('redis down');
  }
  async set(): Promise<void> {
    throw new Error('redis down');
  }
  async incr(): Promise<number> {
    throw new Error('redis down');
  }
}

const count = async (metrics: Metrics, result: 'hit' | 'miss' | 'error'): Promise<number> => {
  const text = await metrics.registry.metrics();
  const m = text.match(new RegExp(`cache_requests_total\\{[^}]*result="${result}"[^}]*\\}\\s+(\\d+)`));
  return m ? Number(m[1]) : 0;
};

describe('cache', () => {
  let clock: number;
  let store: MemoryCacheStore;
  let metrics: Metrics;
  const make = (s: CacheStore | null = store) =>
    createCache({ store: s, metrics, logger: createLogger('silent') });
  const counter = () => {
    let calls = 0;
    return { loader: async () => ({ n: ++calls }), calls: () => calls };
  };

  beforeEach(() => {
    clock = 1_000_000;
    store = new MemoryCacheStore(() => clock);
    metrics = createMetrics('api');
  });

  it('serves the second call from the store', async () => {
    const cache = make();
    const c = counter();
    const a = await cache.cached('catalog', 'products:a', c.loader);
    const b = await cache.cached('catalog', 'products:a', c.loader);
    expect(c.calls()).toBe(1);
    expect(b).toEqual(a);
    expect(cache.enabled).toBe(true);
  });

  it('different keys do not collide', async () => {
    const cache = make();
    const a = await cache.cached('catalog', 'products:a', async () => 'A');
    const b = await cache.cached('catalog', 'products:b', async () => 'B');
    expect([a, b]).toEqual(['A', 'B']);
    expect(await cache.cached('catalog', 'products:a', async () => 'changed')).toBe('A');
  });

  it('invalidate makes the next call run the loader again', async () => {
    const cache = make();
    const c = counter();
    await cache.cached('catalog', 'k', c.loader);
    await cache.invalidate('catalog');
    const after = await cache.cached('catalog', 'k', c.loader);
    expect(c.calls()).toBe(2);
    expect(after).toEqual({ n: 2 });
  });

  it('entries expire after the ttl', async () => {
    const cache = make();
    const c = counter();
    await cache.cached('catalog', 'k', c.loader);
    clock += 29_000;
    await cache.cached('catalog', 'k', c.loader);
    expect(c.calls()).toBe(1);
    clock += 2_000;
    await cache.cached('catalog', 'k', c.loader);
    expect(c.calls()).toBe(2);
  });

  it('a version key lost from the store never serves entries older than the ttl', async () => {
    const cache = make();
    const c = counter();
    await cache.cached('catalog', 'k', c.loader);
    await cache.invalidate('catalog');
    await cache.cached('catalog', 'k', c.loader); // cached again under version 1
    store.delete('cache:catalog:version'); // Redis evicted it under memory pressure
    clock += 31_000;
    await cache.cached('catalog', 'k', c.loader);
    expect(c.calls()).toBe(3);
  });

  it('a failing store falls back to the loader and never throws', async () => {
    const cache = make(new FailingStore());
    const c = counter();
    expect(await cache.cached('catalog', 'k', c.loader)).toEqual({ n: 1 });
    expect(await cache.cached('catalog', 'k', c.loader)).toEqual({ n: 2 });
    expect(await count(metrics, 'error')).toBeGreaterThanOrEqual(2);
  });

  it('invalidate never throws when the store fails', async () => {
    await expect(make(new FailingStore()).invalidate('catalog')).resolves.toBeUndefined();
  });

  it('a loader error is rethrown and not cached', async () => {
    const cache = make();
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new Error('database hiccup');
      return 'ok';
    };
    await expect(cache.cached('catalog', 'k', flaky)).rejects.toThrow('database hiccup');
    expect(await cache.cached('catalog', 'k', flaky)).toBe('ok');
    expect(calls).toBe(2);
  });

  it('with a null store it just runs the loader and enabled is false', async () => {
    const cache = make(null);
    const c = counter();
    await cache.cached('catalog', 'k', c.loader);
    await cache.cached('catalog', 'k', c.loader);
    expect(c.calls()).toBe(2);
    expect(cache.enabled).toBe(false);
    expect(cache.redis).toBeNull();
    await expect(cache.invalidate('catalog')).resolves.toBeUndefined();
  });

  it('counts hit, miss and error', async () => {
    const cache = make();
    await cache.cached('catalog', 'k', async () => 1); // miss
    await cache.cached('catalog', 'k', async () => 1); // hit
    await cache.cached('catalog', 'k', async () => 1); // hit
    const failing = createMetrics('api');
    await createCache({ store: new FailingStore(), metrics: failing, logger: createLogger('silent') }).cached('catalog', 'k', async () => 1);
    expect(await count(failing, 'error')).toBe(1);
    expect(await count(metrics, 'miss')).toBe(1);
    expect(await count(metrics, 'hit')).toBe(2);
    expect(await count(metrics, 'error')).toBe(0);
  });
});
