import { randomInt } from 'node:crypto';
import type { Prisma, TelegramAuthPurpose, TelegramAuthRequest } from '@prisma/client';
import { maskPhone, normalizePhone } from '@cambo/shared';
import type { Request } from 'express';
import type { AppDeps } from '../../http/app';
import { AppError } from '../../http/errors';
import type { TgUser } from '../../integrations/telegram/types';
import { randomToken, sha256 } from './sessions';

export const TG_REQUEST_COOKIE = 'cs_tg_req';
export const TG_REQUEST_TTL_MS = 10 * 60 * 1000;
/** A login link is only good for a few minutes: the person is sitting at the page waiting. */
export const LOGIN_REQUEST_TTL_MS = 5 * 60 * 1000;

/** "Chrome on Android": enough for the person to recognise their own browser in the bot's message. */
export function describeBrowser(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'a browser';
  const os =
    /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} on ${os}` : browser;
}

export async function startTelegramAuth(
  { prisma, config }: AppDeps,
  input: { purpose: TelegramAuthPurpose; phone?: string; userId?: string; userAgent?: string },
): Promise<{ requestId: string; deepLink: string; expiresAt: Date; matchCode?: string }> {
  const token = randomToken();
  const login = input.purpose === 'LOGIN';
  const expiresAt = new Date(Date.now() + (login ? LOGIN_REQUEST_TTL_MS : TG_REQUEST_TTL_MS));
  // Two digits the person can compare between the website and the bot, so they notice a link someone else started.
  const matchCode = login ? String(randomInt(100)).padStart(2, '0') : undefined;
  const req = await prisma.telegramAuthRequest.create({
    data: {
      tokenHash: sha256(token),
      purpose: input.purpose,
      expectedPhone: input.phone,
      userId: input.userId,
      matchCode,
      browser: login ? describeBrowser(input.userAgent) : undefined,
      expiresAt,
    },
  });
  return {
    requestId: req.id,
    deepLink: `https://t.me/${config.telegram.botUsername}?start=${token}`,
    expiresAt,
    ...(matchCode ? { matchCode } : {}),
  };
}

/** The customer's name as Telegram shows it, so sign-up never has to ask for one. */
export function telegramDisplayName(from: TgUser): string | null {
  return [from.first_name, from.last_name].filter(Boolean).join(' ').slice(0, 60) || null;
}

/**
 * Bot-first sign-up: the number is verified and the account exists, so the website link only has to log in.
 * It is a VERIFIED login request the browser claims with the token (see POST /auth/telegram/claim).
 */
export const LOGIN_LINK_TTL_MS = 15 * 60 * 1000;

export async function issueLoginLink(
  { prisma, config }: AppDeps,
  input: { from: TgUser; chatId: number; phone: string; userId: string },
): Promise<{ url: string }> {
  const token = randomToken();
  await prisma.telegramAuthRequest.create({
    data: {
      tokenHash: sha256(token),
      purpose: 'LOGIN',
      status: 'VERIFIED',
      phone: input.phone,
      userId: input.userId,
      telegramUserId: BigInt(input.from.id),
      telegramChatId: BigInt(input.chatId),
      telegramUsername: input.from.username ?? null,
      firstName: telegramDisplayName(input.from),
      verifiedAt: new Date(),
      expiresAt: new Date(Date.now() + LOGIN_LINK_TTL_MS),
    },
  });
  return { url: `${config.webOrigin[0] ?? ''}/login?t=${token}` };
}

export function effectiveStatus(r: TelegramAuthRequest) {
  const lapsed = r.expiresAt.getTime() <= Date.now();
  if (r.status === 'PENDING' && lapsed) return 'EXPIRED';
  // A shared location is only handed out inside the request's window; after that it is just a stale row.
  if (r.status === 'VERIFIED' && r.purpose === 'SHARE_LOCATION' && lapsed) return 'EXPIRED';
  return r.status;
}

/** Load a request that belongs to this browser (bound by cookie). */
export async function findOwnRequest(deps: AppDeps, req: Request, requestId: string) {
  if (req.cookies?.[TG_REQUEST_COOKIE] !== requestId) return null;
  return deps.prisma.telegramAuthRequest.findUnique({ where: { id: requestId } });
}

export function statusView(r: TelegramAuthRequest) {
  const status = effectiveStatus(r);
  return {
    status,
    ...(status === 'VERIFIED' && r.phone ? { phone: maskPhone(r.phone) } : {}),
    ...(status === 'VERIFIED' && r.purpose === 'SHARE_LOCATION' && r.lat !== null && r.lng !== null
      ? { lat: r.lat, lng: r.lng }
      : {}),
    ...(r.firstName ? { firstName: r.firstName } : {}),
    ...(r.purpose === 'LOGIN' && r.matchCode ? { matchCode: r.matchCode } : {}),
  };
}

/**
 * Atomically move a VERIFIED, unexpired request of `purpose` to COMPLETED.
 * Returns the request, or throws TELEGRAM_NOT_VERIFIED. Single use.
 */
export async function consumeVerifiedRequest(
  tx: Prisma.TransactionClient,
  req: Request,
  requestId: string,
  purpose: TelegramAuthPurpose,
): Promise<TelegramAuthRequest> {
  const notVerified = new AppError(
    409,
    'TELEGRAM_NOT_VERIFIED',
    'Phone verification is missing or expired. Please start again.',
  );
  if (req.cookies?.[TG_REQUEST_COOKIE] !== requestId) throw notVerified;
  const { count } = await tx.telegramAuthRequest.updateMany({
    where: { id: requestId, purpose, status: 'VERIFIED', expiresAt: { gt: new Date() } },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  if (count !== 1) throw notVerified;
  return tx.telegramAuthRequest.findUniqueOrThrow({ where: { id: requestId } });
}

export { normalizePhone };
