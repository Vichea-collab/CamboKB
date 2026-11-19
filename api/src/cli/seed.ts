import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_DELIVERY_SETTINGS } from '@cambo/shared';
import { slugify, uniqueProductSlug } from '../modules/catalog/admin-products';
import type { FileClient } from '../integrations/files/client';

type ScrapedProduct = {
  n: number;
  category: string;
  name: string;
  description: string;
  price: string;
  specs: [string, string][];
  images: number;
};

const CATEGORIES: Record<string, { name: string; slug: string; sortOrder: number }> = {
  keyboard: { name: 'Keyboards', slug: 'keyboards', sortOrder: 1 },
  mouse: { name: 'Mice', slug: 'mice', sortOrder: 2 },
  deskmat: { name: 'Mousepads', slug: 'mousepads', sortOrder: 3 },
  accessories: { name: 'Accessories', slug: 'accessories', sortOrder: 4 },
};

const DEFAULT_STOCK = 10;

/** "$65 MECHANICAL KEYBOARD" → 6500 */
export function parsePriceCents(text: string): number {
  const m = /\$\s*(\d+(?:\.\d{1,2})?)/.exec(text);
  if (!m) throw new Error(`No price in ${JSON.stringify(text)}`);
  return Math.round(Number(m[1]) * 100);
}

/**
 * Load the scraped catalog (products.json + products/NN-*.jpg + banners/*) into an
 * empty database. Skips when any product already exists.
 */
export async function seedCatalog(
  deps: { prisma: PrismaClient; files: FileClient },
  dataDir: string,
  log: (msg: string) => void = () => {},
): Promise<{ products: number; images: number; banners: number; skipped: boolean }> {
  const { prisma, files } = deps;
  if ((await prisma.product.count()) > 0) {
    log('Products already exist — skipping catalog seed.');
    return { products: 0, images: 0, banners: 0, skipped: true };
  }

  await prisma.storeSetting.upsert({
    where: { id: 1 },
    create: { id: 1, storeName: 'Cambo Supply', delivery: DEFAULT_DELIVERY_SETTINGS },
    update: {},
  });
  await prisma.promoCode.upsert({
    where: { code: 'CAMBOKBSHOP' },
    create: { code: 'CAMBOKBSHOP', type: 'FIXED', value: 100, isActive: true },
    update: {},
  });

  const categoryIds: Record<string, string> = {};
  for (const [key, c] of Object.entries(CATEGORIES)) {
    const row = await prisma.category.upsert({ where: { slug: c.slug }, create: c, update: {} });
    categoryIds[key] = row.id;
  }

  const scraped = JSON.parse(await readFile(path.join(dataDir, 'products.json'), 'utf8')) as ScrapedProduct[];
  const imageFiles = (await readdir(path.join(dataDir, 'products'))).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();

  let images = 0;
  for (const p of scraped) {
    const categoryId = categoryIds[p.category];
    if (!categoryId) throw new Error(`Unknown category ${p.category} for ${p.name}`);
    const prefix = `${String(p.n).padStart(2, '0')}-`;
    const mine = imageFiles
      .filter((f) => f.startsWith(prefix))
      .sort((a, b) => Number(/_(\d+)\./.exec(a)?.[1] ?? 0) - Number(/_(\d+)\./.exec(b)?.[1] ?? 0));
    const stored = [];
    for (const f of mine) stored.push(await files.storeImage(await readFile(path.join(dataDir, 'products', f)), f, 'products'));
    images += stored.length;

    await prisma.product.create({
      data: {
        name: p.name,
        slug: await uniqueProductSlug(prisma, slugify(p.name)),
        categoryId,
        specsLine: p.description ?? '',
        priceCents: parsePriceCents(p.price),
        stock: DEFAULT_STOCK,
        sortOrder: p.n,
        specs: { create: (p.specs ?? []).map(([label, value], i) => ({ label, value: value ?? '', sortOrder: i })) },
        images: { create: stored.map((s, i) => ({ ...s, sortOrder: i })) },
      },
    });
    log(`  ✓ ${p.n}. ${p.name} (${stored.length} photos)`);
  }

  const bannerFiles = (await readdir(path.join(dataDir, 'banners')).catch(() => [] as string[])).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  for (const [i, f] of bannerFiles.entries()) {
    const stored = await files.storeImage(await readFile(path.join(dataDir, 'banners', f)), f, 'banners');
    await prisma.banner.create({ data: { ...stored, sortOrder: i + 1, isActive: true } });
  }

  return { products: scraped.length, images, banners: bannerFiles.length, skipped: false };
}
