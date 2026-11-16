import { uuidSchema } from '@cambo/shared';
import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { notFound } from '../errors';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const range = z.object({ from: date, to: date });
const queries = {
  summary: range.extend({ groupBy: z.enum(['day', 'month']).default('day') }),
  'top-products': range.extend({ limit: z.coerce.number().int().min(1).max(100).default(10) }),
  breakdown: range,
  'orders.csv': range,
} as const;

const stringify = (q: Record<string, unknown>) => Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)]));

async function sendInvoice(deps: AppDeps, res: Response, order: { id: string; number: string }) {
  const pdf = await deps.reports.invoicePdf(order.id);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="invoice-${order.number}.pdf"`,
    'Cache-Control': 'private, no-store',
  });
  res.send(pdf);
}

/** Customer: download the invoice of one of their own orders. */
export function customerInvoiceRouter(deps: AppDeps): Router {
  const r = Router();
  r.get('/orders/:number/invoice.pdf', requireAuth, validate({ params: z.object({ number: z.string().max(20) }) }), async (req, res) => {
    const { number } = req.valid.params as { number: string };
    const order = await deps.prisma.order.findFirst({ where: { number, userId: req.user!.id }, select: { id: true, number: true } });
    if (!order) throw notFound('Order');
    await sendInvoice(deps, res, order);
  });
  return r;
}

/** Admin: any invoice plus sales reports (mounted behind the admin guard). */
export function adminReportsRouter(deps: AppDeps): Router {
  const r = Router();

  r.get('/orders/:id/invoice.pdf', validate({ params: z.object({ id: uuidSchema }) }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const order = await deps.prisma.order.findUnique({ where: { id }, select: { id: true, number: true } });
    if (!order) throw notFound('Order');
    await sendInvoice(deps, res, order);
  });

  for (const [name, schema] of Object.entries(queries)) {
    r.get(`/reports/${name}`, validate({ query: schema }), async (req, res) => {
      const query = stringify(req.valid.query as Record<string, unknown>);
      const out = await deps.reports.get(`/internal/sales/${name}`, query);
      res.set('Cache-Control', 'private, no-store').type(out.contentType);
      if (name === 'orders.csv') res.set('Content-Disposition', `attachment; filename="orders-${query.from}-to-${query.to}.csv"`);
      res.send(out.body);
    });
  }

  return r;
}
