import { backfillOrderSnapshots, retryFailedEvents } from '../src/cli/events';
import { loadConfig } from '../src/config';
import { createPrisma } from '../src/db/prisma';

// Usage: npm run events -w @cambo/api -- backfill    (send every order to the report service)
//        npm run events -w @cambo/api -- retry-failed (queue events that gave up again)
const command = process.argv[2];
const prisma = createPrisma(loadConfig().databaseUrl);
try {
  if (command === 'backfill')
    console.log(
      `Queued ${await backfillOrderSnapshots(prisma)} order snapshots. The api delivers them within seconds.`,
    );
  else if (command === 'retry-failed')
    console.log(`Queued ${await retryFailedEvents(prisma)} failed events again.`);
  else {
    console.error('Usage: events <backfill|retry-failed>');
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
