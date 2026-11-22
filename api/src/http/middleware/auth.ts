import type { Role } from '@prisma/client';
import type { RequestHandler } from 'express';
import type { AppDeps } from '../app';
import { getSessionUser, SESSION_COOKIE, setSessionCookie } from '../../modules/auth/sessions';
import { AppError } from '../errors';

export function loadUser({ prisma, config }: AppDeps): RequestHandler {
  return async (req, res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token.length > 0 && token.length < 200) {
      const found = await getSessionUser(prisma, token, config.sessionTtlDays, config.adminSessionTtlDays);
      if (found) {
        req.user = found.user;
        req.sessionId = found.sessionId;
        if (found.extendedTo) setSessionCookie(res, config, token, found.extendedTo);
      }
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
  next();
};

export function requireRole(role: Role): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
    if (req.user.role !== role) throw new AppError(403, 'FORBIDDEN', 'You do not have access');
    next();
  };
}
