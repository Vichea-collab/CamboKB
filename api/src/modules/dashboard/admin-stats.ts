import { LOW_STOCK_THRESHOLD, startOfPhnomPenhDay } from '@cambo/shared';
import { Router } from 'express';
import type { AppDeps } from '../../http/app';

const DAY_MS = 24 * 60 * 60 * 1000;

export function adminStatsRouter({ prisma }: AppDeps): Router {
  const r = Router();
  r.get('/stats', async (_req, res) => {
    const today = startOfPhnomPenhDay(new Date());
    const weekStart = new Date(today.getTime() - 6 * DAY_MS);
    const window = async (gte: Date) => {
      const agg = await prisma.order.aggregate({ where: { createdAt: { gte }, status: { not: 'CANCELLED' } }, _count: { _all: true }, _sum: { totalCents: true } });
      return { orders: agg._count._all, revenueCents: agg._sum.totalCents ?? 0 };
    };
    const [todayStats, week, pendingCount, khqrWaitingCount, lowStock, refundsDue] = await Promise.all([
      window(today),
      window(weekStart),
      prisma.order.count({ where: { status: 'PENDING' } }),
      prisma.payment.count({ where: { method: 'KHQR', status: 'PENDING', order: { status: 'PENDING' } } }),
      prisma.product.findMany({
        where: { isActive: true, stock: { lte: LOW_STOCK_THRESHOLD } },
        select: { id: true, name: true, stock: true },
        orderBy: [{ stock: 'asc' }, { name: 'asc' }],
        take: 20,
      }),
      // Money we hold for an order that was cancelled (e.g. paid after the time ran out): it must go back to the customer.
      prisma.payment.findMany({
        where: { status: 'PAID', order: { status: 'CANCELLED' } },
        select: { amountCents: true, order: { select: { id: true, number: true } } },
        orderBy: { paidAt: 'asc' },
        take: 20,
      }),
    ]);
    res.json({
      today: todayStats,
      week,
      pendingCount,
      khqrWaitingCount,
      lowStock,
      refundsDue: refundsDue.map((p) => ({ orderId: p.order.id, number: p.order.number, amountCents: p.amountCents })),
    });
  });
  return r;
}
