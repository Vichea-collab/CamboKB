import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Internal routes accept only the caller's shared bearer secret. `fail` builds the service's own 401 error. */
export function requireServiceSecret(secret: string, fail: () => Error): RequestHandler {
  const expected = Buffer.from(`Bearer ${secret}`);
  return (req, _res, next) => {
    const given = Buffer.from(req.get('authorization') ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw fail();
    next();
  };
}
