import { unlinkTelegramByPhone } from '../src/cli/unlink-telegram';
import { loadConfig } from '../src/config';
import { createPrisma } from '../src/db/prisma';

// Usage: npm run admin:unlink-telegram -w api -- +85512345678
const phone = process.argv[2];
if (!phone) {
  console.error('Usage: npm run admin:unlink-telegram -w api -- <phone>');
  process.exit(1);
}
const prisma = createPrisma(loadConfig().databaseUrl);
unlinkTelegramByPhone(prisma, phone)
  .then((u) =>
    console.log(
      `${u.name} (${u.phone}) is unlinked from Telegram and logged out everywhere. ` +
        'They link again by pressing Continue with Telegram and sharing their phone number in the bot.',
    ),
  )
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
