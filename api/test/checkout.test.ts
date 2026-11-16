import { DEFAULT_DELIVERY_SETTINGS } from '@cambo/shared';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProduct, createTestApp, resetDb, signedInAgent, WEB_ORIGIN } from './helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
type Agent = Awaited<ReturnType<typeof signedInAgent>>['agent'];

const store = DEFAULT_DELIVERY_SETTINGS.store;
const pinKm = (km: number) => ({ lat: store.lat + km / 111.32, lng: store.lng });

describe('checkout', () => {
  let ctx: Ctx;
  let agent: Agent;
  let mouse: Awaited<ReturnType<typeof createProduct>>;

  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
    ({ agent } = await signedInAgent(ctx.app, ctx.prisma));
    mouse = await createProduct(ctx.prisma, { name: 'Attack Shark X11 White', priceCents: 2100, stock: 5 });
  });

  const quote = (a: Agent, body: Record<string, unknown>) =>
    a.post('/api/v1/checkout/quote').set('Origin', WEB_ORIGIN).send(body);
  const order = (a: Agent, body: Record<string, unknown>, key?: string) => {
    const req = a.post('/api/v1/orders').set('Origin', WEB_ORIGIN);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const orderBody = (over: Record<string, unknown> = {}) => ({
    items: [{ productId: mouse.id, quantity: 1 }],
    region: 'PHNOM_PENH',
    deliveryService: 'VET',
    contactName: 'Dara',
    contactPhone: '012 345 678',
    addressLine: 'St. 315, Toul Kork',
    paymentMethod: 'COD',
    ...over,
  });
  const addPromo = (data: Record<string, unknown>) =>
    ctx.prisma.promoCode.create({ data: { code: 'CAMBOKBSHOP', type: 'FIXED', value: 100, ...data } as never });

  it('requires login', async () => {
    const res = await request(ctx.app).post('/api/v1/checkout/quote').set('Origin', WEB_ORIGIN).send({});
    expect(res.status).toBe(401);
  });

  it('prices Grab delivery by distance', async () => {
    const res = await quote(agent, { items: [{ productId: mouse.id, quantity: 2 }], region: 'PHNOM_PENH', deliveryService: 'GRAB', pin: pinKm(4) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ subtotalCents: 4200, deliveryFeeCents: 200, discountCents: 0, totalCents: 4400 });
    expect(res.body.distanceKm).toBeCloseTo(4, 1);
    expect(res.body.items[0]).toMatchObject({ name: 'Attack Shark X11 White', priceCents: 2100, quantity: 2, lineTotalCents: 4200 });
  });

  it('charges the province rate', async () => {
    const res = await quote(agent, { items: [{ productId: mouse.id, quantity: 1 }], region: 'PROVINCE', deliveryService: 'VET' });
    expect(res.body.deliveryFeeCents).toBe(200);
  });

  it('rejects Grab to a province', async () => {
    const res = await quote(agent, { items: [{ productId: mouse.id, quantity: 1 }], region: 'PROVINCE', deliveryService: 'GRAB' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DELIVERY_NOT_AVAILABLE');
  });

  it('applies a valid promo code, case-insensitively', async () => {
    await addPromo({});
    const res = await quote(agent, { items: [{ productId: mouse.id, quantity: 1 }], region: 'PHNOM_PENH', deliveryService: 'VET', promoCode: 'cambokbshop' });
    expect(res.body).toMatchObject({ discountCents: 100, totalCents: 2100 + 150 - 100, promo: { code: 'CAMBOKBSHOP' } });
  });

  it.each([
    ['expired', { endsAt: new Date(Date.now() - 60_000) }, 'EXPIRED'],
    ['not started', { startsAt: new Date(Date.now() + 60_000) }, 'NOT_STARTED'],
    ['inactive', { isActive: false }, 'NOT_FOUND'],
    ['below minimum', { minSubtotalCents: 5000 }, 'MIN_SUBTOTAL'],
    ['used up', { maxUses: 1, usedCount: 1 }, 'USED_UP'],
  ])('rejects a promo that is %s', async (_label, data, reason) => {
    await addPromo(data);
    const res = await quote(agent, { items: [{ productId: mouse.id, quantity: 1 }], region: 'PHNOM_PENH', deliveryService: 'VET', promoCode: 'CAMBOKBSHOP' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'PROMO_INVALID', details: { reason } });
  });

  it('uses the current database price, ignoring prices sent by the client', async () => {
    await ctx.prisma.product.update({ where: { id: mouse.id }, data: { priceCents: 2500 } });
    const res = await quote(agent, { items: [{ productId: mouse.id, quantity: 1, priceCents: 1 }], region: 'PHNOM_PENH', deliveryService: 'VET', totalCents: 1 });
    expect(res.status).toBe(200);
    expect(res.body.subtotalCents).toBe(2500);
  });

  it('rejects hidden products with their ids', async () => {
    await ctx.prisma.product.update({ where: { id: mouse.id }, data: { isActive: false } });
    const res = await quote(agent, { items: [{ productId: mouse.id, quantity: 1 }], region: 'PHNOM_PENH', deliveryService: 'VET' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'PRODUCT_UNAVAILABLE', details: { productIds: [mouse.id] } });
  });

  it('reports items over the available stock', async () => {
    const res = await quote(agent, { items: [{ productId: mouse.id, quantity: 6 }], region: 'PHNOM_PENH', deliveryService: 'VET' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'OUT_OF_STOCK', details: { items: [{ productId: mouse.id, available: 5 }] } });
  });

  it('merges duplicate cart lines', async () => {
    const res = await quote(agent, {
      items: [{ productId: mouse.id, quantity: 1 }, { productId: mouse.id, quantity: 2 }],
      region: 'PHNOM_PENH',
      deliveryService: 'VET',
    });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].quantity).toBe(3);
  });

  it('places a cash-on-delivery order and takes the stock', async () => {
    const res = await order(agent, orderBody({ items: [{ productId: mouse.id, quantity: 2 }] }));
    expect(res.status).toBe(201);
    expect(res.body.number).toMatch(/^CS-\d{6}$/);
    expect(res.body).toMatchObject({ status: 'PENDING', totalCents: 4350, contactPhone: '+85512345678' });
    expect(res.body.payment).toMatchObject({ method: 'COD', status: 'UNPAID', amountCents: 4350 });
    expect(res.body.events).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'PENDING' })]);
    expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: mouse.id } })).stock).toBe(3);
  });

  it('offers cash on delivery only in Phnom Penh, and not KHQR yet', async () => {
    const province = await order(agent, orderBody({ region: 'PROVINCE' }));
    expect(province.status).toBe(422);
    expect(province.body.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    const khqr = await order(agent, orderBody({ paymentMethod: 'KHQR' }));
    expect(khqr.status).toBe(422);
    expect(khqr.body.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
  });

  it('sells the last unit to exactly one of two simultaneous buyers', async () => {
    const last = await createProduct(ctx.prisma, { stock: 1 });
    const { agent: other } = await signedInAgent(ctx.app, ctx.prisma);
    const body = orderBody({ items: [{ productId: last.id, quantity: 1 }] });
    const results = await Promise.all([order(agent, body), order(other, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('OUT_OF_STOCK');
    expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: last.id } })).stock).toBe(0);
  });

  it('creates one order for a repeated Idempotency-Key', async () => {
    const a = await order(agent, orderBody(), 'tap-1');
    const b = await order(agent, orderBody(), 'tap-1');
    expect(a.status).toBe(201);
    expect([200, 201]).toContain(b.status);
    expect(b.body.id).toBe(a.body.id);
    expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: mouse.id } })).stock).toBe(4);
    expect(await ctx.prisma.order.count()).toBe(1);
  });

  it('creates one order when the same key arrives twice at once', async () => {
    const [a, b] = await Promise.all([order(agent, orderBody(), 'tap-2'), order(agent, orderBody(), 'tap-2')]);
    expect(a.body.id).toBe(b.body.id);
    expect(await ctx.prisma.order.count()).toBe(1);
  });

  it('enforces per-customer promo limits', async () => {
    await addPromo({ maxUsesPerUser: 1 });
    expect((await order(agent, orderBody({ promoCode: 'CAMBOKBSHOP' }))).status).toBe(201);
    const again = await order(agent, orderBody({ promoCode: 'CAMBOKBSHOP' }));
    expect(again.status).toBe(422);
    expect(again.body.error.details.reason).toBe('ALREADY_USED');
    const promo = await ctx.prisma.promoCode.findUniqueOrThrow({ where: { code: 'CAMBOKBSHOP' } });
    expect(promo.usedCount).toBe(1);
  });

  it("lists my orders and hides other customers' orders", async () => {
    const placed = await order(agent, orderBody());
    const mine = await agent.get('/api/v1/orders');
    expect(mine.body.items.map((o: { number: string }) => o.number)).toEqual([placed.body.number]);
    expect((await agent.get(`/api/v1/orders/${placed.body.number}`)).status).toBe(200);
    const { agent: other } = await signedInAgent(ctx.app, ctx.prisma);
    expect((await other.get(`/api/v1/orders/${placed.body.number}`)).status).toBe(404);
    expect((await other.get('/api/v1/orders')).body.items).toEqual([]);
  });

  it('saves a default address on the profile', async () => {
    const res = await agent
      .patch('/api/v1/me')
      .set('Origin', WEB_ORIGIN)
      .send({ name: 'Dara K', defaultAddress: { region: 'PHNOM_PENH', addressLine: 'St. 315', lat: 11.57, lng: 104.9 } });
    expect(res.status).toBe(200);
    const me = await agent.get('/api/v1/me');
    expect(me.body.user.name).toBe('Dara K');
    expect(me.body.defaultAddress).toMatchObject({ region: 'PHNOM_PENH', addressLine: 'St. 315' });
  });
});
