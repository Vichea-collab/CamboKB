import type { PrismaClient } from '@prisma/client';
import { retryFailedEvents } from '../modules/events/outbox';
import { loadSnapshot } from '../modules/events/snapshot';
import { publishEvent } from '../modules/events/outbox';

const PAGE = 200;

/**
 * Queue an `order.snapshot` for every order, so a new or rebuilt report database catches up.
 * The running api delivers them. Safe to run again (the report keeps the newest version).
 */
export async function backfillOrderSnapshots(prisma: PrismaClient): Promise<number> {
  let cursor: string | undefined;
  let total = 0;
  for (;;) {
    const page = await prisma.order.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!page.length) break;
    for (const { id } of page) {
      const { order } = await loadSnapshot(prisma, id);
      await publishEvent(prisma, 'order.snapshot', order);
      total++;
    }
    cursor = page.at(-1)!.id;
  }
  return total;
}

export { retryFailedEvents };
