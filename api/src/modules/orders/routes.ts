import { createOrderSchema, quoteSchema, type CreateOrderInput, type QuoteInput } from '@cambo/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../http/app';
import { AppError, notFound } from '../../http/errors';
import { requireAuth } from '../../http/middleware/auth';
import { limiter } from '../../http/middleware/rate-limit';
import { validate } from '../../http/middleware/validate';
import { createOrder, orderInclude, toOrderDto } from './orders';
import { buildQuote, type Quote } from './quote';

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export function checkoutRouter(deps: AppDeps): Router {
  const { prisma, files } = deps;
  const r = Router();

  const quoteDto = (q: Quote) => ({
    ...q,
    promo: q.promo ? { code: q.promo.code } : null,
    items: q.items.map(({ imageKey, imageWidth, ...i }) => ({
      ...i,
      image: imageKey ? files.imageUrls(imageKey, imageWidth ?? 400).sm : null,
    })),
  });

  r.post('/checkout/quote', requireAuth, validate({ body: quoteSchema }), async (req, res) => {
    res.json(quoteDto(await buildQuote(prisma, req.valid.body as QuoteInput, req.user!.id)));
  });

  r.post('/orders', requireAuth, limiter(20, 10 * 60 * 1000), validate({ body: createOrderSchema }), async (req, res) => {
    const key = req.get('idempotency-key')?.trim();
    if (key && key.length > 100) throw new AppError(400, 'VALIDATION_ERROR', 'Idempotency-Key is too long');
    const { order, created } = await createOrder(deps, req.user!.id, req.valid.body as CreateOrderInput, key || undefined);
    res.status(created ? 201 : 200).json(toOrderDto(order, files));
  });

  r.get('/orders', requireAuth, validate({ query: pageQuery }), async (req, res) => {
    const { page, pageSize } = req.valid.query as z.infer<typeof pageQuery>;
    const where = { userId: req.user!.id };
    const [total, items] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    res.json({ items: items.map((o) => toOrderDto(o, files)), total, page, pageSize });
  });

  r.get('/orders/:number', requireAuth, validate({ params: z.object({ number: z.string().max(20) }) }), async (req, res) => {
    const { number } = req.valid.params as { number: string };
    const order = await prisma.order.findFirst({ where: { number, userId: req.user!.id }, include: orderInclude });
    if (!order) throw notFound('Order');
    res.json(toOrderDto(order, files));
  });

  return r;
}
