import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { ReportError } from './errors';

export function requireSecret(secret: string): RequestHandler {
  const expected = Buffer.from(`Bearer ${secret}`);
  return (req, _res, next) => {
    const given = Buffer.from(req.get('authorization') ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new ReportError(401, 'UNAUTHORIZED', 'Missing or invalid service credentials');
    }
    next();
  };
}
