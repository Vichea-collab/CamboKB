import type { Metrics } from '@cambo/service-kit';
import type { Redis } from 'ioredis';
import type { Logger } from './logger';

/** The three calls the cache needs from a store. Redis in production, memory in tests. */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  incr(key: string): Promise<number>;
}

export class RedisCacheStore implements CacheStore {
  constructor(private readonly redis: Redis) {}
  get(key: string) {
    return this.redis.get(key);
  }
  async set(key: string, value: string, ttlSeconds: number) {
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }
  incr(key: string) {
    return this.redis.incr(key);
  }
}

/** A store in this process's memory, with a clock you can move. For tests. */
export class MemoryCacheStore implements CacheStore {
  private readonly data = new Map<string, { value: string; expiresAt: number | null }>();
  constructor(private readonly now: () => number = Date.now) {}

  async get(key: string) {
    const e = this.data.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt <= this.now()) {
      this.data.delete(key);
      return null;
    }
    return e.value;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    this.data.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
  }
  async incr(key: string) {
    const next = Number((await this.get(key)) ?? 0) + 1;
    this.data.set(key, { value: String(next), expiresAt: null });
    return next;
  }
  delete(key: string) {
    this.data.delete(key);
  }
}

export type CacheScope = 'catalog';

export type Cache = {
  /** False when there is no store: every call just runs its loader. */
  enabled: boolean;
  /** The Redis client behind the store, for the rate limiter; null when there is none. */
  redis: Redis | null;
  /**
   * The cached value for `key`, or the result of `loader` (which is then stored for the ttl). Never throws because of
   * the store: if it fails, the loader's result is returned. A loader error is passed on and not stored.
   */
  cached<T>(scope: CacheScope, key: string, loader: () => Promise<T>): Promise<T>;
  /** Makes everything cached so far in the scope unreachable. Never throws. */
  invalidate(scope: CacheScope): Promise<void>;
};

const DEFAULT_TTL_SECONDS = 30;
/** How often a store failure may be logged. */
const WARN_EVERY_MS = 30_000;

/**
 * Cache-aside over a store. Keys carry the scope's version (`cache:<scope>:v<version>:<key>`); `invalidate` bumps the
 * version, so nothing has to be scanned or deleted and old entries just expire. If the store loses the version key
 * (Redis evicting under memory pressure) it reads as 0 again, so an old entry can be served, but never for longer
 * than its ttl.
 */
export function createCache(opts: {
  store: CacheStore | null;
  redis?: Redis | null;
  ttlSeconds?: number;
  metrics: Metrics;
  logger: Logger;
}): Cache {
  const { store, metrics, logger } = opts;
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const requests = metrics.counter('cache_requests_total', 'Cache lookups by outcome', [
    'cache',
    'result',
  ] as const);
  const count = (scope: CacheScope, result: 'hit' | 'miss' | 'error') =>
    requests.inc({ cache: scope, result });
  let lastWarn = 0;
  const failed = (scope: CacheScope, err: unknown) => {
    count(scope, 'error');
    const now = Date.now();
    if (now - lastWarn < WARN_EVERY_MS) return;
    lastWarn = now;
    logger.warn({ err: err instanceof Error ? err.message : String(err), scope }, 'cache store failed; going without it');
  };
  const versionKey = (scope: CacheScope) => `cache:${scope}:version`;

  return {
    enabled: store !== null,
    redis: opts.redis ?? null,

    async cached<T>(scope: CacheScope, key: string, loader: () => Promise<T>): Promise<T> {
      if (!store) return loader();
      let dataKey: string;
      try {
        const version = (await store.get(versionKey(scope))) ?? '0';
        dataKey = `cache:${scope}:v${version}:${key}`;
        const hit = await store.get(dataKey);
        if (hit !== null) {
          count(scope, 'hit');
          return JSON.parse(hit) as T;
        }
      } catch (err) {
        failed(scope, err);
        return loader();
      }
      count(scope, 'miss');
      const value = await loader();
      try {
        await store.set(dataKey, JSON.stringify(value), ttl);
      } catch (err) {
        failed(scope, err);
      }
      return value;
    },

    async invalidate(scope: CacheScope): Promise<void> {
      if (!store) return;
      try {
        await store.incr(versionKey(scope));
      } catch (err) {
        failed(scope, err);
      }
    },
  };
}
