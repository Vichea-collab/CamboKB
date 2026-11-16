import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { promoteAdmin } from '../src/cli/promote';
import { parsePriceCents, seedCatalog } from '../src/cli/seed';
import { createTestApp, createUser, resetDb } from './helpers';

const DATA_DIR = path.resolve(__dirname, '../seed-data');

describe('parsePriceCents', () => {
  it.each([
    ['$65 MECHANICAL KEYBOARD', 6500],
    ['$6 DESKMAT & MOUSEPAD', 600],
    ['$12.50', 1250],
  ])('%j → %d', (input, cents) => {
    expect(parsePriceCents(input)).toBe(cents);
  });
  it('rejects text without a price', () => {
    expect(() => parsePriceCents('free')).toThrow();
  });
});

describe('seedCatalog', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
  });

  it('imports the scraped catalog with images, specs, banners, settings and a promo', async () => {
    const result = await seedCatalog(ctx.deps, DATA_DIR);
    expect(result).toEqual({ products: 44, images: 60, banners: 3, skipped: false });
    expect(await ctx.prisma.category.findMany({ orderBy: { sortOrder: 'asc' }, select: { slug: true } })).toEqual([
      { slug: 'keyboards' },
      { slug: 'mice' },
      { slug: 'mousepads' },
      { slug: 'accessories' },
    ]);
    const aula = await ctx.prisma.product.findFirstOrThrow({
      where: { name: 'Aula F75 Max Gradient Black' },
      include: { images: true, specs: { orderBy: { sortOrder: 'asc' } }, category: true },
    });
    expect(aula).toMatchObject({ priceCents: 6500, stock: 10, specsLine: '75% Layout • Hot-Swap • Multi-Mode', slug: 'aula-f75-max-gradient-black' });
    expect(aula.category.slug).toBe('keyboards');
    expect(aula.images).toHaveLength(4);
    expect(aula.specs).toHaveLength(10);
    expect(aula.specs[0]).toMatchObject({ label: 'Layout' });
    const pads = await ctx.prisma.product.findMany({ where: { name: 'Mousepad Xl Size 800x300x3mm' }, select: { slug: true } });
    expect(new Set(pads.map((p) => p.slug)).size).toBe(pads.length);
    expect(await ctx.prisma.promoCode.findUnique({ where: { code: 'CAMBOKBSHOP' } })).toMatchObject({ type: 'FIXED', value: 100 });
    expect((await ctx.prisma.storeSetting.findUniqueOrThrow({ where: { id: 1 } })).storeName).toBe('Cambo Supply');
  });

  it('does nothing when products already exist', async () => {
    await seedCatalog(ctx.deps, DATA_DIR);
    const again = await seedCatalog(ctx.deps, DATA_DIR);
    expect(again.skipped).toBe(true);
    expect(await ctx.prisma.product.count()).toBe(44);
  });
});

describe('promoteAdmin', () => {
  beforeEach(() => resetDb());

  it('promotes a user found by any phone format', async () => {
    const ctx = await createTestApp();
    await createUser(ctx.prisma, { phone: '+85512345678' });
    const user = await promoteAdmin(ctx.prisma, '012 345 678');
    expect(user.role).toBe('ADMIN');
  });

  it('fails for an unknown phone', async () => {
    const ctx = await createTestApp();
    await expect(promoteAdmin(ctx.prisma, '+85599999999')).rejects.toThrow(/No user/);
  });
});
