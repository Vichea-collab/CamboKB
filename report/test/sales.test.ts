import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db';
import { breakdown, salesSummary, topProducts } from '../src/sales';
import { resetDb, seedCatalog, seedOrder } from './seed';

const pool = createPool(process.env.DATABASE_URL_TEST!);
afterAll(() => pool.end());

describe('sales reports', () => {
  let ids: Awaited<ReturnType<typeof seedCatalog>>;
  beforeEach(async () => {
    await resetDb();
    ids = await seedCatalog();
    const { user, mouse, pad } = ids;
    const m = (q: number) => ({ productId: mouse.id, name: mouse.name, priceCents: 2100, quantity: q });
    const p = (q: number) => ({ productId: pad.id, name: pad.name, priceCents: 600, quantity: q });
    await seedOrder({ userId: user.id, at: '2026-11-10T02:00:00Z', items: [m(2)] }); // $44
    await seedOrder({ userId: user.id, at: '2026-11-10T05:00:00Z', items: [p(3)], deliveryFeeCents: 300, region: 'PROVINCE' }); // $21
    await seedOrder({ userId: user.id, at: '2026-11-10T06:00:00Z', items: [m(5)], status: 'CANCELLED' });
    await seedOrder({ userId: user.id, at: '2026-11-10T18:30:00Z', items: [m(1)] }); // 11th in Phnom Penh, $23
    await seedOrder({ userId: user.id, at: '2026-11-12T01:00:00Z', items: [p(1)] }); // $8
  });

  it('groups revenue by Phnom Penh day, including empty days', async () => {
    const r = await salesSummary(pool, { from: '2026-11-10', to: '2026-11-13', groupBy: 'day' });
    expect(r.buckets).toEqual([
      { period: '2026-11-10', orders: 2, units: 5, revenueCents: 6500 },
      { period: '2026-11-11', orders: 1, units: 1, revenueCents: 2300 },
      { period: '2026-11-12', orders: 1, units: 1, revenueCents: 800 },
      { period: '2026-11-13', orders: 0, units: 0, revenueCents: 0 },
    ]);
    expect(r.totals).toEqual({ orders: 4, units: 7, revenueCents: 9600, averageOrderCents: 2400 });
  });

  it('groups by month', async () => {
    const r = await salesSummary(pool, { from: '2026-11-01', to: '2026-11-30', groupBy: 'month' });
    expect(r.buckets).toEqual([{ period: '2026-11', orders: 4, units: 7, revenueCents: 9600 }]);
  });

  it('ranks top products by revenue, excluding cancelled orders', async () => {
    const r = await topProducts(pool, { from: '2026-11-01', to: '2026-11-30' });
    expect(r).toEqual([
      { productId: ids.mouse.id, name: 'Attack Shark X11 White', units: 3, revenueCents: 6300 },
      { productId: ids.pad.id, name: 'Mousepad XL', units: 4, revenueCents: 2400 },
    ]);
  });

  it('breaks down by payment method and region', async () => {
    const r = await breakdown(pool, { from: '2026-11-01', to: '2026-11-30' });
    expect(r.byPaymentMethod).toEqual([{ method: 'COD', orders: 4, revenueCents: 9600 }]);
    expect(r.byRegion).toEqual([
      { region: 'PHNOM_PENH', orders: 3, revenueCents: 7500 },
      { region: 'PROVINCE', orders: 1, revenueCents: 2100 },
    ]);
  });
});
