import type { PrismaClient } from '@prisma/client';
import { normalizePhone } from '@cambo/shared';
import { unlinkTelegram } from '../modules/auth/unlink';

/**
 * Owner recovery: the shop owner lost their Telegram account and cannot log in. Run over SSH, like admin:promote.
 * Clears the account's Telegram link and ends its sessions; the owner then links again by pressing
 * "Continue with Telegram" and sharing their phone number in the bot.
 */
export async function unlinkTelegramByPhone(prisma: PrismaClient, phoneInput: string) {
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new Error(`Invalid phone number: ${phoneInput}`);
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) throw new Error(`No user with phone ${phone}.`);
  if (user.telegramUserId === null) {
    throw new Error(`${user.name} (${user.phone}) has no Telegram account linked. Nothing to unlink.`);
  }
  return unlinkTelegram(prisma, user.id);
}
