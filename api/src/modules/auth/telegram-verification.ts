import type { Prisma, TelegramAuthPurpose, TelegramAuthRequest } from '@prisma/client';
import { maskPhone, normalizePhone } from '@cambo/shared';
import type { Request } from 'express';
import type { AppDeps } from '../../http/app';
import { AppError } from '../../http/errors';
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
    data: { tokenHash: sha256(token), purpose: input.purpose, expectedPhone: input.phone, userId: input.userId, expiresAt },
  });
  return { requestId: req.id, deepLink: `https://t.me/${config.telegram.botUsername}?start=${token}`, expiresAt };
}

export function effectiveStatus(r: TelegramAuthRequest) {
  return r.status === 'PENDING' && r.expiresAt.getTime() <= Date.now() ? 'EXPIRED' : r.status;
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
  const notVerified = new AppError(409, 'TELEGRAM_NOT_VERIFIED', 'Phone verification is missing or expired. Please start again.');
  if (req.cookies?.[TG_REQUEST_COOKIE] !== requestId) throw notVerified;
  const { count } = await tx.telegramAuthRequest.updateMany({
    where: { id: requestId, purpose, status: 'VERIFIED', expiresAt: { gt: new Date() } },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  if (count !== 1) throw notVerified;
  return tx.telegramAuthRequest.findUniqueOrThrow({ where: { id: requestId } });
}

export { normalizePhone };
