import type { PrismaClient } from '@prisma/client';
import { normalizePhone } from '@cambo/shared';

/** Give an existing account the ADMIN role. The public API can never do this. */
export async function promoteAdmin(prisma: PrismaClient, phoneInput: string) {
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new Error(`Invalid phone number: ${phoneInput}`);
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) throw new Error(`No user with phone ${phone}. Sign up on the website first.`);
  return prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
}
