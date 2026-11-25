import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCategory, createProduct, createTestApp, memoryCache, resetDb } from '../../../test/helpers';

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

  it('finds products despite a typo, a missing letter or a split word', async () => {
    await createProduct(ctx.prisma, { name: 'Mechanical Keyboard K8', specsLine: 'Hot-Swap' });
    await createProduct(ctx.prisma, { name: 'Wireless Gaming Mouse' });
    const q = async (term: string) =>
      (await request(ctx.app).get('/api/v1/products').query({ q: term })).body.items.map(
        (p: { name: string }) => p.name,
      );
    expect(await q('keybord')).toEqual(['Mechanical Keyboard K8']);
    expect(await q('wirless mouse')).toEqual(['Wireless Gaming Mouse']);
    expect(await q('mechancal')).toEqual(['Mechanical Keyboard K8']);
    expect(await q('zzzzqqq')).toEqual([]);
  });

  it('understands plurals and the shop\'s own words, so "wireless mouse" finds a wireless product in Mice', async () => {
    const mice = await createCategory(ctx.prisma, { name: 'Mice', slug: 'mice' });
    const pads = await createCategory(ctx.prisma, { name: 'Mousepads', slug: 'mousepads' });
    await createProduct(ctx.prisma, {
      name: 'Attack Shark X11 White',
      specsLine: 'Wireless • 2.4G',
      categoryId: mice.id,
    });
    await createProduct(ctx.prisma, { name: 'Wired Gaming Mouse G1', categoryId: mice.id });
    await createProduct(ctx.prisma, { name: 'Desk Mat XL', categoryId: pads.id });
    await createProduct(ctx.prisma, { name: 'Aula F75 Keyboard' });
    const q = async (term: string) =>
      (await request(ctx.app).get('/api/v1/products').query({ q: term })).body.items.map(
        (p: { name: string }) => p.name,
      );
    expect(await q('wireless mouse')).toEqual(['Attack Shark X11 White']);
    expect(await q('wirless mouse')).toEqual(['Attack Shark X11 White']);
    expect((await q('mouse')).slice(0, 2).sort()).toEqual([
      'Attack Shark X11 White',
      'Wired Gaming Mouse G1',
    ]);
    expect(await q('keyboards')).toEqual(['Aula F75 Keyboard']);
    expect(await q('keeb')).toEqual(['Aula F75 Keyboard']);
    expect(await q('mousepad')).toContain('Desk Mat XL');
  });

  it('puts the best match first when a search is given', async () => {
    await createProduct(ctx.prisma, {
      name: 'Desk Mat',
      description: 'Fits a keyboard and a mouse',
      sortOrder: 1,
    });
    await createProduct(ctx.prisma, { name: 'Keyboard Cover', sortOrder: 2 });
    await createProduct(ctx.prisma, { name: 'Keyboard', sortOrder: 3 });
    const res = await request(ctx.app).get('/api/v1/products').query({ q: 'keyboard' });
    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual([
      'Keyboard',
      'Keyboard Cover',
      'Desk Mat',
    ]);
    expect(res.body.total).toBe(3);
  });

  it('filters by a price range in dollars, together with search and category', async () => {
    const mice = await createCategory(ctx.prisma, { name: 'Mice', slug: 'mice' });
    await createProduct(ctx.prisma, { name: 'Cheap Mouse', priceCents: 1500, categoryId: mice.id });
    await createProduct(ctx.prisma, { name: 'Mid Mouse', priceCents: 3000, categoryId: mice.id });
    await createProduct(ctx.prisma, { name: 'Pro Mouse', priceCents: 9000, categoryId: mice.id });
    await createProduct(ctx.prisma, { name: 'Mid Keyboard', priceCents: 3000 });
    const names = async (query: Record<string, string>) =>
      (await request(ctx.app).get('/api/v1/products').query(query)).body.items.map(
        (p: { name: string }) => p.name,
      );
    expect(await names({ minPrice: '20' })).toEqual(['Mid Mouse', 'Pro Mouse', 'Mid Keyboard']);
    expect(await names({ maxPrice: '30' })).toEqual(['Cheap Mouse', 'Mid Mouse', 'Mid Keyboard']);
    expect(await names({ minPrice: '20', maxPrice: '30' })).toEqual(['Mid Mouse', 'Mid Keyboard']);
    expect(await names({ minPrice: '20', maxPrice: '30', category: 'mice' })).toEqual([
      'Mid Mouse',
    ]);
    expect(await names({ minPrice: '20', maxPrice: '30', q: 'mouse' })).toEqual(['Mid Mouse']);
    expect(await names({ minPrice: '100' })).toEqual([]);
    expect(await names({ minPrice: '29.99', maxPrice: '30.00' })).toEqual([
      'Mid Mouse',
      'Mid Keyboard',
    ]);
  });

  it('treats % and _ in a search as plain characters, and ignores one- and two-letter guesses', async () => {
    await createProduct(ctx.prisma, { name: 'Aula F75' });
    await createProduct(ctx.prisma, { name: 'Mouse 100% Wireless' });
    const q = async (term: string) =>
      (await request(ctx.app).get('/api/v1/products').query({ q: term })).body.items.map(
        (p: { name: string }) => p.name,
      );
    expect(await q('%')).toEqual(['Mouse 100% Wireless']);
    expect(await q('_')).toEqual([]);
    expect(await q('zz')).toEqual([]);
  });

  it('rejects a price that is not a number or is negative', async () => {
    expect((await request(ctx.app).get('/api/v1/products').query({ minPrice: 'abc' })).status).toBe(
      400,
    );
    expect((await request(ctx.app).get('/api/v1/products').query({ maxPrice: '-5' })).status).toBe(
      400,
    );
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

  it('says how many are left only when stock is low, never the full inventory', async () => {
    await createProduct(ctx.prisma, { name: 'Plenty', slug: 'plenty', stock: 40 });
    await createProduct(ctx.prisma, { name: 'Some', slug: 'some', stock: 2 });
    await createProduct(ctx.prisma, { name: 'Last', slug: 'last', stock: 1 });
    await createProduct(ctx.prisma, { name: 'Gone', slug: 'gone', stock: 0 });
    const res = await request(ctx.app).get('/api/v1/products');
    const left = Object.fromEntries(res.body.items.map((p: { slug: string; lowStock: number | null }) => [p.slug, p.lowStock]));
    expect(left).toEqual({ plenty: null, some: null, last: 1, gone: null });
    expect(res.body.items.find((p: { slug: string }) => p.slug === 'plenty')).not.toHaveProperty('stock');
  });
});

describe('catalogue cache', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp({ cache: memoryCache() });
  });
  const names = async (query: Record<string, string> = {}) =>
    (await request(ctx.app).get('/api/v1/products').query(query)).body.items.map((p: { name: string }) => p.name);

  it('serves a repeated product list from the cache', async () => {
    const p = await createProduct(ctx.prisma, { name: 'Old name' });
    expect(await names()).toEqual(['Old name']);
    await ctx.prisma.product.update({ where: { id: p.id }, data: { name: 'New name' } });
    expect(await names()).toEqual(['Old name']);
  });

  it('shows the change after the catalogue is invalidated', async () => {
    const p = await createProduct(ctx.prisma, { name: 'Old name' });
    await names();
    await ctx.prisma.product.update({ where: { id: p.id }, data: { name: 'New name' } });
    await ctx.deps.cache.invalidate('catalog');
    expect(await names()).toEqual(['New name']);
  });

  it('keeps different queries apart', async () => {
    const mice = await createCategory(ctx.prisma, { name: 'Mice', slug: 'mice' });
    const keys = await createCategory(ctx.prisma, { name: 'Keyboards', slug: 'keyboards' });
    await createProduct(ctx.prisma, { name: 'Wireless Mouse', categoryId: mice.id, priceCents: 2000, sortOrder: 1 });
    await createProduct(ctx.prisma, { name: 'Mechanical Keyboard', categoryId: keys.id, priceCents: 9000, sortOrder: 2 });
    expect(await names({ q: 'mouse' })).toEqual(['Wireless Mouse']);
    expect(await names({ q: 'keyboard' })).toEqual(['Mechanical Keyboard']);
    expect(await names({ category: 'keyboards' })).toEqual(['Mechanical Keyboard']);
    expect(await names({ category: 'mice' })).toEqual(['Wireless Mouse']);
    expect(await names({ minPrice: '50' })).toEqual(['Mechanical Keyboard']);
    expect(await names({ pageSize: '1', page: '2' })).toEqual(['Mechanical Keyboard']);
    expect(await names({ pageSize: '1', page: '1' })).toEqual(['Wireless Mouse']);
    expect(await names()).toEqual(['Wireless Mouse', 'Mechanical Keyboard']);
  });

  it('search text with unicode, ":", "*" and spaces is cached under its own key and returns the right products', async () => {
    await createProduct(ctx.prisma, { name: 'Wireless Mouse' });
    const odd = ['mouse:*', 'ម៉ៅ wireless', 'wireless  mouse', '*', 'mouse'.padEnd(100, 'x')];
    for (const q of odd) {
      const res = await request(ctx.app).get('/api/v1/products').query({ q });
      expect(res.status).toBe(200);
      const again = await request(ctx.app).get('/api/v1/products').query({ q });
      expect(again.body).toEqual(res.body);
    }
    expect(await names({ q: 'wireless mouse' })).toEqual(['Wireless Mouse']);
    expect(await names({ q: 'zzzzqqq' })).toEqual([]);
  });

  it('caches categories and banners the same way', async () => {
    const cat = await createCategory(ctx.prisma, { name: 'Mice', slug: 'mice' });
    const banner = await ctx.prisma.banner.create({ data: { storageKey: 'banners/00000000-0000-4000-8000-000000000009', width: 1400, height: 500 } });
    const cats = async () => (await request(ctx.app).get('/api/v1/categories')).body.items.map((c: { name: string }) => c.name);
    const banners = async () => (await request(ctx.app).get('/api/v1/banners')).body.items.length;
    expect(await cats()).toEqual(['Mice']);
    expect(await banners()).toBe(1);
    await ctx.prisma.category.update({ where: { id: cat.id }, data: { name: 'Mouse' } });
    await ctx.prisma.banner.update({ where: { id: banner.id }, data: { isActive: false } });
    expect(await cats()).toEqual(['Mice']);
    expect(await banners()).toBe(1);
    await ctx.deps.cache.invalidate('catalog');
    expect(await cats()).toEqual(['Mouse']);
    expect(await banners()).toBe(0);
  });

  it('does not cache product detail or by-ids', async () => {
    const p = await createProduct(ctx.prisma, { name: 'Old name', slug: 'old-name' });
    const detail = async () => (await request(ctx.app).get('/api/v1/products/old-name')).body.name;
    const byIds = async () => (await request(ctx.app).get('/api/v1/products/by-ids').query({ ids: p.id })).body.items[0].name;
    expect(await detail()).toBe('Old name');
    expect(await byIds()).toBe('Old name');
    await ctx.prisma.product.update({ where: { id: p.id }, data: { name: 'New name' } });
    expect(await detail()).toBe('New name');
    expect(await byIds()).toBe('New name');
  });

  it('keeps the Cache-Control header on cached responses', async () => {
    await createProduct(ctx.prisma);
    await request(ctx.app).get('/api/v1/products');
    const res = await request(ctx.app).get('/api/v1/products');
    expect(res.headers['cache-control']).toBe('public, max-age=15, stale-while-revalidate=60');
  });
});
