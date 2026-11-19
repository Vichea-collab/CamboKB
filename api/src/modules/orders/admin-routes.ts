import type { Prisma } from '@prisma/client';
import {
  normalizePhone,
  ORDER_STATUSES,
  orderStatusUpdateSchema,
  paymentStatusUpdateSchema,
  phnomPenhDayRange,
  uuidSchema,
  type OrderStatus,
  type PaymentStatus,
} from '@cambo/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../http/app';
import { toPublicUser } from '../auth/sessions';
import { abandonedOrder, orderInclude, toOrderDto } from './orders';
import { kickEvents } from '../events/outbox';
import { announceSnapshot, announceTrackingSet } from '../events/snapshot';
import { changeOrderStatus, publishOrderUpdate } from './status';
import { AppError, notFound } from '../../http/errors';
import { validate } from '../../http/middleware/validate';
import { checkKhqrPayment } from '../payments/khqr';

const idParams = z.object({ id: uuidSchema });
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const listQuery = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  q: z.string().trim().max(60).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export function adminOrdersRouter(deps: AppDeps): Router {
  const { prisma, files } = deps;
  const r = Router();
  const detail = async (id: string) => {
    const o = await prisma.order.findUnique({
      where: { id },
      include: { ...orderInclude, user: true },
    });
    if (!o) throw notFound('Order');
    return { ...toOrderDto(o, files), customer: toPublicUser(o.user) };
  };

  // Counts per status for the Orders tabs (registered before /orders/:id).
  r.get('/orders/counts', async (_req, res) => {
    const rows = await prisma.order.groupBy({
      by: ['status'],
      where: { NOT: abandonedOrder },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {
      PENDING: 0,
      CONFIRMED: 0,
      PACKED: 0,
      SHIPPING: 0,
      DELIVERED: 0,
      CANCELLED: 0,
    };
    for (const row of rows) counts[row.status] = row._count._all;
    res.json({ all: Object.values(counts).reduce((a, b) => a + b, 0), ...counts });
  });

  r.get('/orders', validate({ query: listQuery }), async (req, res) => {
    const { status, q, from, to, page, pageSize } = req.valid.query as z.infer<typeof listQuery>;
    const where: Prisma.OrderWhereInput = {};
    if (status) where.status = status;
    // Unpaid orders whose payment ran out are left out, unless the admin looks for a specific one.
    if (!q) where.NOT = abandonedOrder;
    if (q) {
      const phone = normalizePhone(q);
      where.OR = [
        { number: { contains: q.toUpperCase() } },
        ...(phone ? [{ contactPhone: phone }, { user: { phone } }] : []),
      ];
    }
    if (from || to) {
      const range = phnomPenhDayRange(from ?? '2000-01-01', to ?? '2999-12-31');
      where.createdAt = { gte: range.start, lt: range.endExclusive };
    }
    const [total, items] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: { ...orderInclude, user: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({
      items: items.map((o) => ({ ...toOrderDto(o, files), customer: toPublicUser(o.user) })),
      total,
      page,
      pageSize,
    });
  });

  r.get('/orders/:id', validate({ params: idParams }), async (req, res) => {
    res.json(await detail((req.valid.params as { id: string }).id));
  });

  r.post(
    '/orders/:id/status',
    validate({ params: idParams, body: orderStatusUpdateSchema }),
    async (req, res) => {
      const { id } = req.valid.params as { id: string };
      const { status, note } = req.valid.body as { status: OrderStatus; note?: string };
      await changeOrderStatus(deps, id, status, req.user!.id, note);
      res.json(await detail(id));
    },
  );

  // The carrier's tracking number: shown to the customer and sent to them on Telegram (once per number).
  r.post(
    '/orders/:id/tracking',
    validate({ params: idParams, body: z.object({ trackingNumber: z.string().max(60).nullable() }) }),
    async (req, res) => {
      const { id } = req.valid.params as { id: string };
      const typed = (req.valid.body as { trackingNumber: string | null }).trackingNumber?.trim();
      const trackingNumber = typed ? typed : null;
      const order = await prisma.order.findUnique({ where: { id }, select: { status: true, trackingNumber: true } });
      if (!order) throw notFound('Order');
      if (order.status === 'CANCELLED') throw new AppError(409, 'ORDER_CLOSED', 'A cancelled order cannot be shipped');
      if (order.trackingNumber !== trackingNumber) {
        await prisma.$transaction(async (tx) => {
          await tx.order.update({ where: { id }, data: { trackingNumber } });
          if (trackingNumber) await announceTrackingSet(tx, id);
          else await announceSnapshot(tx, id);
        });
        kickEvents(deps);
        void publishOrderUpdate(deps, id, 'order');
      }
      res.json(await detail(id));
    },
  );

  r.post('/orders/:id/payment/check', validate({ params: idParams }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const payment = await prisma.payment.findUnique({ where: { orderId: id } });
    if (!payment) throw notFound('Payment');
    if (payment.method === 'KHQR') await checkKhqrPayment(deps, payment.id, { force: true });
    res.json(await detail(id));
  });

  r.post(
    '/orders/:id/payment',
    validate({ params: idParams, body: paymentStatusUpdateSchema }),
    async (req, res) => {
      const { id } = req.valid.params as { id: string };
      const { status } = req.valid.body as { status: PaymentStatus };
      const payment = await prisma.payment.findUnique({ where: { orderId: id } });
      if (!payment) throw notFound('Payment');
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { orderId: id },
          data: { status, paidAt: status === 'PAID' ? (payment.paidAt ?? new Date()) : null },
        });
        await announceSnapshot(tx, id);
      });
      kickEvents(deps);
      void publishOrderUpdate(deps, id, 'payment');
      res.json(await detail(id));
    },
  );

  return r;
}
