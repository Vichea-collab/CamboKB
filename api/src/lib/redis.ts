import { Redis } from 'ioredis';
import type { Logger } from './logger';

/** How often a dead Redis may be logged, so an outage does not flood the logs. */
const WARN_EVERY_MS = 30_000;

/**
 * A Redis client that fails fast: a request that needs Redis while it is down costs about 100 ms, not a hang.
 * The cache and the rate limiter treat every error as "Redis is not available right now" and carry on without it.
 */
export function createRedis(url: string, logger: Logger): Redis {
  const redis = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 100,
    connectTimeout: 1_000,
    // Keep reconnecting in the background, but not in a tight loop.
    retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
    lazyConnect: false,
  });
  let lastWarn = 0;
  redis.on('error', (err: Error) => {
    const now = Date.now();
    if (now - lastWarn < WARN_EVERY_MS) return;
    lastWarn = now;
    logger.warn({ err: err.message }, 'Redis is not available; the shop carries on without the cache');
  });
  redis.on('ready', () => {
    if (lastWarn) logger.info('Redis is available again');
    lastWarn = 0;
  });
  return redis;
}
