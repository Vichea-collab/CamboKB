import {
  LOW_STOCK_THRESHOLD,
  PHNOM_PENH_OFFSET_MS,
  phnomPenhDate,
  phnomPenhDayRange,
  startOfPhnomPenhDay,
} from '@cambo/shared';
import type { AppDeps } from '../../http/app';
import { kickEvents, publishEvent } from './outbox';
import { adminAlertsOn } from './snapshot';

/** Yesterday's numbers go out at 8 in the morning: the day is complete, and the to-do list starts the new one. */
const SEND_AT_HOUR = 8;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Queue yesterday's summary for the owner's group, if it is time and it has not been sent. Safe to call as often as
 * you like, after restarts too: the day is the event's dedupe key. Returns whether it was queued now.
 */
export async function sendDailySummary(deps: AppDeps, now = new Date()): Promise<boolean> {
  const { prisma } = deps;
  if (new Date(now.getTime() + PHNOM_PENH_OFFSET_MS).getUTCHours() < SEND_AT_HOUR) return false;
  const date = phnomPenhDate(new Date(startOfPhnomPenhDay(now).getTime() - HOUR_MS));
  const dedupeKey = `summary:${date}`;
  if (await prisma.serviceEvent.findFirst({ where: { dedupeKey }, select: { id: true } })) return false;

  const { start, endExclusive } = phnomPenhDayRange(date, date);
  const createdAt = { gte: start, lt: endExclusive };
  // A KHQR order counts once it is paid: not while it waits for the money, nor when the money never came.
  const waitingForMoney = { status: 'PENDING', payment: { is: { method: 'KHQR', status: 'PENDING' } } } as const;
  const [sold, cancelled, newCustomers, pending, lowStock, refundsDue, adminAlerts] = await Promise.all([
    prisma.order.aggregate({
      where: { createdAt, status: { not: 'CANCELLED' }, NOT: waitingForMoney },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
    prisma.order.count({
      where: { createdAt, status: 'CANCELLED', NOT: { payment: { is: { status: 'EXPIRED' } } } },
    }),
    prisma.user.count({ where: { createdAt, role: 'CUSTOMER' } }),
    prisma.order.count({ where: { status: 'PENDING', NOT: waitingForMoney } }),
    prisma.product.count({ where: { isActive: true, stock: { lte: LOW_STOCK_THRESHOLD } } }),
    prisma.payment.count({ where: { status: 'PAID', order: { status: 'CANCELLED' } } }),
    adminAlertsOn(prisma),
  ]);
  await publishEvent(
    prisma,
    'shop.daily_summary',
    {
      date,
      orders: sold._count._all,
      revenueCents: sold._sum.totalCents ?? 0,
      cancelled,
      newCustomers,
      pending,
      lowStock,
      refundsDue,
      adminAlerts,
    },
    { dedupeKey },
  );
  kickEvents(deps);
  return true;
}

/**
 * Check every few minutes. Returns a stop function. Not at once: during a deploy the notification service may still be
 * the previous version, which would refuse an event it does not know.
 */
export function startDailySummary(deps: AppDeps, intervalMs = 5 * 60_000): () => void {
  const tick = () =>
    void sendDailySummary(deps).catch((err) => deps.logger.error({ err }, 'daily summary failed'));
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
