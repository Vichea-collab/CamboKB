import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../http/app';
import { notFound } from '../../http/errors';
import { validate } from '../../http/middleware/validate';
import { productInclude, toBanner, toCategory, toProductCard, toProductDetail } from './serializers';

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(60),
});
const idsQuery = z.object({
  ids: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.uuid()).max(50)),
});

/** Short shared caching: stock and prices change, but a few seconds of staleness is fine. */
const publicCache = (res: { set: (k: string, v: string) => unknown }) =>
  res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');

export function catalogRouter({ prisma, files }: AppDeps): Router {
  const r = Router();

  r.get('/categories', async (_req, res) => {
    const items = await prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    publicCache(res);
    res.json({ items: items.map(toCategory) });
  });

  r.get('/banners', async (_req, res) => {
    const items = await prisma.banner.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    publicCache(res);
    res.json({ items: items.map((b) => toBanner(b, files)) });
  });

  r.get('/products', validate({ query: listQuery }), async (req, res) => {
    const { q, category, page, pageSize } = req.valid.query as z.infer<typeof listQuery>;
    const where: Prisma.ProductWhereInput = { isActive: true };
    if (category) where.category = { slug: category };
    if (q) {
      const contains = { contains: q, mode: 'insensitive' as const };
      where.OR = [{ name: contains }, { specsLine: contains }, { description: contains }, { category: { name: contains } }];
    }
    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: { category: true, images: { orderBy: { sortOrder: 'asc' } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    publicCache(res);
    res.json({ items: items.map((p) => toProductCard(p, files)), total, page, pageSize });
  });

  r.get('/products/by-ids', validate({ query: idsQuery }), async (req, res) => {
    const { ids } = req.valid.query as { ids: string[] };
    const items = await prisma.product.findMany({
      where: { id: { in: ids }, isActive: true },
      include: { category: true, images: { orderBy: { sortOrder: 'asc' } } },
    });
    res.set('Cache-Control', 'no-store').json({ items: items.map((p) => toProductCard(p, files)) });
  });

  r.get('/products/:slug', validate({ params: z.object({ slug: z.string().max(140) }) }), async (req, res) => {
    const { slug } = req.valid.params as { slug: string };
    const p = await prisma.product.findFirst({ where: { slug, isActive: true }, include: productInclude });
    if (!p) throw notFound('Product');
    publicCache(res);
    res.json(toProductDetail(p, files));
  });

  return r;
}
