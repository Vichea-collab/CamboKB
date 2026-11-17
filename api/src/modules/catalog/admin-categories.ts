import { categoryInputSchema, reorderSchema, uuidSchema, type CategoryInput } from '@cambo/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../http/app';
import { toCategory } from './serializers';
import { AppError, notFound } from '../../http/errors';
import { validate } from '../../http/middleware/validate';
import { slugify } from './admin-products';

const idParams = z.object({ id: uuidSchema });

export function adminCategoriesRouter({ prisma }: AppDeps): Router {
  const r = Router();

  r.get('/categories', async (_req, res) => {
    const items = await prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { products: true } } } });
    res.json({ items: items.map((c) => ({ ...toCategory(c), productCount: c._count.products })) });
  });

  r.post('/categories', validate({ body: categoryInputSchema }), async (req, res) => {
    const { name, slug } = req.valid.body as CategoryInput;
    const last = await prisma.category.aggregate({ _max: { sortOrder: true } });
    const c = await prisma.category.create({ data: { name, slug: slug ?? slugify(name), sortOrder: (last._max.sortOrder ?? 0) + 1 } });
    res.status(201).json(toCategory(c));
  });

  r.patch('/categories/:id', validate({ params: idParams, body: categoryInputSchema.partial() }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const c = await prisma.category.update({ where: { id }, data: req.valid.body as Partial<CategoryInput> });
    res.json(toCategory(c));
  });

  r.delete('/categories/:id', validate({ params: idParams }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const c = await prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
    if (!c) throw notFound('Category');
    if (c._count.products > 0) throw new AppError(409, 'CATEGORY_IN_USE', 'Move or archive this category’s products first');
    await prisma.category.delete({ where: { id } });
    res.status(204).end();
  });

  r.post('/categories/reorder', validate({ body: reorderSchema }), async (req, res) => {
    const { ids } = req.valid.body as { ids: string[] };
    await prisma.$transaction(ids.map((id, i) => prisma.category.updateMany({ where: { id }, data: { sortOrder: i + 1 } })));
    res.status(204).end();
  });

  return r;
}
