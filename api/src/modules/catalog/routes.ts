import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../http/app';
import { notFound } from '../../http/errors';
import { validate } from '../../http/middleware/validate';
import {
  productInclude,
  toBanner,
  toCategory,
  toProductCard,
  toProductDetail,
} from './serializers';

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  /** Price range in dollars (the shop shows dollars); either end may be left out. */
  minPrice: z.coerce.number().min(0).max(100_000).optional(),
  maxPrice: z.coerce.number().min(0).max(100_000).optional(),
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

/** Words of a search, at most 5, each at most 40 characters. */
const searchWords = (q: string) =>
  q
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((w) => w.slice(0, 40));

/** Words that mean the same in this shop, both ways. Shoppers say "mouse"; the category is called "Mice". */
const SYNONYMS: Record<string, string[]> = {
  mouse: ['mice'],
  mice: ['mouse'],
  keyboard: ['keeb'],
  keeb: ['keyboard'],
  mousepad: ['mouse pad', 'desk mat', 'mat'],
  mat: ['mousepad'],
  deskmat: ['desk mat', 'mousepad'],
};

/** The word as typed, its plural or singular, and the shop's synonyms: "keyboards" also looks for "keyboard". */
function alternatives(word: string): string[] {
  const w = word.toLowerCase();
  const out = new Set([word]);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) out.add(w.slice(0, -1)); // not "wireless" -> "wireles"
  for (const base of [...out].map((x) => x.toLowerCase()))
    for (const syn of SYNONYMS[base] ?? []) out.add(syn);
  return [...out];
}

/**
 * How well one spelling of a search word matches a product, 0 when it does not. An exact name beats a category
 * match, which beats a name that merely contains the word, then the specs line, then the description. Failing those, a
 * close spelling (trigram similarity, from the pg_trgm extension) still counts: "keybord" finds "Keyboard". Words
 * under 3 characters only match as written, because a spelling guess on two letters finds everything.
 */
function spellingScore(word: string): Prisma.Sql {
  const like = `%${word.replace(/[\\%_]/g, '\\$&')}%`;
  const fuzzy =
    word.length >= 3
      ? Prisma.sql`, word_similarity(${word}::text, p."name") * 0.95, word_similarity(${word}::text, p."specsLine") * 0.85, word_similarity(${word}::text, c."name") * 0.85`
      : Prisma.empty;
  return Prisma.sql`GREATEST(
    CASE WHEN lower(p."name") = lower(${word}::text) THEN 3.0 ELSE 0 END,
    CASE WHEN c."name" ILIKE ${like} THEN 2.5 ELSE 0 END,
    CASE WHEN p."name" ILIKE ${like} THEN 2.0 + similarity(p."name", ${word}::text) ELSE 0 END,
    CASE WHEN p."specsLine" ILIKE ${like} THEN 1.5 ELSE 0 END,
    CASE WHEN p."description" ILIKE ${like} THEN 1.0 ELSE 0 END
    ${fuzzy})`;
}

/** The best any spelling of the word scores. */
const wordScore = (word: string): Prisma.Sql =>
  Prisma.sql`GREATEST(${Prisma.join(alternatives(word).map(spellingScore), ', ')})`;
/** A word needs at least this much to count as a match (substring hits score 1 or more; spelling guesses 0.45 up). */
const MATCH_MIN = 0.45;

export function catalogRouter({ prisma, files, cache }: AppDeps): Router {
  const r = Router();

  r.get('/categories', async (_req, res) => {
    const body = await cache.cached('catalog', 'categories', async () => {
      const items = await prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
      return { items: items.map(toCategory) };
    });
    publicCache(res);
    res.json(body);
  });

  r.get('/banners', async (_req, res) => {
    const body = await cache.cached('catalog', 'banners', async () => {
      const items = await prisma.banner.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
      return { items: items.map((b) => toBanner(b, files)) };
    });
    publicCache(res);
    res.json(body);
  });

  r.get('/products', validate({ query: listQuery }), async (req, res) => {
    const { q, category, minPrice, maxPrice, page, pageSize } = req.valid.query as z.infer<
      typeof listQuery
    >;
    // The validated query, in a fixed order, so equal searches share one entry and different ones never do.
    const key = `products:${createHash('sha1').update(JSON.stringify([q ?? null, category ?? null, minPrice ?? null, maxPrice ?? null, page, pageSize])).digest('hex')}`;
    const result = await cache.cached('catalog', key, async () => {
      const minCents = minPrice === undefined ? undefined : Math.round(minPrice * 100);
      const maxCents = maxPrice === undefined ? undefined : Math.round(maxPrice * 100);
      const words = q ? searchWords(q) : [];

      let total: number;
      let items;
      if (words.length === 0) {
        const where: Prisma.ProductWhereInput = { isActive: true };
        if (category) where.category = { slug: category };
        if (minCents !== undefined || maxCents !== undefined)
          where.priceCents = { gte: minCents, lte: maxCents };
        [total, items] = await Promise.all([
          prisma.product.count({ where }),
          prisma.product.findMany({
            where,
            include: { category: true, images: { orderBy: { sortOrder: 'asc' } } },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
        ]);
      } else {
        // A search: every word must match something, and the best match comes first.
        const scores = words.map(wordScore);
        const conditions = [
          Prisma.sql`p."isActive" = true`,
          ...(category ? [Prisma.sql`c."slug" = ${category}`] : []),
          ...(minCents !== undefined ? [Prisma.sql`p."priceCents" >= ${minCents}`] : []),
          ...(maxCents !== undefined ? [Prisma.sql`p."priceCents" <= ${maxCents}`] : []),
          ...scores.map((s) => Prisma.sql`${s} >= ${MATCH_MIN}`),
        ];
        const where = Prisma.join(conditions, ' AND ');
        const score = Prisma.join(scores, ' + ');
        const [count, ranked] = await Promise.all([
          prisma.$queryRaw<
            { n: bigint }[]
          >`SELECT count(*) AS n FROM "Product" p JOIN "Category" c ON c."id" = p."categoryId" WHERE ${where}`,
          prisma.$queryRaw<{ id: string }[]>`
            SELECT p."id" FROM "Product" p JOIN "Category" c ON c."id" = p."categoryId"
            WHERE ${where}
            ORDER BY (${score}) DESC, p."sortOrder" ASC, p."createdAt" ASC
            LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        ]);
        total = Number(count[0]?.n ?? 0);
        const found = await prisma.product.findMany({
          where: { id: { in: ranked.map((r) => r.id) } },
          include: { category: true, images: { orderBy: { sortOrder: 'asc' } } },
        });
        const byId = new Map(found.map((p) => [p.id, p]));
        items = ranked.flatMap((r) => byId.get(r.id) ?? []);
      }
      return { items: items.map((p) => toProductCard(p, files)), total, page, pageSize };
    });
    publicCache(res);
    res.json(result);
  });

  r.get('/products/by-ids', validate({ query: idsQuery }), async (req, res) => {
    const { ids } = req.valid.query as { ids: string[] };
    const items = await prisma.product.findMany({
      where: { id: { in: ids }, isActive: true },
      include: { category: true, images: { orderBy: { sortOrder: 'asc' } } },
    });
    res.set('Cache-Control', 'no-store').json({ items: items.map((p) => toProductCard(p, files)) });
  });

  r.get(
    '/products/:slug',
    validate({ params: z.object({ slug: z.string().max(140) }) }),
    async (req, res) => {
      const { slug } = req.valid.params as { slug: string };
      const p = await prisma.product.findFirst({
        where: { slug, isActive: true },
        include: productInclude,
      });
      if (!p) throw notFound('Product');
      publicCache(res);
      res.json(toProductDetail(p, files));
    },
  );

  return r;
}
