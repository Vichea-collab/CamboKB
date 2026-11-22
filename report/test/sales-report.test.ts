import { extractText, getDocumentProxy } from 'unpdf';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createReportApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createInvoiceRenderer, type InvoiceRenderer } from '../src/invoice';
import { createLogger } from '../src/logger';
import { getSalesReportData } from '../src/sales-report';
import { pool, resetDb, seedCatalog, seedOrder } from './seed';

const SECRET = 'test-report-secret-0123456789abcdef01';
const config = loadConfig({
  NODE_ENV: 'test',
  REPORT_DATABASE_URL: process.env.REPORT_DATABASE_URL_TEST,
  REPORT_SERVICE_SECRET: SECRET,
});
const auth = { Authorization: `Bearer ${SECRET}` };
const store = { name: 'Cambo Supply' };
const range = { from: '2026-11-01', to: '2026-11-30' };

let renderer: InvoiceRenderer;
let app: ReturnType<typeof createReportApp>;
beforeAll(async () => {
  renderer = await createInvoiceRenderer();
  app = createReportApp({ config, pool, invoices: renderer, logger: createLogger('silent') });
});
afterAll(async () => {
  await renderer?.close();
  await pool.end();
});

const pdfText = async (buf: Buffer) =>
  (await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true })).text;

/** Mouse 2 x $21 (+$2 delivery) paid, mousepad 1 x $15 (+$2, -$1 discount) unpaid, a cancelled one, and one outside the range. */
async function seed() {
  const { mouse, pad } = await seedCatalog();
  const a = await seedOrder({ at: '2026-11-10T03:00:00Z', paymentStatus: 'PAID', contactName: 'Dara', items: [{ productId: mouse.id, name: mouse.name, priceCents: 2100, quantity: 2 }] });
  const b = await seedOrder({ at: '2026-11-12T03:00:00Z', discountCents: 100, contactName: '<b>Sok</b><script>alert(1)</script>', method: 'KHQR', region: 'PROVINCE', items: [{ productId: pad.id, name: pad.name, priceCents: 1500, quantity: 1 }] });
  const c = await seedOrder({ at: '2026-11-12T05:00:00Z', status: 'CANCELLED', items: [{ productId: mouse.id, name: mouse.name, priceCents: 2100, quantity: 1 }] });
  await seedOrder({ at: '2026-10-01T03:00:00Z', items: [{ productId: mouse.id, name: mouse.name, priceCents: 2100, quantity: 1 }] });
  return { a, b, c };
}

describe('sales report', () => {
  beforeEach(resetDb);

  it('adds up: every table total is the same revenue, and cancelled orders count nowhere', async () => {
    const { a, b } = await seed();
    const d = await getSalesReportData(pool, range, 'day');
    expect(d.totals).toMatchObject({ orders: 2, units: 3, revenueCents: a.totalCents + b.totalCents });
    expect(d.buckets.reduce((s, x) => s + x.revenueCents, 0)).toBe(d.totals.revenueCents);
    expect(d.byPaymentMethod.reduce((s, x) => s + x.revenueCents, 0)).toBe(d.totals.revenueCents);
    expect(d.byRegion.reduce((s, x) => s + x.revenueCents, 0)).toBe(d.totals.revenueCents);
    expect(d.orders.reduce((s, x) => s + x.totalCents, 0)).toBe(d.totals.revenueCents);
    expect(d.orders.reduce((s, x) => s + x.subtotalCents, 0)).toBe(d.products.reduce((s, x) => s + x.revenueCents, 0));
    expect(d.orders.map((o) => o.number)).toEqual([a.number, b.number]);
    expect(d.paidCents).toBe(a.totalCents);
    expect(d.unpaidCents).toBe(b.totalCents);
    expect(d.cancelled).toEqual({ orders: 1, totalCents: 2300 });
  });

  it('renders the page with the totals in the invoice style, escaping customer text', async () => {
    const { a, b } = await seed();
    const html = await renderer.renderSalesHtml(await getSalesReportData(pool, range, 'day'), store);
    expect(html).toMatch(/^<!doctype html>/i);
    for (const s of ['Sales Report', '1 Nov 2026 – 30 Nov 2026', 'SR-20261101-20261130', '$60.00', a.number, b.number, 'Attack Shark X11 White', 'Mousepad XL', 'Cash on Delivery', 'KHQR', 'Province', 'COD · Paid', 'KHQR · Unpaid', '1 cancelled order ($23.00) left out of every total.', '-$1.00', 'Total · 2 orders'])
      expect(html).toContain(s);
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;b&gt;Sok');
  });

  it('prints a PDF that holds the numbers', async () => {
    const { a, b } = await seed();
    const pdf = await renderer.renderSales(await getSalesReportData(pool, range, 'day'), store);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const text = await pdfText(pdf);
    for (const s of ['SALES REPORT', 'REVENUE', '$60.00', a.number, b.number, 'Total', 'Page 1 of 1']) expect(text).toContain(s);
  });

  it('groups by month, leaving out months with no sales', async () => {
    await seed();
    const d = await getSalesReportData(pool, { from: '2026-09-01', to: '2026-11-30' }, 'month');
    const html = await renderer.renderSalesHtml(d, store);
    expect(html).toContain('Oct 2026');
    expect(html).toContain('Nov 2026');
    expect(html).not.toContain('<td class="l">Sep 2026');
    expect(html).toContain('Months with no sales are left out.');
  });

  it('says so when there is nothing to report, instead of printing empty tables', async () => {
    const html = await renderer.renderSalesHtml(await getSalesReportData(pool, range, 'day'), store);
    expect(html).toContain('No sales in this period.');
    expect(html).not.toContain('Every order');
    expect((await renderer.renderSales(await getSalesReportData(pool, range, 'day'), store)).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('prints a long list of orders over several pages with the header on each', async () => {
    const { mouse } = await seedCatalog();
    for (let i = 0; i < 70; i++)
      await seedOrder({ at: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}T03:00:00Z`, items: [{ productId: mouse.id, name: mouse.name, priceCents: 2100, quantity: 1 }] });
    const text = await pdfText(await renderer.renderSales(await getSalesReportData(pool, range, 'day'), store));
    expect(text).toMatch(/Page 1 of [2-9]/);
    expect(text).toContain('Total · 70 orders');
    expect(text).toContain('$1,610.00'); // 70 x ($21 + $2)
  });

  describe('over HTTP', () => {
    it('serves the PDF with a download filename, and the page for previewing', async () => {
      await seed();
      const pdf = await request(app).get('/internal/sales/report.pdf').set(auth).query(range);
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.headers['content-disposition']).toBe('inline; filename="sales-report-2026-11-01-to-2026-11-30.pdf"');
      expect(pdf.headers['cache-control']).toBe('private, no-store');
      const html = await request(app).get('/internal/sales/report.html').set(auth).query({ ...range, groupBy: 'month' });
      expect(html.status).toBe(200);
      expect(html.headers['content-type']).toMatch(/^text\/html/);
      expect(html.headers['content-security-policy']).toContain("script-src 'none'");
      expect(html.text).toContain('Sales Report');
    });

    it('needs the secret, a sensible range, and a known format', async () => {
      expect((await request(app).get('/internal/sales/report.pdf').query(range)).status).toBe(401);
      expect((await request(app).get('/internal/sales/report.pdf').set(auth).query({ from: '2026-11-05', to: '2026-11-01' })).body.error.code).toBe('INVALID_RANGE');
      expect((await request(app).get('/internal/sales/report.pdf').set(auth).query({ from: 'yesterday', to: '2026-11-01' })).status).toBe(400);
      expect((await request(app).get('/internal/sales/report.docx').set(auth).query(range)).status).toBe(404);
    });
  });
});
