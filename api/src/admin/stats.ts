import { startOfPhnomPenhDay } from '@cambo/shared';
import { Router } from 'express';
import type { AppDeps } from '../app';

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
    const [todayStats, week, pendingCount, lowStock] = await Promise.all([
      window(today),
      window(weekStart),
      prisma.order.count({ where: { status: 'PENDING' } }),
      prisma.product.findMany({
        where: { isActive: true, stock: { lte: 3 } },
        select: { id: true, name: true, stock: true },
        orderBy: [{ stock: 'asc' }, { name: 'asc' }],
        take: 20,
      }),
    ]);
    res.json({ today: todayStats, week, pendingCount, lowStock });
  });
  return r;
}
