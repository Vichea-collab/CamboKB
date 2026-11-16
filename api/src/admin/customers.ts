import type { Prisma } from '@prisma/client';
import { normalizePhone, uuidSchema } from '@cambo/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { revokeAllSessions, toPublicUser } from '../auth/sessions';
import { orderInclude, toOrderDto } from '../checkout/orders';
import { AppError, notFound } from '../errors';
import { validate } from '../middleware/validate';

const idParams = z.object({ id: uuidSchema });
const listQuery = z.object({
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export function adminCustomersRouter({ prisma, files }: AppDeps): Router {
  const r = Router();

  const stats = async (userIds: string[]) => {
    const [counts, spent] = await Promise.all([
      prisma.order.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _count: { _all: true } }),
      prisma.order.groupBy({ by: ['userId'], where: { userId: { in: userIds }, status: 'DELIVERED' }, _sum: { totalCents: true } }),
    ]);
    return (id: string) => ({
      orderCount: counts.find((c) => c.userId === id)?._count._all ?? 0,
      totalSpentCents: spent.find((s) => s.userId === id)?._sum.totalCents ?? 0,
    });
  };

  r.get('/customers', validate({ query: listQuery }), async (req, res) => {
    const { q, page, pageSize } = req.valid.query as z.infer<typeof listQuery>;
    const where: Prisma.UserWhereInput = {};
    if (q) {
      const phone = normalizePhone(q);
      where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { telegramUsername: { contains: q, mode: 'insensitive' } }, ...(phone ? [{ phone }] : [])];
    }
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const statFor = await stats(users.map((u) => u.id));
    res.json({
      items: users.map((u) => ({ ...toPublicUser(u), disabled: Boolean(u.disabledAt), createdAt: u.createdAt, ...statFor(u.id) })),
      total,
      page,
      pageSize,
    });
  });

  r.get('/customers/:id', validate({ params: idParams }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) throw notFound('Customer');
    const orders = await prisma.order.findMany({ where: { userId: id }, include: orderInclude, orderBy: { createdAt: 'desc' }, take: 50 });
    const statFor = await stats([id]);
    res.json({ ...toPublicUser(u), disabled: Boolean(u.disabledAt), createdAt: u.createdAt, ...statFor(id), orders: orders.map((o) => toOrderDto(o, files)) });
  });

  const setDisabled = (disabled: boolean) =>
    async (req: Parameters<Parameters<Router['post']>[1]>[0], res: Parameters<Parameters<Router['post']>[1]>[1]) => {
      const { id } = req.valid.params as { id: string };
      if (disabled && id === req.user!.id) throw new AppError(400, 'CANNOT_DISABLE_SELF', "You can't disable your own account");
      const u = await prisma.user.update({ where: { id }, data: { disabledAt: disabled ? new Date() : null } });
      if (disabled) await revokeAllSessions(prisma, id);
      res.json({ ...toPublicUser(u), disabled });
    };
  // Make someone an admin or a customer again. Takes effect on their next request
  // (the role is read from the database every time).
  r.post('/customers/:id/role', validate({ params: idParams, body: z.object({ role: z.enum(['ADMIN', 'CUSTOMER']) }) }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const { role } = req.valid.body as { role: 'ADMIN' | 'CUSTOMER' };
    if (id === req.user!.id) throw new AppError(400, 'CANNOT_CHANGE_OWN_ROLE', "You can't change your own role");
    const user = await prisma.$transaction(async (tx) => {
      // Lock the admin rows so two admins can't demote each other at the same moment.
      await tx.$queryRaw`SELECT id FROM "User" WHERE role = 'ADMIN' FOR UPDATE`;
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) throw notFound('Customer');
      if (target.role === 'ADMIN' && role === 'CUSTOMER' && (await tx.user.count({ where: { role: 'ADMIN' } })) <= 1) {
        throw new AppError(409, 'LAST_ADMIN', 'The store needs at least one admin');
      }
      return tx.user.update({ where: { id }, data: { role } });
    });
    res.json({ ...toPublicUser(user), disabled: Boolean(user.disabledAt) });
  });

  r.post('/customers/:id/disable', validate({ params: idParams }), setDisabled(true));
  r.post('/customers/:id/enable', validate({ params: idParams }), setDisabled(false));

  return r;
}
