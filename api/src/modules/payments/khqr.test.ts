import { createRequire } from 'node:module';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BakongError, createProduct, createTestApp, resetDb, signedInAgent, testConfig, WEB_ORIGIN } from '../../../test/helpers';
import { sweepKhqrPayments } from './khqr';

const { BakongKHQR } = createRequire(import.meta.url)('bakong-khqr') as { BakongKHQR: { verify(qr: string): { isValid: boolean }; decode(qr: string): { data: Record<string, string> } } };

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
type Agent = Awaited<ReturnType<typeof signedInAgent>>['agent'];
const TG = 8100;
const MIN = 60_000;

describe('KHQR payments with Bakong', () => {
  let ctx: Ctx;
  let customer: Agent;
  let product: Awaited<ReturnType<typeof createProduct>>;

  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
    ({ agent: customer } = await signedInAgent(ctx.app, ctx.prisma, { name: 'Dara', telegramUserId: TG }));
    product = await createProduct(ctx.prisma, { name: 'Attack Shark X11 White', priceCents: 2100, stock: 5 });
  });

  const order = async (over: Record<string, unknown> = {}, agent = customer) => {
    const res = await agent
      .post('/api/v1/orders')
      .set('Origin', WEB_ORIGIN)
      .send({
        items: [{ productId: product.id, quantity: 2 }],
        region: 'PROVINCE',
        deliveryService: 'VET',
        contactName: 'Dara',
        contactPhone: '012345678',
        addressLine: 'Siem Reap',
        paymentMethod: 'KHQR',
        ...over,
      });
    return res;
  };
  const placeKhqr = async () => {
    const res = await order();
    expect(res.status).toBe(201);
    return res.body as { id: string; number: string; totalCents: number };
  };
  const payment = (number: string, agent = customer) => agent.get(`/api/v1/orders/${number}/payment`);
  const codes = (orderId: string) => ctx.prisma.khqrCode.findMany({ where: { payment: { orderId } }, orderBy: { createdAt: 'asc' } });
  const toCustomer = () => ctx.telegram.sent.filter((m) => m.chatId === TG).map((m) => m.text);
  const toAdmin = () => ctx.telegram.sent.filter((m) => m.chatId === '5000').map((m) => m.text);

  it('takes province orders with KHQR and gives a valid QR for the exact total', async () => {
    const o = await placeKhqr();
    expect(o.totalCents).toBe(4400); // 2 x $21 + $2 province delivery
    const res = await payment(o.number);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ method: 'KHQR', status: 'PENDING', amountCents: 4400, currency: 'USD' });
    const payBefore = new Date(res.body.payBefore).getTime();
    // Unpaid KHQR orders are cancelled after 10 minutes, and the QR lasts exactly that long.
    expect(payBefore).toBeGreaterThan(Date.now() + 9 * MIN);
    expect(payBefore).toBeLessThanOrEqual(Date.now() + 10 * MIN + 1000);

    const qr: string = res.body.khqr.qr;
    expect(BakongKHQR.verify(qr).isValid).toBe(true);
    const decoded = BakongKHQR.decode(qr).data;
    expect(Number(decoded.transactionAmount)).toBe(44); // the SDK writes whole dollars as "44"
    expect(decoded).toMatchObject({
      bakongAccountID: 'cambosupply@aclb',
      transactionCurrency: '840',
      billNumber: o.number,
      merchantCity: 'Phnom Penh',
    });
    const qrExpiry = new Date(res.body.khqr.expiresAt).getTime();
    expect(qrExpiry).toBeGreaterThan(Date.now() + 9 * MIN);
    expect(qrExpiry).toBeLessThanOrEqual(Date.now() + 10 * MIN + 1000);
    expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(3);
  });

  it('tells the customer to pay within 10 minutes when the order is placed', async () => {
    const o = await placeKhqr();
    await vi.waitFor(() => expect(toCustomer()).toHaveLength(1));
    expect(toCustomer()[0]).toContain(o.number);
    expect(toCustomer()[0]).toContain('KHQR within 10 minutes');
  });

  it('confirms the order as soon as Bakong reports the payment', async () => {
    const o = await placeKhqr();
    const [code] = await codes(o.id);
    ctx.bakong.pay(code!.md5, { amount: 44 });
    const res = await payment(o.number);
    expect(res.body).toMatchObject({ status: 'PAID', khqr: null });
    expect(res.body.paidAt).toBeTruthy();

    const saved = await ctx.prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { payment: true, events: { orderBy: { at: 'asc' } } } });
    expect(saved.status).toBe('CONFIRMED');
    expect(saved.events.at(-1)).toMatchObject({ fromStatus: 'PENDING', toStatus: 'CONFIRMED', note: 'Paid with KHQR', actorUserId: null });
    expect(saved.payment).toMatchObject({ status: 'PAID', providerRef: code!.md5 });
    expect((saved.payment!.rawPayload as { hash?: string })?.hash).toBe(`hash-${code!.md5.slice(0, 8)}`);
    await vi.waitFor(() => expect(toCustomer().some((t) => t.includes('Payment received'))).toBe(true));
    await vi.waitFor(() => expect(toAdmin().some((t) => t.includes('Payment received') && t.includes(o.number))).toBe(true));
  });

  it('refuses a transaction whose amount or receiving account does not match', async () => {
    const o = await placeKhqr();
    const [code] = await codes(o.id);
    ctx.bakong.pay(code!.md5, { amount: 4.4 });
    expect((await payment(o.number)).body.status).toBe('PENDING');
    ctx.bakong.pay(code!.md5, { amount: 44, toAccountId: 'someone-else@aba' });
    await ctx.prisma.payment.updateMany({ data: { lastCheckedAt: null } });
    expect((await payment(o.number)).body.status).toBe('PENDING');
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PENDING');
    await vi.waitFor(() => expect(toAdmin().some((t) => t.includes("didn't match"))).toBe(true));
  });

  it('asks Bakong at most once every few seconds per payment', async () => {
    const o = await placeKhqr();
    await payment(o.number);
    await payment(o.number);
    await payment(o.number);
    expect(ctx.bakong.calls).toHaveLength(1);
  });

  it('gives a new QR on request and still accepts payment of the older one', async () => {
    const o = await placeKhqr();
    const first = (await payment(o.number)).body.khqr.qr as string;
    const res = await customer.post(`/api/v1/orders/${o.number}/payment/khqr`).set('Origin', WEB_ORIGIN);
    expect(res.status).toBe(200);
    expect(res.body.khqr.qr).not.toBe(first);
    const [older] = await codes(o.id);
    ctx.bakong.pay(older!.md5, { amount: 44 });
    await ctx.prisma.payment.updateMany({ data: { lastCheckedAt: null } });
    expect((await payment(o.number)).body.status).toBe('PAID');
  });

  it('never lets a new QR outlive the payment window', async () => {
    const o = await placeKhqr();
    const windowEnd = new Date(Date.now() + 4 * MIN);
    await ctx.prisma.payment.updateMany({ where: { orderId: o.id }, data: { expiresAt: windowEnd } });
    const res = await customer.post(`/api/v1/orders/${o.number}/payment/khqr`).set('Origin', WEB_ORIGIN);
    expect(new Date(res.body.khqr.expiresAt).getTime()).toBeLessThanOrEqual(windowEnd.getTime());
  });

  it('cancels an unpaid order after the window, gives the stock back and tells the customer', async () => {
    const o = await placeKhqr();
    await ctx.prisma.payment.updateMany({ where: { orderId: o.id }, data: { expiresAt: new Date(Date.now() - 3 * MIN) } });
    const result = await sweepKhqrPayments(ctx.deps);
    expect(result.expired).toBe(1);
    const saved = await ctx.prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { payment: true } });
    expect(saved.status).toBe('CANCELLED');
    expect(saved.payment!.status).toBe('EXPIRED');
    expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(5);
    await vi.waitFor(() => expect(toCustomer().some((t) => t.includes("wasn't paid within 10 minutes"))).toBe(true));
    expect((await payment(o.number)).body).toMatchObject({ status: 'EXPIRED', khqr: null });
  });

  it('checks one last time before cancelling, and keeps a paid order', async () => {
    const o = await placeKhqr();
    const [code] = await codes(o.id);
    ctx.bakong.pay(code!.md5, { amount: 44 });
    await ctx.prisma.payment.updateMany({ where: { orderId: o.id }, data: { expiresAt: new Date(Date.now() - 3 * MIN), lastCheckedAt: new Date() } });
    await sweepKhqrPayments(ctx.deps);
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('CONFIRMED');
  });

  it('picks up payments in the background even if the customer closed the page', async () => {
    const o = await placeKhqr();
    const [code] = await codes(o.id);
    ctx.bakong.pay(code!.md5, { amount: 44 });
    const result = await sweepKhqrPayments(ctx.deps);
    expect(result.paid).toBe(1);
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('CONFIRMED');
  });

  it('flags money that arrives after an order was cancelled, without reopening it', async () => {
    const admin = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' });
    const o = await placeKhqr();
    await admin.agent.post(`/api/v1/admin/orders/${o.id}/status`).set('Origin', WEB_ORIGIN).send({ status: 'CANCELLED' });
    const [code] = await codes(o.id);
    ctx.bakong.pay(code!.md5, { amount: 44 });
    await sweepKhqrPayments(ctx.deps);
    const saved = await ctx.prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { payment: true } });
    expect(saved.status).toBe('CANCELLED');
    expect(saved.payment!.status).toBe('PAID');
    await vi.waitFor(() => expect(toAdmin().some((t) => t.includes('cancelled') && t.includes('refund'))).toBe(true));
  });

  it('keeps waiting and warns the admin once when Bakong rejects the token', async () => {
    const o = await placeKhqr();
    ctx.bakong.failWith = new BakongError('UNAUTHORIZED', 'token rejected');
    expect((await payment(o.number)).body.status).toBe('PENDING');
    await ctx.prisma.payment.updateMany({ data: { lastCheckedAt: null } });
    await payment(o.number);
    await vi.waitFor(() => expect(toAdmin().filter((t) => t.includes('Bakong token'))).toHaveLength(1));
  });

  it("hides other customers' payments", async () => {
    const o = await placeKhqr();
    const { agent: other } = await signedInAgent(ctx.app, ctx.prisma);
    expect((await payment(o.number, other)).status).toBe(404);
    expect((await other.post(`/api/v1/orders/${o.number}/payment/khqr`).set('Origin', WEB_ORIGIN)).status).toBe(404);
    expect((await request(ctx.app).get(`/api/v1/orders/${o.number}/payment`)).status).toBe(401);
  });

  it('lets an admin check a payment on demand', async () => {
    const admin = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' });
    const o = await placeKhqr();
    const [code] = await codes(o.id);
    ctx.bakong.pay(code!.md5, { amount: 44 });
    await payment(o.number); // sets lastCheckedAt; admin check must not be throttled
    ctx.bakong.paid.clear();
    ctx.bakong.pay(code!.md5, { amount: 44 });
    const res = await admin.agent.post(`/api/v1/admin/orders/${o.id}/payment/check`).set('Origin', WEB_ORIGIN);
    expect(res.status).toBe(200);
    expect(res.body.payment.status).toBe('PAID');
  });

  it('offers KHQR only when the store is set up for it', async () => {
    const off = await createTestApp({ config: testConfig({ bakong: { ...testConfig().bakong, enabled: false } }) });
    const { agent } = await signedInAgent(off.app, off.prisma);
    const res = await order({}, agent);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    expect((await request(off.app).get('/api/v1/store')).body.payments).toEqual({ cod: true, khqr: false });
    expect((await request(ctx.app).get('/api/v1/store')).body.payments).toEqual({ cod: true, khqr: true });
  });

  it('still limits cash on delivery to Phnom Penh', async () => {
    const res = await order({ paymentMethod: 'COD' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
  });
});
