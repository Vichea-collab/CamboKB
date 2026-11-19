import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createReportApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createLogger } from '../src/logger';
import { escapeCsvCell } from '../src/csv';
import { createInvoiceRenderer, type InvoiceRenderer } from '../src/invoice';
import { pool, resetDb, seedCatalog, seedOrder } from './seed';

const SECRET = 'test-report-secret-0123456789abcdef01';
const config = loadConfig({
  NODE_ENV: 'test',
  REPORT_DATABASE_URL: process.env.REPORT_DATABASE_URL_TEST,
  REPORT_SERVICE_SECRET: SECRET,
});
let invoices: InvoiceRenderer;
let app: ReturnType<typeof createReportApp>;
beforeAll(async () => {
  invoices = await createInvoiceRenderer();
  app = createReportApp({ config, pool, invoices, logger: createLogger('silent') });
});
afterAll(async () => {
  await invoices?.close();
  await pool.end();
});
const auth = { Authorization: `Bearer ${SECRET}` };

describe('report service HTTP API', () => {
  beforeEach(resetDb);

  it('requires the shared secret', async () => {
    const res = await request(app)
      .get('/internal/sales/summary')
      .query({ from: '2026-11-01', to: '2026-11-02' });
    expect(res.status).toBe(401);
  });

  it('validates the date range', async () => {
    const back = await request(app)
      .get('/internal/sales/summary')
      .set(auth)
      .query({ from: '2026-11-05', to: '2026-11-01' });
    expect(back.status).toBe(400);
    expect(back.body.error.code).toBe('INVALID_RANGE');
    const long = await request(app)
      .get('/internal/sales/summary')
      .set(auth)
      .query({ from: '2025-01-01', to: '2026-11-01' });
    expect(long.body.error.code).toBe('INVALID_RANGE');
  });

  it('serves an invoice PDF with a download filename', async () => {
    const { mouse } = await seedCatalog();
    const order = await seedOrder({
      at: '2026-11-10T03:00:00Z',
      items: [{ productId: mouse.id, name: mouse.name, priceCents: 2100, quantity: 1 }],
    });
    const res = await request(app).get(`/internal/invoices/${order.id}.pdf`).set(auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      `inline; filename="invoice-${order.number}.pdf"`,
    );
    expect(
      (
        await request(app)
          .get('/internal/invoices/00000000-0000-4000-8000-000000000000.pdf')
          .set(auth)
      ).status,
    ).toBe(404);
  });

  it('serves the invoice as a web page for previewing, with a policy that blocks scripts', async () => {
    const { mouse } = await seedCatalog();
    const order = await seedOrder({
      at: '2026-11-10T03:00:00Z',
      items: [{ productId: mouse.id, name: mouse.name, priceCents: 2100, quantity: 1 }],
    });
    const res = await request(app).get(`/internal/invoices/${order.id}.html`).set(auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).toContain(order.number);
    expect(res.headers['content-security-policy']).toContain("script-src 'none'");
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect((await request(app).get('/internal/invoices/00000000-0000-4000-8000-000000000000.html').set(auth)).status).toBe(404);
    expect((await request(app).get(`/internal/invoices/${order.id}.html`)).status).toBe(401);
  });

  it('exports orders as CSV, safely escaped', async () => {
    const { mouse } = await seedCatalog();
    await seedOrder({
      at: '2026-11-10T03:00:00Z',
      contactName: 'Dara, Jr. "KB"',
      items: [{ productId: mouse.id, name: mouse.name, priceCents: 2100, quantity: 1 }],
    });
    await seedOrder({
      at: '2026-11-10T04:00:00Z',
      contactName: '=HYPERLINK("http://evil")',
      items: [{ productId: mouse.id, name: mouse.name, priceCents: 2100, quantity: 1 }],
    });
    const res = await request(app)
      .get('/internal/sales/orders.csv')
      .set(auth)
      .query({ from: '2026-11-10', to: '2026-11-10' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'number,date,status,customer,phone,region,service,payment,paymentStatus,items,subtotal,delivery,discount,total',
    );
    expect(res.text).toContain('"Dara, Jr. ""KB"""');
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it.each([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line\nbreak', '"line\nbreak"'],
    ['+1', "'+1"],
    ['@sum', "'@sum"],
  ])('escapes %j', (input, out) => {
    expect(escapeCsvCell(input)).toBe(out);
  });
});

describe('order events from the api', () => {
  beforeEach(resetDb);

  const base = {
    id: '5b0f1c4e-6f0d-4d52-9a6e-2f1d8a3b9c10',
    number: 'CS-900001',
    status: 'PENDING',
    createdAt: '2026-11-10T03:00:00.000Z',
    contactName: 'Dara',
    contactPhone: '+85512345678',
    region: 'PHNOM_PENH',
    deliveryService: 'VET',
    addressLine: 'St. 315',
    lat: null,
    lng: null,
    distanceKm: null,
    note: null,
    subtotalCents: 4200,
    deliveryFeeCents: 200,
    discountCents: 0,
    totalCents: 4400,
    promoCode: null,
    payment: { method: 'COD', status: 'UNPAID' },
    items: [
      {
        productId: '8d7a0b3e-3c5a-4e0b-8f6a-0d9a8f1e2b34',
        name: 'Attack Shark X11 White',
        quantity: 2,
        priceCents: 2100,
        lineTotalCents: 4200,
      },
    ],
  };
  const send = (
    data: unknown,
    emittedAt: string,
    type = 'order.snapshot',
    headers: Record<string, string> = auth,
  ) =>
    request(app)
      .post('/internal/events')
      .set(headers)
      .send({ id: randomUUID(), type, emittedAt, data });

  it('requires the shared secret', async () => {
    expect((await send(base, '2026-11-10T03:00:00.000Z', 'order.snapshot', {})).status).toBe(401);
  });

  it('stores a snapshot and uses it for reports and invoices, with no access to any other database', async () => {
    expect((await send(base, '2026-11-10T03:00:00.000Z')).body).toEqual({ result: 'applied' });
    const summary = await request(app)
      .get('/internal/sales/summary')
      .set(auth)
      .query({ from: '2026-11-10', to: '2026-11-10' });
    expect(summary.body.totals).toMatchObject({ orders: 1, units: 2, revenueCents: 4400 });
    const invoice = await request(app).get(`/internal/invoices/${base.id}.pdf`).set(auth);
    expect(invoice.status).toBe(200);
    expect(invoice.headers['content-disposition']).toContain('invoice-CS-900001.pdf');
  });

  it('applies the same event twice without changing anything', async () => {
    await send(base, '2026-11-10T03:00:00.000Z');
    expect((await send(base, '2026-11-10T03:00:00.000Z')).body).toEqual({ result: 'applied' });
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM order_items')).rows[0].n).toBe(1);
  });

  it('keeps the newest version when events arrive late or out of order', async () => {
    await send({ ...base, status: 'SHIPPING' }, '2026-11-10T05:00:00.000Z');
    expect((await send({ ...base, status: 'CONFIRMED' }, '2026-11-10T04:00:00.000Z')).body).toEqual(
      { result: 'stale' },
    );
    expect((await pool.query('SELECT status FROM orders')).rows[0].status).toBe('SHIPPING');
    expect((await send({ ...base, status: 'DELIVERED' }, '2026-11-10T06:00:00.000Z')).body).toEqual(
      { result: 'applied' },
    );
    expect((await pool.query('SELECT status FROM orders')).rows[0].status).toBe('DELIVERED');
  });

  it('answers a clear, final 409 when an order number belongs to a different order (a reset api database)', async () => {
    await send(base, '2026-11-10T03:00:00.000Z');
    const clash = await send(
      { ...base, id: '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f' },
      '2026-11-10T04:00:00.000Z',
    );
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('ORDER_NUMBER_CONFLICT');
    expect(clash.body.error.message).toContain('events backfill');
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(1);
  });

  it('replaces the items of an order when a newer snapshot has different ones', async () => {
    await send(base, '2026-11-10T03:00:00.000Z');
    await send(
      {
        ...base,
        items: [
          { ...base.items[0], quantity: 1, lineTotalCents: 2100 },
          {
            productId: '3b1c2d4e-5f60-4a71-8b92-a3c4d5e6f708',
            name: 'Mousepad XL',
            quantity: 1,
            priceCents: 600,
            lineTotalCents: 600,
          },
        ],
      },
      '2026-11-10T04:00:00.000Z',
    );
    expect(
      (await pool.query('SELECT name, quantity FROM order_items ORDER BY position')).rows,
    ).toEqual([
      { name: 'Attack Shark X11 White', quantity: 1 },
      { name: 'Mousepad XL', quantity: 1 },
    ]);
  });

  it('refuses events that break the contract, and events meant for other services', async () => {
    const bad = await send({ ...base, totalCents: 'free' }, '2026-11-10T03:00:00.000Z');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_EVENT');
    const other = await send({ text: 'hi' }, '2026-11-10T03:00:00.000Z', 'admin.alert');
    expect(other.status).toBe(422);
    expect(
      (await request(app).post('/internal/events').set(auth).send({ nope: true })).status,
    ).toBe(400);
  });

  it('reports readiness from its database and counts events in its metrics', async () => {
    await send(base, '2026-11-10T03:00:00.000Z');
    expect((await request(app).get('/readyz')).status).toBe(200);
    const text = (await request(app).get('/metrics')).text;
    expect(text).toMatch(
      /report_events_total\{type="order.snapshot",result="applied",service="report"\} \d+/,
    );
    expect(text).toContain('report_orders{service="report"} 1');
  });
});
