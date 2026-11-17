import { promoteAdmin } from '../src/cli/promote';
import { loadConfig } from '../src/config';
import { createPrisma } from '../src/db/prisma';

// Usage: npm run admin:promote -w api -- +85512345678
const phone = process.argv[2];
if (!phone) {
  console.error('Usage: npm run admin:promote -w api -- <phone>');
  process.exit(1);
}
const prisma = createPrisma(loadConfig().databaseUrl);
promoteAdmin(prisma, phone)
  .then((u) => console.log(`${u.name} (${u.phone}) is now an admin.`))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
