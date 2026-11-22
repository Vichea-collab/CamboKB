import { uuidSchema } from '@cambo/shared';
import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../http/app';
import { notFound } from '../../http/errors';
import { requireAuth } from '../../http/middleware/auth';
import { validate } from '../../http/middleware/validate';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const range = z.object({ from: date, to: date });
const queries = {
  summary: range.extend({ groupBy: z.enum(['day', 'month']).default('day') }),
  'top-products': range.extend({ limit: z.coerce.number().int().min(1).max(100).default(10) }),
  breakdown: range,
  'orders.csv': range,
  'report.pdf': range.extend({ groupBy: z.enum(['day', 'month']).default('day') }),
  'report.html': range.extend({ groupBy: z.enum(['day', 'month']).default('day') }),
} as const;

const stringify = (q: Record<string, unknown>) => Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)]));

const downloadQuery = z.object({ download: z.enum(['1']).optional() });

/** The PDF: shown in the browser, or saved as a file with `?download=1`. */
async function sendInvoice(deps: AppDeps, res: Response, order: { id: string; number: string }, download = false) {
  const pdf = await deps.reports.invoicePdf(order.id);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="invoice-${order.number}.pdf"`,
    'Cache-Control': 'private, no-store',
  });
  res.send(pdf);
}

/** The invoice as a page to look at first. It holds customer text, so it may not run scripts. */
async function sendInvoiceHtml(deps: AppDeps, res: Response, order: { id: string }) {
  const html = await deps.reports.invoiceHtml(order.id);
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'",
    'Cache-Control': 'private, no-store',
  });
  res.send(html);
}

/** Customer: download the invoice of one of their own orders. */
export function customerInvoiceRouter(deps: AppDeps): Router {
  const r = Router();
  const own = async (number: string, userId: string) => {
    const order = await deps.prisma.order.findFirst({ where: { number, userId }, select: { id: true, number: true } });
    if (!order) throw notFound('Order');
    return order;
  };
  const params = z.object({ number: z.string().max(20) });
  r.get('/orders/:number/invoice.pdf', requireAuth, validate({ params, query: downloadQuery }), async (req, res) => {
    const order = await own((req.valid.params as { number: string }).number, req.user!.id);
    await sendInvoice(deps, res, order, (req.valid.query as { download?: string }).download === '1');
  });
  r.get('/orders/:number/invoice.html', requireAuth, validate({ params }), async (req, res) => {
    await sendInvoiceHtml(deps, res, await own((req.valid.params as { number: string }).number, req.user!.id));
  });
  return r;
}

/** Admin: any invoice plus sales reports (mounted behind the admin guard). */
export function adminReportsRouter(deps: AppDeps): Router {
  const r = Router();

  const anyOrder = async (id: string) => {
    const order = await deps.prisma.order.findUnique({ where: { id }, select: { id: true, number: true } });
    if (!order) throw notFound('Order');
    return order;
  };
  r.get('/orders/:id/invoice.pdf', validate({ params: z.object({ id: uuidSchema }), query: downloadQuery }), async (req, res) => {
    const order = await anyOrder((req.valid.params as { id: string }).id);
    await sendInvoice(deps, res, order, (req.valid.query as { download?: string }).download === '1');
  });
  r.get('/orders/:id/invoice.html', validate({ params: z.object({ id: uuidSchema }) }), async (req, res) => {
    await sendInvoiceHtml(deps, res, await anyOrder((req.valid.params as { id: string }).id));
  });

  for (const [name, schema] of Object.entries(queries)) {
    r.get(`/reports/${name}`, validate({ query: schema.extend({ download: z.enum(['1']).optional() }) }), async (req, res) => {
      const { download, ...rest } = req.valid.query as Record<string, unknown>;
      const query = stringify(rest);
      const out = await deps.reports.get(`/internal/sales/${name}`, query);
      res.set('Cache-Control', 'private, no-store').type(out.contentType);
      if (name === 'orders.csv') res.set('Content-Disposition', `attachment; filename="orders-${query.from}-to-${query.to}.csv"`);
      // The printed report: saved as a file with `?download=1`, shown in the browser otherwise. Its page form holds customer text, so no scripts.
      if (name === 'report.pdf')
        res.set('Content-Disposition', `${download === '1' ? 'attachment' : 'inline'}; filename="sales-report-${query.from}-to-${query.to}.pdf"`);
      if (name === 'report.html')
        res.set('Content-Security-Policy', "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'");
      res.send(out.body);
    });
  }

  return r;
}
