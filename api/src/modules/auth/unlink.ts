import type { PrismaClient, User } from '@prisma/client';

/**
 * Cut an account's tie to its Telegram account (recovery for a lost or changed Telegram account).
 * The account keeps its orders and phone; the customer links again by sharing their phone in the bot.
 * Every session ends, and any login or sign-up still waiting on the old Telegram account is cancelled.
 * Used by the admin button and by the `admin:unlink-telegram` command, so both do exactly the same.
 */
export async function unlinkTelegram(prisma: PrismaClient, userId: string): Promise<User> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const user = await tx.user.update({
      where: { id: userId },
      data: { telegramUserId: null, telegramChatId: null, telegramUsername: null },
    });
    const now = new Date();
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.telegramAuthRequest.updateMany({
      where: {
        status: { in: ['PENDING', 'VERIFIED'] },
        OR: [{ userId }, ...(before.telegramUserId !== null ? [{ telegramUserId: before.telegramUserId }] : [])],
      },
      data: { status: 'EXPIRED' },
    });
    return user;
  });
}
