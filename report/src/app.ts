import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type pg from 'pg';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';
import { requireSecret } from './auth';
import type { ReportConfig } from './config';
import { toCsv } from './csv';
import { ReportError } from './errors';
import { getInvoiceData, type InvoiceRenderer } from './invoice';
import type { Logger } from './logger';
import { rangeSchema } from './range';
import { breakdown, ordersForCsv, salesSummary, topProducts } from './sales';

export type ReportDeps = { config: ReportConfig; pool: pg.Pool; invoices: InvoiceRenderer; logger: Logger };

const parse = <T extends z.ZodType>(schema: T, value: unknown): z.infer<T> => {
  const r = schema.safeParse(value);
  if (!r.success) throw new ReportError(400, 'VALIDATION_ERROR', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
};

const CSV_COLUMNS = ['number', 'date', 'status', 'customer', 'phone', 'region', 'service', 'payment', 'paymentStatus', 'items', 'subtotal', 'delivery', 'discount', 'total'] as const;
const dollars = (cents: number) => (cents / 100).toFixed(2);

export function createReportApp({ config, pool, invoices, logger }: ReportDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger, genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(), autoLogging: { ignore: (req) => req.url === '/healthz' } }));
  app.use(helmet());

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  const r = express.Router();
  r.use(requireSecret(config.secret));

  r.get('/invoices/:file', async (req, res) => {
    const m = /^([0-9a-f-]{36})\.pdf$/i.exec(req.params.file ?? '');
    const id = m && z.uuid().safeParse(m[1]).success ? m[1]! : null;
    if (!id) throw new ReportError(404, 'NOT_FOUND', 'Invoice not found');
    const data = await getInvoiceData(pool, id);
    if (!data) throw new ReportError(404, 'NOT_FOUND', 'Invoice not found');
    const pdf = await invoices.render(data, { name: config.storeName });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${data.number}.pdf"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(pdf);
  });

  r.get('/sales/summary', async (req, res) => {
    const q = parse(rangeSchema.extend({ groupBy: z.enum(['day', 'month']).default('day') }), req.query);
    res.json(await salesSummary(pool, q));
  });

  r.get('/sales/top-products', async (req, res) => {
    const q = parse(rangeSchema.extend({ limit: z.coerce.number().int().min(1).max(100).default(10) }), req.query);
    res.json({ items: await topProducts(pool, q) });
  });

  r.get('/sales/breakdown', async (req, res) => {
    res.json(await breakdown(pool, parse(rangeSchema, req.query)));
  });

  r.get('/sales/orders.csv', async (req, res) => {
    const q = parse(rangeSchema, req.query);
    const rows = (await ordersForCsv(pool, q)).map((o) => ({
      ...o,
      subtotal: dollars(o.subtotal),
      delivery: dollars(o.delivery),
      discount: dollars(o.discount),
      total: dollars(o.total),
    }));
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="orders-${q.from}-to-${q.to}.csv"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(`\uFEFF${toCsv(rows, [...CSV_COLUMNS])}`);
  });

  app.use('/internal', r);
  app.use((_req, _res, next) => next(new ReportError(404, 'NOT_FOUND', 'Not found')));
  app.use(errorHandler);
  return app;
}

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const known = err instanceof ReportError;
  if (!known) req.log?.error({ err }, 'unhandled error');
  res.status(known ? err.status : 500).json({
    error: { code: known ? err.code : 'INTERNAL', message: known ? err.message : 'Something went wrong' },
  });
};
