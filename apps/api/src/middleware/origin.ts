import type { RequestHandler } from 'express';
import { AppError } from '../errors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT = ['/api/v1/telegram/webhook'];

/** CSRF defence in depth (on top of SameSite=Lax): state-changing requests must come from the web app. */
export function originCheck(allowed: string[]): RequestHandler {
  const allowSet = new Set(allowed);
  return (req, _res, next) => {
    if (SAFE.has(req.method) || EXEMPT.includes(req.path)) return next();
    let origin = req.get('origin');
    if (!origin) {
      const referer = req.get('referer');
      try {
        origin = referer ? new URL(referer).origin : undefined;
      } catch {
        origin = undefined;
      }
    }
    if (!origin || !allowSet.has(origin)) throw new AppError(403, 'BAD_ORIGIN', 'Request origin not allowed');
    next();
  };
}
