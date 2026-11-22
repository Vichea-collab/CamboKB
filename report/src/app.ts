import { randomUUID } from 'node:crypto';
import { eventEnvelopeSchema, eventDataSchemas } from '@cambo/shared';
import {
  createMetrics,
  currentRequestId,
  requestContext,
  requireServiceSecret,
} from '@cambo/service-kit';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type pg from 'pg';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';
import type { ReportConfig } from './config';
import { toCsv } from './csv';
import { ReportError } from './errors';
import { getInvoiceData, type InvoiceRenderer } from './invoice';
import type { Logger } from './logger';
import { applySnapshot, orderStats } from './orders';
import { rangeSchema, resolveRange } from './range';
import { getSalesReportData } from './sales-report';
import { breakdown, ordersForCsv, salesSummary, topProducts } from './sales';

export type ReportDeps = {
  config: ReportConfig;
  pool: pg.Pool;
  invoices: InvoiceRenderer;
  logger: Logger;
};

const parse = <T extends z.ZodType>(schema: T, value: unknown): z.infer<T> => {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new ReportError(
      400,
      'VALIDATION_ERROR',
      r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  return r.data;
};

const CSV_COLUMNS = [
  'number',
  'date',
  'status',
  'customer',
  'phone',
  'region',
  'service',
  'payment',
  'paymentStatus',
  'items',
  'subtotal',
  'delivery',
  'discount',
  'total',
] as const;
const dollars = (cents: number) => (cents / 100).toFixed(2);

export function createReportApp({ config, pool, invoices, logger }: ReportDeps) {
  const metrics = createMetrics('report');
  const events = metrics.counter('report_events_total', 'Order events received', [
    'type',
    'result',
  ] as const);
  const rendered = metrics.histogram(
    'report_invoice_render_seconds',
    'Time to render an invoice PDF',
    [],
    [0.25, 0.5, 1, 2, 5, 10, 30],
  );
  metrics.gauge('report_orders', 'Orders held in the report database', [], async (g) => {
    g.set((await orderStats(pool).catch(() => ({ orders: 0 }))).orders);
  });
  metrics.gauge(
    'report_newest_event_age_seconds',
    'Seconds since the newest order version arrived',
    [],
    async (g) => {
      const age = (await orderStats(pool).catch(() => ({ newestEventAgeSeconds: null })))
        .newestEventAgeSeconds;
      if (age !== null) g.set(age);
    },
  );

  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext());
  app.use(metrics.middleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: () => currentRequestId() ?? randomUUID(),
      autoLogging: {
        ignore: (req) => req.url === '/healthz' || req.url === '/metrics' || req.url === '/readyz',
      },
    }),
  );
  app.use(helmet());

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/readyz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  app.get('/metrics', metrics.handler);

  const r = express.Router();
  r.use(
    requireServiceSecret(
      config.secret,
      () => new ReportError(401, 'UNAUTHORIZED', 'Missing or invalid service credentials'),
    ),
  );

  // The api tells this service about every order change. At-least-once, any order: see applySnapshot.
  r.post('/events', express.json({ limit: '1mb' }), async (req, res) => {
    const envelope = eventEnvelopeSchema.safeParse(req.body);
    if (!envelope.success) throw new ReportError(400, 'INVALID_EVENT', 'Not an event');
    if (envelope.data.type !== 'order.snapshot') {
      events.inc({ type: envelope.data.type.slice(0, 40), result: 'ignored' });
      throw new ReportError(
        422,
        'UNKNOWN_EVENT',
        `This service does not handle ${envelope.data.type.slice(0, 40)}`,
      );
    }
    const order = eventDataSchemas['order.snapshot'].safeParse(envelope.data.data);
    if (!order.success) {
      events.inc({ type: 'order.snapshot', result: 'invalid' });
      throw new ReportError(
        400,
        'INVALID_EVENT',
        order.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }
    let result;
    try {
      result = await applySnapshot(pool, order.data, envelope.data.emittedAt);
    } catch (err) {
      // Same order number, different order: the api's database was reset or restored while this one kept
      // its rows. Retrying can't fix that, so say so plainly (the api gives the event up and raises an alert).
      if ((err as { code?: string }).code === '23505') {
        events.inc({ type: 'order.snapshot', result: 'conflict' });
        throw new ReportError(
          409,
          'ORDER_NUMBER_CONFLICT',
          `Order number ${order.data.number} already belongs to a different order. Clear this service's database and run the api's "events backfill".`,
        );
      }
      throw err;
    }
    events.inc({ type: 'order.snapshot', result });
    req.log.info(
      { orderNumber: order.data.number, status: order.data.status, result },
      'order snapshot received',
    );
    res.json({ result });
  });

  r.get('/invoices/:file', async (req, res) => {
    const m = /^([0-9a-f-]{36})\.(pdf|html)$/i.exec(req.params.file ?? '');
    const id = m && z.uuid().safeParse(m[1]).success ? m[1]! : null;
    if (!id) throw new ReportError(404, 'NOT_FOUND', 'Invoice not found');
    const data = await getInvoiceData(pool, id);
    if (!data) throw new ReportError(404, 'NOT_FOUND', 'Invoice not found');
    if (m![2]!.toLowerCase() === 'html') {
      const html = await invoices.renderHtml(data, { name: config.storeName });
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        // A page of customer-supplied text: never any script, only its own styles and inlined images.
        'Content-Security-Policy': "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'",
        'Cache-Control': 'private, no-store',
      });
      res.send(html);
      return;
    }
    const stop = rendered.startTimer();
    const pdf = await invoices.render(data, { name: config.storeName });
    stop();
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${data.number}.pdf"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(pdf);
  });

  r.get('/sales/summary', async (req, res) => {
    const q = parse(
      rangeSchema.extend({ groupBy: z.enum(['day', 'month']).default('day') }),
      req.query,
    );
    res.json(await salesSummary(pool, q));
  });

  r.get('/sales/top-products', async (req, res) => {
    const q = parse(
      rangeSchema.extend({ limit: z.coerce.number().int().min(1).max(100).default(10) }),
      req.query,
    );
    res.json({ items: await topProducts(pool, q) });
  });

  r.get('/sales/breakdown', async (req, res) => {
    res.json(await breakdown(pool, parse(rangeSchema, req.query)));
  });

  // The printed report: summary, sales by day or month, products, payments, regions and every order, each with its total.
  r.get('/sales/report.:ext', async (req, res) => {
    if (req.params.ext !== 'pdf' && req.params.ext !== 'html') throw new ReportError(404, 'NOT_FOUND', 'Not found');
    const q = parse(
      rangeSchema.extend({ groupBy: z.enum(['day', 'month']).default('day') }),
      req.query,
    );
    resolveRange(q); // the same limits as every other report (at most a year, from before to)
    const data = await getSalesReportData(pool, q, q.groupBy);
    if (req.params.ext === 'html') {
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'",
        'Cache-Control': 'private, no-store',
      });
      res.send(await invoices.renderSalesHtml(data, { name: config.storeName }));
      return;
    }
    const stop = rendered.startTimer();
    const pdf = await invoices.renderSales(data, { name: config.storeName });
    stop();
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="sales-report-${q.from}-to-${q.to}.pdf"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(pdf);
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
    error: {
      code: known ? err.code : 'INTERNAL',
      message: known ? err.message : 'Something went wrong',
    },
  });
};
