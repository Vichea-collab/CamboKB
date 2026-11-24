import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMetrics } from '@cambo/service-kit';
import { createCache } from '../../lib/cache';
import { createLogger } from '../../lib/logger';
import {
  createCategory,
  createProduct,
  createTestApp,
  FailingCacheStore,
  memoryCache,
  resetDb,
  signedInAgent,
  WEB_ORIGIN,
} from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
type Agent = Awaited<ReturnType<typeof signedInAgent>>['agent'];

describe('catalogue cache is cleared when data or stock changes', () => {
  let ctx: Ctx;
  let admin: Agent;
  let customer: Agent;
  let mouse: Awaited<ReturnType<typeof createProduct>>;

  const start = async (overrides: Parameters<typeof createTestApp>[0] = { cache: memoryCache() }) => {
    ctx = await createTestApp(overrides);
    ({ agent: admin } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' }));
    ({ agent: customer } = await signedInAgent(ctx.app, ctx.prisma));
    mouse = await createProduct(ctx.prisma, { name: 'Attack Shark X11', priceCents: 2100, stock: 1 });
  };
  beforeEach(async () => {
    await resetDb();
    await start();
  });

  const list = async () => (await request(ctx.app).get('/api/v1/products')).body.items as { priceCents: number; isSoldOut: boolean }[];
  const adminPatch = (path: string, body: object) => admin.patch(`/api/v1/admin${path}`).set('Origin', WEB_ORIGIN).send(body);
  const placeOrder = () =>
    customer
      .post('/api/v1/orders')
      .set('Origin', WEB_ORIGIN)
      .send({
        items: [{ productId: mouse.id, quantity: 1 }],
        region: 'PHNOM_PENH',
        deliveryService: 'VET',
        contactName: 'Dara',
        contactPhone: '012 345 678',
        addressLine: 'St. 315, Toul Kork',
        paymentMethod: 'COD',
      });

  it('an admin product edit shows on the next public list', async () => {
    expect((await list())[0]!.priceCents).toBe(2100);
    expect((await adminPatch(`/products/${mouse.id}`, { priceCents: 1900 })).status).toBe(200);
    expect((await list())[0]!.priceCents).toBe(1900);
  });

  it('an admin category write shows on the next categories list', async () => {
    const names = async () => (await request(ctx.app).get('/api/v1/categories')).body.items.map((c: { name: string }) => c.name);
    const before = await names();
    const res = await admin.post('/api/v1/admin/categories').set('Origin', WEB_ORIGIN).send({ name: 'Mousepads' });
    expect(res.status).toBe(201);
    expect(await names()).toEqual([...before, 'Mousepads']);
  });

  it('an admin banner write shows on the next banners list', async () => {
    const banner = await ctx.prisma.banner.create({ data: { storageKey: 'banners/00000000-0000-4000-8000-000000000005', width: 1400, height: 500 } });
    const count = async () => (await request(ctx.app).get('/api/v1/banners')).body.items.length;
    expect(await count()).toBe(1);
    expect((await adminPatch(`/banners/${banner.id}`, { isActive: false })).status).toBe(200);
    expect(await count()).toBe(0);
  });

  it('an admin product delete shows on the next public list', async () => {
    expect(await list()).toHaveLength(1);
    const res = await admin.delete(`/api/v1/admin/products/${mouse.id}`).set('Origin', WEB_ORIGIN);
    expect(res.status).toBeLessThan(300);
    expect(await list()).toHaveLength(0);
  });

  it('a rejected admin write (400) and admin reads do not invalidate', async () => {
    const spy = vi.spyOn(ctx.deps.cache, 'invalidate');
    expect((await adminPatch(`/products/${mouse.id}`, { priceCents: -5 })).status).toBe(400);
    expect((await admin.get('/api/v1/admin/products')).status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('placing an order shows the lower stock at once', async () => {
    expect((await list())[0]!.isSoldOut).toBe(false);
    expect((await placeOrder()).status).toBe(201);
    expect((await list())[0]!.isSoldOut).toBe(true);
  });

  it('an admin cancellation shows the stock back at once', async () => {
    const placed = await placeOrder();
    expect(placed.status).toBe(201);
    expect((await list())[0]!.isSoldOut).toBe(true);
    const res = await admin.post(`/api/v1/admin/orders/${placed.body.id}/status`).set('Origin', WEB_ORIGIN).send({ status: 'CANCELLED' });
    expect(res.status).toBe(200);
    expect((await list())[0]!.isSoldOut).toBe(false);
  });

  it('an order and an admin edit still succeed when the cache store is failing', async () => {
    await resetDb();
    const failing = createCache({ store: new FailingCacheStore(), metrics: createMetrics('api'), logger: createLogger('silent') });
    await start({ cache: failing });
    expect((await list())[0]!.priceCents).toBe(2100);
    expect((await adminPatch(`/products/${mouse.id}`, { priceCents: 1900 })).status).toBe(200);
    expect((await list())[0]!.priceCents).toBe(1900);
    expect((await placeOrder()).status).toBe(201);
    expect((await list())[0]!.isSoldOut).toBe(true);
  });

  it('unrelated admin reads keep working', async () => {
    await createCategory(ctx.prisma, { name: 'Misc', slug: 'misc' });
    expect((await admin.get('/api/v1/admin/products')).status).toBe(200);
  });
});
