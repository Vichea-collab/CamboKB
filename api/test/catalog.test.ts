import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCategory, createProduct, createTestApp, resetDb } from './helpers';

describe('public catalog', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
  });

  it('lists active products only and 404s hidden ones', async () => {
    await createProduct(ctx.prisma, { name: 'Visible', slug: 'visible' });
    await createProduct(ctx.prisma, { name: 'Hidden', slug: 'hidden', isActive: false });
    const res = await request(ctx.app).get('/api/v1/products');
    expect(res.status).toBe(200);
    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual(['Visible']);
    expect(res.body.total).toBe(1);
    expect((await request(ctx.app).get('/api/v1/products/hidden')).status).toBe(404);
  });

  it('searches name, specs line, description and category, case-insensitively', async () => {
    const mice = await createCategory(ctx.prisma, { name: 'Mice', slug: 'mice' });
    await createProduct(ctx.prisma, { name: 'Attack Shark X11 White', categoryId: mice.id });
    await createProduct(ctx.prisma, { name: 'Aula F75', specsLine: '75% Layout • Hot-Swap' });
    const q = async (term: string) =>
      (await request(ctx.app).get('/api/v1/products').query({ q: term })).body.items.map((p: { name: string }) => p.name);
    expect(await q('attack')).toEqual(['Attack Shark X11 White']);
    expect(await q('hot-swap')).toEqual(['Aula F75']);
    expect(await q('MICE')).toEqual(['Attack Shark X11 White']);
  });

  it('filters by category slug', async () => {
    const mice = await createCategory(ctx.prisma, { name: 'Mice', slug: 'mice' });
    await createProduct(ctx.prisma, { name: 'Mouse', categoryId: mice.id });
    await createProduct(ctx.prisma, { name: 'Keyboard' });
    const res = await request(ctx.app).get('/api/v1/products').query({ category: 'mice' });
    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual(['Mouse']);
    expect(res.body.items[0].category).toEqual({ slug: 'mice', name: 'Mice' });
  });

  it('orders by sortOrder and paginates', async () => {
    await createProduct(ctx.prisma, { name: 'B', sortOrder: 2 });
    await createProduct(ctx.prisma, { name: 'A', sortOrder: 1 });
    await createProduct(ctx.prisma, { name: 'C', sortOrder: 3 });
    const res = await request(ctx.app).get('/api/v1/products').query({ pageSize: 2, page: 2 });
    expect(res.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual(['C']);
  });

  it('marks products with no stock as sold out', async () => {
    await createProduct(ctx.prisma, { slug: 'empty', stock: 0 });
    expect((await request(ctx.app).get('/api/v1/products/empty')).body.isSoldOut).toBe(true);
  });

  it('returns specs in order and image URLs on the public files host', async () => {
    await createProduct(ctx.prisma, {
      slug: 'aula',
      images: 3,
      specs: [
        { label: 'Layout', value: '75%' },
        { label: 'Switch', value: 'Linear' },
      ],
    });
    const res = await request(ctx.app).get('/api/v1/products/aula');
    expect(res.status).toBe(200);
    expect(res.body.specs).toEqual([
      { label: 'Layout', value: '75%' },
      { label: 'Switch', value: 'Linear' },
    ]);
    expect(res.body.images).toHaveLength(3);
    expect(res.body.images[0].sm).toMatch(/^http:\/\/localhost:4100\/files\/products\/.+-400\.webp$/);
    expect(res.body.images[0].lg).toMatch(/-1200\.webp$/);
    expect(res.body.imageCount).toBe(3);
  });

  it('looks up cart products by id and omits hidden ones', async () => {
    const a = await createProduct(ctx.prisma, { name: 'A' });
    const b = await createProduct(ctx.prisma, { name: 'B', isActive: false });
    const res = await request(ctx.app).get('/api/v1/products/by-ids').query({ ids: `${a.id},${b.id}` });
    expect(res.status).toBe(200);
    expect(res.body.items.map((p: { id: string }) => p.id)).toEqual([a.id]);
  });

  it('lists categories in order and active banners', async () => {
    await createCategory(ctx.prisma, { name: 'Second', slug: 'second', sortOrder: 2 });
    await createCategory(ctx.prisma, { name: 'First', slug: 'first', sortOrder: 1 });
    await ctx.prisma.banner.create({ data: { storageKey: 'banners/00000000-0000-4000-8000-000000000001', width: 1400, height: 500, isActive: true } });
    await ctx.prisma.banner.create({ data: { storageKey: 'banners/00000000-0000-4000-8000-000000000002', width: 1400, height: 500, isActive: false } });
    const cats = await request(ctx.app).get('/api/v1/categories');
    expect(cats.body.items.map((c: { slug: string }) => c.slug)).toEqual(['first', 'second']);
    const banners = await request(ctx.app).get('/api/v1/banners');
    expect(banners.body.items).toHaveLength(1);
    expect(banners.body.items[0].image.md).toMatch(/-800\.webp$/);
  });
});
