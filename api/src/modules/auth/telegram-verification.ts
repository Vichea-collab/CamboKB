import type { Prisma, TelegramAuthPurpose, TelegramAuthRequest } from '@prisma/client';
import { maskPhone, normalizePhone } from '@cambo/shared';
import type { Request } from 'express';
import type { AppDeps } from '../../http/app';
import { AppError } from '../../http/errors';
import type { TgUser } from '../../integrations/telegram/types';
import { randomToken, sha256 } from './sessions';

export const TG_REQUEST_COOKIE = 'cs_tg_req';
export const TG_REQUEST_TTL_MS = 10 * 60 * 1000;

export async function startTelegramAuth(
  { prisma, config }: AppDeps,
  input: { purpose: TelegramAuthPurpose; phone?: string; userId?: string },
): Promise<{ requestId: string; deepLink: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + TG_REQUEST_TTL_MS);
  const req = await prisma.telegramAuthRequest.create({
    data: {
      tokenHash: sha256(token),
      purpose: input.purpose,
      expectedPhone: input.phone,
      userId: input.userId,
      expiresAt,
    },
  });
  return {
    requestId: req.id,
    deepLink: `https://t.me/${config.telegram.botUsername}?start=${token}`,
    expiresAt,
  };
}

/** The customer's name as Telegram shows it, so sign-up never has to ask for one. */
export function telegramDisplayName(from: TgUser): string | null {
  return [from.first_name, from.last_name].filter(Boolean).join(' ').slice(0, 60) || null;
}

/** Bot-first sign-up: the number is already verified, so the website link only has to set a password. */
export const SIGNUP_LINK_TTL_MS = 30 * 60 * 1000;

export async function issueSignupLink(
  { prisma, config }: AppDeps,
  input: { from: TgUser; chatId: number; phone: string },
): Promise<{ url: string }> {
  const token = randomToken();
  await prisma.$transaction([
    // Only the newest link works: sharing again replaces an earlier one.
    prisma.telegramAuthRequest.updateMany({
      where: {
        telegramUserId: BigInt(input.from.id),
        purpose: 'SIGNUP',
        status: { in: ['PENDING', 'VERIFIED'] },
      },
      data: { status: 'EXPIRED' },
    }),
    prisma.telegramAuthRequest.create({
      data: {
        tokenHash: sha256(token),
        purpose: 'SIGNUP',
        status: 'VERIFIED',
        phone: input.phone,
        telegramUserId: BigInt(input.from.id),
        telegramChatId: BigInt(input.chatId),
        telegramUsername: input.from.username ?? null,
        firstName: telegramDisplayName(input.from),
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + SIGNUP_LINK_TTL_MS),
      },
    }),
  ]);
  return { url: `${config.webOrigin[0] ?? ''}/signup?t=${token}` };
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
