import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { slugify } from '../src/admin/products';
import { createCategory, createProduct, createTestApp, resetDb, signedInAgent, TINY_PNG, WEB_ORIGIN } from './helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

describe('slugify', () => {
  it.each([
    ['Attack Shark X11 White', 'attack-shark-x11-white'],
    ['  Mousepad Xl Size 800x300x3mm ', 'mousepad-xl-size-800x300x3mm'],
    ['Café — Déjà vu!!', 'cafe-deja-vu'],
    ['🔥🔥', 'item'],
  ])('%j → %s', (input, out) => {
    expect(slugify(input)).toBe(out);
  });
});

describe('admin catalog', () => {
  let ctx: Ctx;
  let admin: Awaited<ReturnType<typeof signedInAgent>>['agent'];
  let categoryId: string;

  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
    ({ agent: admin } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' }));
    categoryId = (await createCategory(ctx.prisma, { name: 'Mice', slug: 'mice' })).id;
  });

  const productBody = (over: Record<string, unknown> = {}) => ({
    name: 'Attack Shark X11 White',
    categoryId,
    specsLine: 'Tri-Mode Wireless',
    priceCents: 2100,
    stock: 5,
    specs: [{ label: 'Sensor', value: 'PAW3311' }],
    ...over,
  });
  const post = (path: string) => admin.post(`/api/v1/admin${path}`).set('Origin', WEB_ORIGIN);
  const patch = (path: string) => admin.patch(`/api/v1/admin${path}`).set('Origin', WEB_ORIGIN);
  const del = (path: string) => admin.delete(`/api/v1/admin${path}`).set('Origin', WEB_ORIGIN);

  it('creates products with unique slugs', async () => {
    const a = await post('/products').send(productBody());
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ slug: 'attack-shark-x11-white', priceCents: 2100, isActive: true });
    expect(a.body.specs).toEqual([{ label: 'Sensor', value: 'PAW3311' }]);
    const b = await post('/products').send(productBody());
    expect(b.body.slug).toBe('attack-shark-x11-white-2');
  });

  it('rejects invalid product input', async () => {
    const res = await post('/products').send(productBody({ priceCents: -1 }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('forbids customers', async () => {
    const { agent } = await signedInAgent(ctx.app, ctx.prisma);
    const res = await agent.post('/api/v1/admin/products').set('Origin', WEB_ORIGIN).send(productBody());
    expect(res.status).toBe(403);
  });

  it('updates a product and replaces its specs', async () => {
    const { body } = await post('/products').send(productBody());
    const res = await patch(`/products/${body.id}`).send({ priceCents: 1900, specs: [{ label: 'DPI', value: '26000' }] });
    expect(res.status).toBe(200);
    expect(res.body.priceCents).toBe(1900);
    expect(res.body.specs).toEqual([{ label: 'DPI', value: '26000' }]);
  });

  it('uploads, reorders and deletes product images', async () => {
    const { body: p } = await post('/products').send(productBody());
    const up = await post(`/products/${p.id}/images`).attach('files', TINY_PNG, 'a.png').attach('files', TINY_PNG, 'b.png');
    expect(up.status).toBe(201);
    expect(up.body.images).toHaveLength(2);
    const [first, second] = up.body.images.map((i: { id: string }) => i.id);

    const reordered = await patch(`/products/${p.id}/images/order`).send({ ids: [second, first] });
    expect(reordered.body.images.map((i: { id: string }) => i.id)).toEqual([second, first]);

    const removed = await del(`/products/${p.id}/images/${first}`);
    expect(removed.status).toBe(200);
    expect(removed.body.images).toHaveLength(1);
    expect(ctx.files.deleted).toHaveLength(1);
  });

  it('rejects non-image uploads', async () => {
    const { body: p } = await post('/products').send(productBody());
    const res = await post(`/products/${p.id}/images`).attach('files', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_IMAGE');
  });

  it('archives instead of deleting, hiding the product from the shop', async () => {
    const { body: p } = await post('/products').send(productBody());
    expect((await del(`/products/${p.id}`)).status).toBe(204);
    expect((await request(ctx.app).get(`/api/v1/products/${p.slug}`)).status).toBe(404);
    const hidden = await admin.get('/api/v1/admin/products').query({ status: 'hidden' });
    expect(hidden.body.items.map((x: { id: string }) => x.id)).toEqual([p.id]);
  });

  it('reorders products', async () => {
    const a = await createProduct(ctx.prisma, { categoryId, name: 'A' });
    const b = await createProduct(ctx.prisma, { categoryId, name: 'B' });
    expect((await post('/products/reorder').send({ ids: [b.id, a.id] })).status).toBe(204);
    const list = await request(ctx.app).get('/api/v1/products');
    expect(list.body.items.map((x: { name: string }) => x.name)).toEqual(['B', 'A']);
  });

  it('manages categories and refuses to delete one in use', async () => {
    const created = await post('/categories').send({ name: 'Keyboards' });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe('keyboards');
    await createProduct(ctx.prisma, { categoryId });
    const res = await del(`/categories/${categoryId}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CATEGORY_IN_USE');
    expect((await del(`/categories/${created.body.id}`)).status).toBe(204);
  });

  it('manages banners', async () => {
    const created = await post('/banners').field('linkUrl', 'https://example.com/sale').attach('file', TINY_PNG, 'b.png');
    expect(created.status).toBe(201);
    expect((await request(ctx.app).get('/api/v1/banners')).body.items).toHaveLength(1);
    await patch(`/banners/${created.body.id}`).send({ isActive: false });
    expect((await request(ctx.app).get('/api/v1/banners')).body.items).toHaveLength(0);
    expect((await del(`/banners/${created.body.id}`)).status).toBe(204);
    expect(ctx.files.deleted).toContain(created.body.storageKey);
  });
});
