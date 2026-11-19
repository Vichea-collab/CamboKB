import { beforeEach, describe, expect, it } from 'vitest';
import { createProduct, createTestApp, resetDb, signedInAgent, WEB_ORIGIN } from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
type Agent = Awaited<ReturnType<typeof signedInAgent>>['agent'];

describe('refunds the shop still owes', () => {
  let ctx: Ctx;
  let admin: Agent;
  let customer: Agent;
  let product: Awaited<ReturnType<typeof createProduct>>;

  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
    ({ agent: admin } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' }));
    ({ agent: customer } = await signedInAgent(ctx.app, ctx.prisma, { name: 'Dara' }));
    product = await createProduct(ctx.prisma, { priceCents: 2100, stock: 20 });
  });

  const place = async () => {
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
    return res.body as { id: string; number: string };
  };
  const post = (path: string, body: object) => admin.post(`/api/v1/admin/orders/${path}`).set('Origin', WEB_ORIGIN).send(body);
  const refundsDue = async () => (await admin.get('/api/v1/admin/stats')).body.refundsDue as { orderId: string; number: string; amountCents: number }[];

  it('lists an order that was cancelled after it was paid, with the amount to send back', async () => {
    const o = await place();
    await post(`${o.id}/payment`, { status: 'PAID' });
    await post(`${o.id}/status`, { status: 'CANCELLED' });
    expect(await refundsDue()).toEqual([{ orderId: o.id, number: o.number, amountCents: 2300 }]);
  });

  it('does not list orders that are unpaid, still open, or already refunded', async () => {
    const unpaid = await place();
    await post(`${unpaid.id}/status`, { status: 'CANCELLED' }); // cancelled, nothing was paid
    const open = await place();
    await post(`${open.id}/payment`, { status: 'PAID' }); // paid and still going ahead
    const done = await place();
    await post(`${done.id}/payment`, { status: 'PAID' });
    await post(`${done.id}/status`, { status: 'CANCELLED' });
    await post(`${done.id}/payment`, { status: 'REFUNDED' });
    expect(await refundsDue()).toEqual([]);
  });

  it('stops listing it once it is marked as refunded', async () => {
    const o = await place();
    await post(`${o.id}/payment`, { status: 'PAID' });
    await post(`${o.id}/status`, { status: 'CANCELLED' });
    expect(await refundsDue()).toHaveLength(1);
    expect((await post(`${o.id}/payment`, { status: 'REFUNDED' })).body.payment.status).toBe('REFUNDED');
    expect(await refundsDue()).toEqual([]);
  });
});
