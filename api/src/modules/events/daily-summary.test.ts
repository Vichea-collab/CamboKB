import { LOW_STOCK_THRESHOLD } from '@cambo/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProduct, createTestApp, createUser, resetDb, signedInAgent, WEB_ORIGIN } from '../../../test/helpers';
import { sendDailySummary } from './daily-summary';
import { eventsIdle } from './outbox';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
// 25 November 2026 in Phnom Penh is 24 Nov 17:00 to 25 Nov 17:00 UTC.
const at = (iso: string) => new Date(iso);
const MORNING_AFTER = at('2026-11-26T01:00:00Z'); // 08:00 on the 26th

describe('daily summary', () => {
  let ctx: Ctx;
  const summaries = () => ctx.events.data('shop.daily_summary');

  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
  });

  async function placeOrder(createdAt: Date, over: object = {}) {
    const { agent } = await signedInAgent(ctx.app, ctx.prisma, { name: 'Dara' });
    const product = await createProduct(ctx.prisma, { priceCents: 2000, stock: 50 });
    const res = await agent.post('/api/v1/orders').set('Origin', WEB_ORIGIN).send({
      items: [{ productId: product.id, quantity: 1 }],
      region: 'PHNOM_PENH',
      deliveryService: 'VET',
      contactName: 'Dara',
      contactPhone: '012345678',
      addressLine: 'St. 315',
      paymentMethod: 'COD',
    });
    expect(res.status).toBe(201);
    return ctx.prisma.order.update({ where: { id: res.body.id }, data: { createdAt, ...over } });
  }

  it('waits until 8 in the morning in Phnom Penh, then sends yesterday once, whatever happens after', async () => {
    expect(await sendDailySummary(ctx.deps, at('2026-11-26T00:59:00Z'))).toBe(false);
    expect(await sendDailySummary(ctx.deps, MORNING_AFTER)).toBe(true);
    expect(await sendDailySummary(ctx.deps, at('2026-11-26T01:05:00Z'))).toBe(false);
    expect(await sendDailySummary(ctx.deps, at('2026-11-26T09:00:00Z'))).toBe(false);
    await eventsIdle();
    expect(summaries().map((s) => s.date)).toEqual(['2026-11-25']);
    expect(await sendDailySummary(ctx.deps, at('2026-11-27T01:00:00Z'))).toBe(true);
    await eventsIdle();
    expect(summaries().map((s) => s.date)).toEqual(['2026-11-25', '2026-11-26']);
  });

  it('counts that day only, and leaves cancelled orders out of the money', async () => {
    const first = await placeOrder(at('2026-11-24T17:00:00Z')); // 00:00 on the 25th
    const second = await placeOrder(at('2026-11-25T16:59:00Z')); // 23:59 on the 25th
    await placeOrder(at('2026-11-24T16:59:00Z'), { status: 'DELIVERED' }); // the 24th
    await placeOrder(at('2026-11-25T17:00:00Z'), { status: 'DELIVERED' }); // the 26th
    await placeOrder(at('2026-11-25T05:00:00Z'), { status: 'CANCELLED' });
    await ctx.prisma.user.updateMany({ data: { createdAt: at('2026-11-20T00:00:00Z') } });
    const newcomer = await createUser(ctx.prisma, { name: 'New' });
    await ctx.prisma.user.update({ where: { id: newcomer.id }, data: { createdAt: at('2026-11-25T03:00:00Z') } });
    await ctx.prisma.product.updateMany({ data: { stock: 50 } });
    await createProduct(ctx.prisma, { stock: LOW_STOCK_THRESHOLD });
    await createProduct(ctx.prisma, { stock: 0 });

    await sendDailySummary(ctx.deps, MORNING_AFTER);
    await eventsIdle();
    expect(summaries()).toEqual([
      {
        date: '2026-11-25',
        orders: 2,
        revenueCents: first.totalCents + second.totalCents,
        cancelled: 1,
        newCustomers: 1,
        pending: 2,
        lowStock: 2,
        refundsDue: 0,
        adminAlerts: true,
      },
    ]);
  });

  it('leaves out KHQR orders that are waiting for money, or never got it', async () => {
    const waiting = await placeOrder(at('2026-11-25T05:00:00Z'));
    const expired = await placeOrder(at('2026-11-25T06:00:00Z'), { status: 'CANCELLED' });
    await placeOrder(at('2026-11-25T07:00:00Z'));
    await ctx.prisma.payment.update({ where: { orderId: waiting.id }, data: { method: 'KHQR', status: 'PENDING' } });
    await ctx.prisma.payment.update({ where: { orderId: expired.id }, data: { method: 'KHQR', status: 'EXPIRED' } });
    await sendDailySummary(ctx.deps, MORNING_AFTER);
    await eventsIdle();
    expect(summaries()).toMatchObject([{ orders: 1, cancelled: 0, pending: 1 }]);
  });

  it('follows the owner’s alert switch', async () => {
    await ctx.prisma.storeSetting.update({ where: { id: 1 }, data: { telegramNotify: false } });
    await sendDailySummary(ctx.deps, MORNING_AFTER);
    await eventsIdle();
    expect(summaries()).toMatchObject([{ adminAlerts: false }]);
  });
});
