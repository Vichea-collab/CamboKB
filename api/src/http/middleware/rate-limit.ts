import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import type { AppDeps } from '../app';

const tooMany = (_req: Request, res: Parameters<RequestHandler>[1]) => {
  res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' } });
};

const clientIp = (req: Request) => ipKeyGenerator(req.ip ?? 'unknown');

/**
 * Generic per-IP limiter. Its counters live in Redis when the api has one (so every api instance counts together),
 * otherwise in this process's memory. `name` keeps each limiter's counters apart in Redis; give every limiter its own.
 * If Redis fails, requests are let through (and the failure is logged by the cache) rather than refused.
 */
export function limiter(
  deps: Pick<AppDeps, 'cache'>,
  max: number,
  windowMs: number,
  opts: { name: string; skipSuccessfulRequests?: boolean },
): RequestHandler {
  const redis = deps.cache.redis;
  return rateLimit({
    passOnStoreError: true,
    ...(redis
      ? {
          store: new RedisStore({
            prefix: `rl:${opts.name}:`,
            sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
          }),
        }
      : {}),
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: clientIp,
    handler: tooMany,
    skipSuccessfulRequests: opts.skipSuccessfulRequests ?? false,
  });
}
