import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createReportApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPool } from '../src/db';
import { createLogger } from '../src/logger';
import { escapeCsvCell } from '../src/csv';
import { createInvoiceRenderer, type InvoiceRenderer } from '../src/invoice';
import { resetDb, seedCatalog, seedOrder } from './seed';

const SECRET = 'test-report-secret-0123456789abcdef01';
const config = loadConfig({ NODE_ENV: 'test', REPORT_DATABASE_URL: process.env.DATABASE_URL_TEST, REPORT_SERVICE_SECRET: SECRET });
const pool = createPool(config.databaseUrl);
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
    const res = await request(app).get('/internal/sales/summary').query({ from: '2026-11-01', to: '2026-11-02' });
    expect(res.status).toBe(401);
  });

  it('validates the date range', async () => {
    const back = await request(app).get('/internal/sales/summary').set(auth).query({ from: '2026-11-05', to: '2026-11-01' });
    expect(back.status).toBe(400);
    expect(back.body.error.code).toBe('INVALID_RANGE');
    const long = await request(app).get('/internal/sales/summary').set(auth).query({ from: '2025-01-01', to: '2026-11-01' });
    expect(long.body.error.code).toBe('INVALID_RANGE');
  });

  it('serves an invoice PDF with a download filename', async () => {
    const { user, mouse } = await seedCatalog();
    const order = await seedOrder({ userId: user.id, at: '2026-11-10T03:00:00Z', items: [{ productId: mouse.id, name: mouse.name, priceCents: 2100, quantity: 1 }] });
    const res = await request(app).get(`/internal/invoices/${order.id}.pdf`).set(auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(`inline; filename="invoice-${order.number}.pdf"`);
    expect((await request(app).get('/internal/invoices/00000000-0000-4000-8000-000000000000.pdf').set(auth)).status).toBe(404);
  });

  it('exports orders as CSV, safely escaped', async () => {
    const { user, mouse } = await seedCatalog();
    await seedOrder({ userId: user.id, at: '2026-11-10T03:00:00Z', contactName: 'Dara, Jr. "KB"', items: [{ productId: mouse.id, name: mouse.name, priceCents: 2100, quantity: 1 }] });
    await seedOrder({ userId: user.id, at: '2026-11-10T04:00:00Z', contactName: '=HYPERLINK("http://evil")', items: [{ productId: mouse.id, name: mouse.name, priceCents: 2100, quantity: 1 }] });
    const res = await request(app).get('/internal/sales/orders.csv').set(auth).query({ from: '2026-11-10', to: '2026-11-10' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('number,date,status,customer,phone,region,service,payment,paymentStatus,items,subtotal,delivery,discount,total');
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
