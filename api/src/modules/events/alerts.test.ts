import { beforeEach, describe, expect, it } from 'vitest';
import { createProduct, createTestApp, resetDb, signedInAgent, WEB_ORIGIN } from '../../../test/helpers';
import { eventsIdle } from './outbox';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

describe('owner alerts: stock', () => {
  let ctx: Ctx;
  let customer: Awaited<ReturnType<typeof signedInAgent>>['agent'];
  let product: Awaited<ReturnType<typeof createProduct>>;

  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
    ({ agent: customer } = await signedInAgent(ctx.app, ctx.prisma, { name: 'Dara' }));
    product = await createProduct(ctx.prisma, { name: 'Attack Shark X11 White', priceCents: 2100, stock: 5 });
  });

  const order = async (quantity: number) => {
    const res = await customer.post('/api/v1/orders').set('Origin', WEB_ORIGIN).send({
      items: [{ productId: product.id, quantity }],
      region: 'PHNOM_PENH',
      deliveryService: 'VET',
      contactName: 'Dara',
      contactPhone: '012345678',
      addressLine: 'St. 315',
      paymentMethod: 'COD',
    });
    expect(res.status).toBe(201);
    await eventsIdle();
    return res.body as { id: string };
  };
  const stockEvents = () => ctx.events.data('product.low_stock').map((e) => e.stock);

  it('warns when 3 are left, and again when it runs out', async () => {
    await order(1); // 4 left: still fine
    expect(stockEvents()).toEqual([]);
    await order(1); // 3 left: low
    expect(stockEvents()).toEqual([3]);
    await order(2); // 1 left: already warned
    expect(stockEvents()).toEqual([3]);
    await order(1); // 0 left: sold out
    expect(stockEvents()).toEqual([3, 0]);
    expect(ctx.events.data('product.low_stock')[1]).toMatchObject({ productId: product.id, name: 'Attack Shark X11 White', adminAlerts: true });
  });

  it('warns about a sold-out product even when it jumps straight past the low-stock line', async () => {
    await order(5);
    expect(stockEvents()).toEqual([0]);
  });

  it('does not warn when stock goes back up (an order cancelled)', async () => {
    const o = await order(4); // 1 left: low
    expect(stockEvents()).toEqual([1]);
    const { agent: admin } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' });
    await admin.post(`/api/v1/admin/orders/${o.id}/status`).set('Origin', WEB_ORIGIN).send({ status: 'CANCELLED' });
    await eventsIdle();
    expect(stockEvents()).toEqual([1]);
    // The owner's group is told about the cancellation.
    expect(ctx.events.data('order.status_changed').at(-1)).toMatchObject({ order: { status: 'CANCELLED' }, adminAlerts: true });
  });
});
