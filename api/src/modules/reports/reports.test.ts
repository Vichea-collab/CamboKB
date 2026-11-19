import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProduct, createTestApp, resetDb, signedInAgent, WEB_ORIGIN } from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

describe('invoices and reports through the api', () => {
  let ctx: Ctx;
  let customer: Awaited<ReturnType<typeof signedInAgent>>['agent'];
  let order: { id: string; number: string };

  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
    ({ agent: customer } = await signedInAgent(ctx.app, ctx.prisma));
    const product = await createProduct(ctx.prisma);
    const res = await customer.post('/api/v1/orders').set('Origin', WEB_ORIGIN).send({
      items: [{ productId: product.id, quantity: 1 }],
      region: 'PHNOM_PENH',
      deliveryService: 'VET',
      contactName: 'Dara',
      contactPhone: '012345678',
      addressLine: 'St. 315',
      paymentMethod: 'COD',
    });
    order = res.body;
  });

  it('lets a customer download their own invoice', async () => {
    const res = await customer.get(`/api/v1/orders/${order.number}/invoice.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(`inline; filename="invoice-${order.number}.pdf"`);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(ctx.reports.calls.at(-1)?.path).toBe(`/internal/invoices/${order.id}.pdf`);
  });

  it('lets a customer look at their invoice first, as a page that cannot run scripts or be framed by other sites', async () => {
    const res = await customer.get(`/api/v1/orders/${order.number}/invoice.html`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).toContain(`fake invoice ${order.id}`);
    expect(res.headers['content-security-policy']).toContain("script-src 'none'");
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(ctx.reports.calls.at(-1)?.path).toBe(`/internal/invoices/${order.id}.html`);
  });

  it('downloads the invoice as a file when asked, and shows it in the browser otherwise', async () => {
    const dl = await customer.get(`/api/v1/orders/${order.number}/invoice.pdf?download=1`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toBe(`attachment; filename="invoice-${order.number}.pdf"`);
    const view = await customer.get(`/api/v1/orders/${order.number}/invoice.pdf`);
    expect(view.headers['content-disposition']).toBe(`inline; filename="invoice-${order.number}.pdf"`);
  });

  it("hides other customers' invoice pages too", async () => {
    const { agent: other } = await signedInAgent(ctx.app, ctx.prisma);
    expect((await other.get(`/api/v1/orders/${order.number}/invoice.html`)).status).toBe(404);
    expect((await request(ctx.app).get(`/api/v1/orders/${order.number}/invoice.html`)).status).toBe(401);
  });

  it("hides other customers' invoices", async () => {
    const { agent: other } = await signedInAgent(ctx.app, ctx.prisma);
    expect((await other.get(`/api/v1/orders/${order.number}/invoice.pdf`)).status).toBe(404);
    expect((await request(ctx.app).get(`/api/v1/orders/${order.number}/invoice.pdf`)).status).toBe(401);
  });

  it('lets an admin view any invoice page, but not a customer', async () => {
    const { agent: admin } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' });
    const res = await admin.get(`/api/v1/admin/orders/${order.id}/invoice.html`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`fake invoice ${order.id}`);
    expect((await customer.get(`/api/v1/admin/orders/${order.id}/invoice.html`)).status).toBe(403);
  });

  it('keeps sales reports for admins', async () => {
    expect((await customer.get('/api/v1/admin/reports/summary').query({ from: '2026-11-01', to: '2026-11-30' })).status).toBe(403);
    const { agent: admin } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' });
    const res = await admin.get('/api/v1/admin/reports/summary').query({ from: '2026-11-01', to: '2026-11-30', groupBy: 'month' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ path: '/internal/sales/summary', query: { from: '2026-11-01', to: '2026-11-30', groupBy: 'month' } });
    const csv = await admin.get('/api/v1/admin/reports/orders.csv').query({ from: '2026-11-01', to: '2026-11-30' });
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    expect(csv.headers['content-disposition']).toBe('attachment; filename="orders-2026-11-01-to-2026-11-30.csv"');
    const invoice = await admin.get(`/api/v1/admin/orders/${order.id}/invoice.pdf`);
    expect(invoice.status).toBe(200);
  });

  it('validates report queries before calling the report service', async () => {
    const { agent: admin } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' });
    const res = await admin.get('/api/v1/admin/reports/summary').query({ from: 'yesterday', to: '2026-11-30' });
    expect(res.status).toBe(400);
    expect(ctx.reports.calls.filter((c) => c.path.includes('sales'))).toHaveLength(0);
  });
});
