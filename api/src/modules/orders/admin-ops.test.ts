import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventDeliveryError } from '../../integrations/services/events';
import {
  createProduct,
  createTestApp,
  resetDb,
  signedInAgent,
  WEB_ORIGIN,
} from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
type Agent = Awaited<ReturnType<typeof signedInAgent>>['agent'];

describe('admin operations', () => {
  let ctx: Ctx;
  let admin: Agent;
  let adminId: string;
  let customer: Agent;
  let customerId: string;
  let product: Awaited<ReturnType<typeof createProduct>>;

  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
    ({
      agent: admin,
      user: { id: adminId },
    } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN', name: 'Owner' }));
    ({
      agent: customer,
      user: { id: customerId },
    } = await signedInAgent(ctx.app, ctx.prisma, { name: 'Dara' }));
    product = await createProduct(ctx.prisma, {
      name: 'Attack Shark X11 White',
      priceCents: 2100,
      stock: 5,
    });
  });

  const placeOrder = async (over: Record<string, unknown> = {}) => {
    const res = await customer
      .post('/api/v1/orders')
      .set('Origin', WEB_ORIGIN)
      .send({
        items: [{ productId: product.id, quantity: 2 }],
        region: 'PHNOM_PENH',
        deliveryService: 'GRAB',
        pin: { lat: 11.58, lng: 104.89 },
        contactName: 'Dara',
        contactPhone: '012345678',
        addressLine: 'St. 315',
        paymentMethod: 'COD',
        ...over,
      });
    expect(res.status).toBe(201);
    return res.body as { id: string; number: string };
  };
  const setStatus = (id: string, status: string, note?: string) =>
    admin
      .post(`/api/v1/admin/orders/${id}/status`)
      .set('Origin', WEB_ORIGIN)
      .send({ status, note });

  it('moves an order forward and records who did it', async () => {
    const o = await placeOrder();
    const res = await setStatus(o.id, 'CONFIRMED', 'Called customer');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CONFIRMED');
    const event = await ctx.prisma.orderStatusEvent.findFirstOrThrow({
      where: { orderId: o.id, toStatus: 'CONFIRMED' },
    });
    expect(event).toMatchObject({
      fromStatus: 'PENDING',
      note: 'Called customer',
      actorUserId: adminId,
    });
  });

  it('refuses invalid status changes', async () => {
    const o = await placeOrder();
    await setStatus(o.id, 'DELIVERED');
    const res = await setStatus(o.id, 'PENDING');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('cancelling gives the stock back', async () => {
    const o = await placeOrder();
    expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(
      3,
    );
    expect((await setStatus(o.id, 'CANCELLED', 'Customer changed mind')).status).toBe(200);
    expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(
      5,
    );
  });

  it('marks cash payments as paid', async () => {
    const o = await placeOrder();
    const res = await admin
      .post(`/api/v1/admin/orders/${o.id}/payment`)
      .set('Origin', WEB_ORIGIN)
      .send({ status: 'PAID' });
    expect(res.status).toBe(200);
    expect(res.body.payment.status).toBe('PAID');
    expect(res.body.payment.paidAt).toBeTruthy();
  });

  it('filters orders by status and finds them by number or phone', async () => {
    const a = await placeOrder();
    await placeOrder();
    await setStatus(a.id, 'CONFIRMED');
    const confirmed = await admin.get('/api/v1/admin/orders').query({ status: 'CONFIRMED' });
    expect(confirmed.body.items.map((o: { id: string }) => o.id)).toEqual([a.id]);
    expect(
      (await admin.get('/api/v1/admin/orders').query({ q: a.number })).body.items,
    ).toHaveLength(1);
    expect((await admin.get('/api/v1/admin/orders').query({ q: '012 345 678' })).body.total).toBe(
      2,
    );
    const detail = await admin.get(`/api/v1/admin/orders/${a.id}`);
    expect(detail.body.customer).toMatchObject({ id: customerId, name: 'Dara' });
  });

  it('manages promo codes and rejects duplicates', async () => {
    const body = { code: 'newyear', type: 'PERCENT', value: 10 };
    const created = await admin.post('/api/v1/admin/promos').set('Origin', WEB_ORIGIN).send(body);
    expect(created.status).toBe(201);
    expect(created.body.code).toBe('NEWYEAR');
    const dup = await admin.post('/api/v1/admin/promos').set('Origin', WEB_ORIGIN).send(body);
    expect(dup.status).toBe(409);
    const updated = await admin
      .patch(`/api/v1/admin/promos/${created.body.id}`)
      .set('Origin', WEB_ORIGIN)
      .send({ ...body, isActive: false });
    expect(updated.body.isActive).toBe(false);
    expect((await admin.get('/api/v1/admin/promos')).body.items).toHaveLength(1);
  });

  it('disabling a customer ends their sessions; admins cannot disable themselves', async () => {
    const res = await admin
      .post(`/api/v1/admin/customers/${customerId}/disable`)
      .set('Origin', WEB_ORIGIN);
    expect(res.status).toBe(200);
    expect((await customer.get('/api/v1/auth/me')).status).toBe(401);
    const self = await admin
      .post(`/api/v1/admin/customers/${adminId}/disable`)
      .set('Origin', WEB_ORIGIN);
    expect(self.status).toBe(400);
  });

  it('lists customers with order counts and spend', async () => {
    const o = await placeOrder();
    await setStatus(o.id, 'DELIVERED');
    const res = await admin.get('/api/v1/admin/customers').query({ q: 'dara' });
    expect(res.body.items).toEqual([
      expect.objectContaining({
        id: customerId,
        orderCount: 1,
        totalSpentCents: o ? 4200 + 150 : 0,
      }),
    ]);
  });

  it('reads and updates store settings', async () => {
    const current = await admin.get('/api/v1/admin/settings');
    expect(current.body.delivery.provinceFeeCents).toBe(200);
    const res = await admin
      .put('/api/v1/admin/settings')
      .set('Origin', WEB_ORIGIN)
      .send({
        ...current.body,
        storeName: 'Cambo Supply KH',
        delivery: { ...current.body.delivery, provinceFeeCents: 250 },
      });
    expect(res.status).toBe(200);
    const quote = await customer
      .post('/api/v1/checkout/quote')
      .set('Origin', WEB_ORIGIN)
      .send({
        items: [{ productId: product.id, quantity: 1 }],
        region: 'PROVINCE',
        deliveryService: 'VET',
      });
    expect(quote.body.deliveryFeeCents).toBe(250);
  });

  it("reports today's orders, pending count and low stock", async () => {
    await placeOrder({ items: [{ productId: product.id, quantity: 3 }] });
    const res = await admin.get('/api/v1/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body.today).toEqual({ orders: 1, revenueCents: 6300 + 150 });
    expect(res.body.pendingCount).toBe(1);
    expect(res.body.lowStock).toEqual([
      { id: product.id, name: 'Attack Shark X11 White', stock: 2 },
    ]);
  });

  it('counts orders per status for the Orders tabs', async () => {
    await ctx.prisma.product.update({ where: { id: product.id }, data: { stock: 20 } });
    const a = await placeOrder();
    await placeOrder();
    await placeOrder();
    await setStatus(a.id, 'CONFIRMED');
    const res = await admin.get('/api/v1/admin/orders/counts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      all: 3,
      PENDING: 2,
      CONFIRMED: 1,
      PACKED: 0,
      SHIPPING: 0,
      DELIVERED: 0,
      CANCELLED: 0,
    });
  });

  it('keeps the order counts for admins only', async () => {
    expect((await customer.get('/api/v1/admin/orders/counts')).status).toBe(403);
  });

  it('shows how many KHQR payments are waiting for money', async () => {
    expect((await admin.get('/api/v1/admin/stats')).body.khqrWaitingCount).toBe(0);
    await placeOrder({
      region: 'PROVINCE',
      deliveryService: 'VET',
      pin: undefined,
      paymentMethod: 'KHQR',
    });
    await placeOrder(); // cash on delivery doesn't count
    expect((await admin.get('/api/v1/admin/stats')).body.khqrWaitingCount).toBe(1);
  });

  it('queues what the report and notification services need, in the same transaction as the order', async () => {
    const o = await placeOrder({ note: '<b>ring twice</b>' });
    const rows = await ctx.prisma.serviceEvent.findMany({ orderBy: { createdAt: 'asc' } });
    // The product only had 5 in stock, so taking 2 leaves it low: the owner is warned too.
    expect(rows.map((r) => `${r.target}:${r.type}`).sort()).toEqual([
      'notification:order.placed',
      'notification:product.low_stock',
      'report:order.snapshot',
    ]);
    const placed = rows.find((r) => r.type === 'order.placed')!.payload as {
      order: { number: string; note: string; items: { name: string; quantity: number }[] };
      adminAlerts: boolean;
      holdMinutes: number;
    };
    expect(placed.order.number).toBe(o.number);
    expect(placed.order.note).toBe('<b>ring twice</b>'); // escaping is the notification service's job
    expect(placed.order.items).toMatchObject([{ name: 'Attack Shark X11 White', quantity: 2 }]);
    expect(placed).toMatchObject({ adminAlerts: true, holdMinutes: 10 });
    await vi.waitFor(() => expect(ctx.events.sent).toHaveLength(3)); // and delivered right away
  });

  it('still places the order, and keeps the events waiting, when the other services are down', async () => {
    ctx.events.failWith = new EventDeliveryError('notification unreachable', true);
    await placeOrder();
    await vi.waitFor(async () =>
      expect(
        await ctx.prisma.serviceEvent.count({ where: { attempts: { gt: 0 } } }),
      ).toBeGreaterThan(0),
    );
    expect(await ctx.prisma.serviceEvent.count({ where: { status: 'PENDING' } })).toBe(3); // snapshot, placed, low stock
    expect(await ctx.prisma.order.count()).toBe(1);
  });

  it('passes the settings switch for owner alerts on, so the notification service can skip them', async () => {
    await ctx.prisma.storeSetting.update({ where: { id: 1 }, data: { telegramNotify: false } });
    await placeOrder();
    const placed = await ctx.prisma.serviceEvent.findFirstOrThrow({
      where: { type: 'order.placed' },
    });
    expect((placed.payload as { adminAlerts: boolean }).adminAlerts).toBe(false);
  });
});
