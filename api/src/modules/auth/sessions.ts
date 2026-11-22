import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient, User } from '@prisma/client';
import type { PublicUser } from '@cambo/shared';
import type { Response } from 'express';
import type { Config } from '../../config';

export const SESSION_COOKIE = 'cs_session';
const DAY_MS = 24 * 60 * 60 * 1000;

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');

export async function createSession(
  prisma: PrismaClient,
  userId: string,
  meta: { ip?: string; userAgent?: string },
  ttlDays: number,
): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ttlDays * DAY_MS);
  const session = await prisma.session.create({
    data: { userId, tokenHash: sha256(token), ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300), expiresAt },
  });
  return { token, expiresAt, sessionId: session.id };
}

/**
 * Resolve a session token to its user. A customer's expiry slides forward at most once a day.
 * An admin's session never slides: it ends `adminTtlDays` after login, whatever its stored expiry says
 * (so a long session from before the role was given, or before this rule, is cut short too).
 */
export async function getSessionUser(
  prisma: PrismaClient,
  token: string,
  ttlDays: number,
  adminTtlDays: number,
): Promise<{ user: User; sessionId: string; extendedTo?: Date } | null> {
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  const now = Date.now();
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now || session.user.disabledAt) return null;
  if (session.user.role === 'ADMIN') {
    if (session.createdAt.getTime() + adminTtlDays * DAY_MS <= now) return null;
    return { user: session.user, sessionId: session.id };
  }
  if (now - session.extendedAt.getTime() > DAY_MS) {
    const extendedTo = new Date(now + ttlDays * DAY_MS);
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt: extendedTo, extendedAt: new Date(now) } });
    return { user: session.user, sessionId: session.id, extendedTo };
  }
  return { user: session.user, sessionId: session.id };
}

export async function revokeSession(prisma: PrismaClient, sessionId: string) {
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(prisma: PrismaClient, userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

function cookieOptions(config: Config) {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax' as const,
    path: '/',
    domain: config.cookieDomain || undefined,
  };
}

export function setSessionCookie(res: Response, config: Config, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(config), expires: expiresAt });
}

export function clearSessionCookie(res: Response, config: Config) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(config));
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, name: user.name, phone: user.phone, role: user.role, telegramUsername: user.telegramUsername };
}

/** Create a session for `user` and attach the cookie. */
export async function startSession(
  prisma: PrismaClient,
  config: Config,
  res: Response,
  user: User,
  meta: { ip?: string; userAgent?: string },
) {
  const { token, expiresAt, sessionId } = await createSession(
    prisma,
    user.id,
    meta,
    user.role === 'ADMIN' ? config.adminSessionTtlDays : config.sessionTtlDays,
  );
  setSessionCookie(res, config, token, expiresAt);
  return sessionId;
}
