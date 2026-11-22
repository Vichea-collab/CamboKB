import type { LoginConfirmReply, LoginConfirmRequest } from '@cambo/shared';
import type { AppDeps } from '../../http/app';
import { BOT_TEXT } from './updates';

/**
 * Someone tapped "Log me in" or "Not me" under the login message in Telegram. The notification service passes on
 * Telegram's own id of whoever pressed the button; only the Telegram account this request was opened by may answer,
 * and only while it is still waiting. Nothing else makes a login request VERIFIED for a linked account.
 */
export async function confirmLogin(
  { prisma }: AppDeps,
  input: LoginConfirmRequest,
): Promise<LoginConfirmReply> {
  const reply = (outcome: LoginConfirmReply['outcome'], text: string) => ({ outcome, text });
  const request = await prisma.telegramAuthRequest.findUnique({ where: { id: input.requestId } });
  if (!request || request.purpose !== 'LOGIN') return reply('expired', BOT_TEXT.loginExpired);
  const who = BigInt(input.telegramUserId);
  if (request.telegramUserId === null || request.telegramUserId !== who) {
    return reply('not_yours', BOT_TEXT.loginNotYours);
  }
  const waiting = { id: request.id, purpose: 'LOGIN' as const, status: 'PENDING' as const, telegramUserId: who };

  if (input.decision === 'n') {
    await prisma.telegramAuthRequest.updateMany({ where: waiting, data: { status: 'EXPIRED' } });
    return reply('declined', BOT_TEXT.loginDeclined);
  }

  // The account must still exist, be enabled, and still be linked to this very Telegram account.
  const user = request.userId ? await prisma.user.findUnique({ where: { id: request.userId } }) : null;
  if (!user || user.disabledAt || user.telegramUserId !== who) {
    await prisma.telegramAuthRequest.updateMany({ where: waiting, data: { status: 'EXPIRED' } });
    return reply('expired', BOT_TEXT.cannotVerify);
  }
  const { count } = await prisma.telegramAuthRequest.updateMany({
    where: { ...waiting, expiresAt: { gt: new Date() } },
    data: { status: 'VERIFIED', verifiedAt: new Date() },
  });
  return count === 1 ? reply('confirmed', BOT_TEXT.loginDone) : reply('expired', BOT_TEXT.loginExpired);
}
