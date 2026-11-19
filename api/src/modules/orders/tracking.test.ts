import { beforeEach, describe, expect, it } from 'vitest';
import { createProduct, createTestApp, resetDb, signedInAgent, WEB_ORIGIN } from '../../../test/helpers';
import { eventsIdle } from '../events/outbox';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
type Agent = Awaited<ReturnType<typeof signedInAgent>>['agent'];

describe('order tracking numbers', () => {
  let ctx: Ctx;
  let admin: Agent;
  let customer: Agent;
  let order: { id: string; number: string };

  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
    ({ agent: admin } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' }));
    ({ agent: customer } = await signedInAgent(ctx.app, ctx.prisma, { name: 'Dara', telegramUserId: 7001 }));
    const product = await createProduct(ctx.prisma, { priceCents: 2100, stock: 5 });
    const res = await customer.post('/api/v1/orders').set('Origin', WEB_ORIGIN).send({
      items: [{ productId: product.id, quantity: 1 }],
      region: 'PROVINCE',
      deliveryService: 'VET',
      contactName: 'Dara',
      contactPhone: '012345678',
      addressLine: 'Siem Reap',
      paymentMethod: 'KHQR',
    });
    expect(res.status).toBe(201);
    order = res.body;
  });

  const setTracking = (id: string, trackingNumber: unknown) =>
    admin.post(`/api/v1/admin/orders/${id}/tracking`).set('Origin', WEB_ORIGIN).send({ trackingNumber });
  const announced = async () => {
    await eventsIdle();
    return ctx.events.data('order.tracking_set');
  };

  it('saves the number on the order, for the admin and the customer to see', async () => {
    const res = await setTracking(order.id, '  VET-778899 ');
    expect(res.status).toBe(200);
    expect(res.body.trackingNumber).toBe('VET-778899');
    const mine = await customer.get(`/api/v1/orders/${order.number}`);
    expect(mine.body.trackingNumber).toBe('VET-778899');
  });

  it('tells the customer on Telegram, once per number', async () => {
    await setTracking(order.id, 'VET-778899');
    await setTracking(order.id, 'VET-778899');
    const events = await announced();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ customerChatId: '7001', order: { number: order.number, trackingNumber: 'VET-778899' } });
    await setTracking(order.id, 'VET-000111');
    expect(await announced()).toHaveLength(2);
  });

  it('clears the number without telling the customer', async () => {
    await setTracking(order.id, 'VET-778899');
    const res = await setTracking(order.id, null);
    expect(res.status).toBe(200);
    expect(res.body.trackingNumber).toBeNull();
    expect((await setTracking(order.id, '   ')).body.trackingNumber).toBeNull();
    expect(await announced()).toHaveLength(1);
  });

  it('refuses a number that is far too long, and anyone who is not an admin', async () => {
    expect((await setTracking(order.id, 'X'.repeat(61))).status).toBe(400);
    const res = await customer.post(`/api/v1/admin/orders/${order.id}/tracking`).set('Origin', WEB_ORIGIN).send({ trackingNumber: 'A' });
    expect(res.status).toBe(403);
  });

  it('does not add a tracking number to a cancelled order', async () => {
    await admin.post(`/api/v1/admin/orders/${order.id}/status`).set('Origin', WEB_ORIGIN).send({ status: 'CANCELLED' });
    const res = await setTracking(order.id, 'VET-1');
    expect(res.status).toBe(409);
  });
});
