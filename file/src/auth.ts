import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { FileError } from './errors';

/** Internal routes accept only the api's shared bearer secret. */
export function requireSecret(secret: string): RequestHandler {
  const expected = Buffer.from(`Bearer ${secret}`);
  return (req, _res, next) => {
    const given = Buffer.from(req.get('authorization') ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new FileError(401, 'UNAUTHORIZED', 'Missing or invalid service credentials');
    }
    next();
  };
}
