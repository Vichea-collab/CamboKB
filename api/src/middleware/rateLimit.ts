import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { normalizePhone } from '@cambo/shared';
import type { Config } from '../config';

const tooMany = (_req: Request, res: Parameters<RequestHandler>[1]) => {
  res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' } });
};

const clientIp = (req: Request) => ipKeyGenerator(req.ip ?? 'unknown');

/** Generic per-IP limiter. In-memory store: fine for one API instance; use a shared store when scaling out. */
export function limiter(max: number, windowMs: number, opts: { skipSuccessfulRequests?: boolean } = {}): RequestHandler {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: clientIp,
    handler: tooMany,
    skipSuccessfulRequests: opts.skipSuccessfulRequests ?? false,
  });
}

/** Failed logins per IP + phone; successful logins don't count. */
export function loginLimiter(config: Config): RequestHandler {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.loginMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      const phone = typeof req.body?.phone === 'string' ? normalizePhone(req.body.phone) ?? 'invalid' : 'none';
      return `${clientIp(req)}|${phone}`;
    },
    handler: tooMany,
  });
}
