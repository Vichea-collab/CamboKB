import type { Prisma, PrismaClient } from '@prisma/client';
import {
  productInputSchema,
  productPatchSchema,
  reorderSchema,
  uuidSchema,
  type ProductInput,
  type ProductPatch,
} from '@cambo/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../http/app';
import { productInclude, toProductDetail, type ProductWithRelations } from './serializers';
import { AppError, notFound } from '../../http/errors';
import type { FileClient } from '../../integrations/files/client';
import { validate } from '../../http/middleware/validate';
import { imageUpload } from './uploads';

export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
  return slug || 'item';
}

/** `base`, then `base-2`, `base-3`, … until unused (ignoring `excludeId`). */
export async function uniqueProductSlug(db: PrismaClient | Prisma.TransactionClient, base: string, excludeId?: string) {
  const taken = new Set(
    (
      await db.product.findMany({
        where: { slug: { startsWith: base }, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { slug: true },
      })
    ).map((p) => p.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export const adminProductInclude = {
  ...productInclude,
  _count: { select: { orderItems: true } },
} as const;

export type AdminProductWithRelations = ProductWithRelations & {
  _count?: { orderItems: number };
};

export function toAdminProduct(p: AdminProductWithRelations, files: FileClient) {
  return {
    ...toProductDetail(p, files),
    isSoldOut: p.isSoldOut,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    categoryId: p.categoryId,
    orderCount: p._count?.orderItems ?? 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    images: p.images.map((i) => ({ id: i.id, storageKey: i.storageKey, width: i.width, height: i.height, ...files.imageUrls(i.storageKey, i.width) })),
  };
}

const idParams = z.object({ id: uuidSchema });
const imageParams = z.object({ id: uuidSchema, imageId: uuidSchema });
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'hidden', 'all']).default('all'),
  categoryId: uuidSchema.optional(),
});
const deleteQuery = z.object({ permanent: z.enum(['1']).optional() });

export function adminProductsRouter({ prisma, files }: AppDeps): Router {
  const r = Router();
  const load = async (id: string) => {
    const p = await prisma.product.findUnique({ where: { id }, include: adminProductInclude });
    if (!p) throw notFound('Product');
    return p;
  };
  const ensureCategory = async (categoryId?: string) => {
    if (categoryId && !(await prisma.category.findUnique({ where: { id: categoryId } }))) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Category does not exist');
    }
  };

  r.get('/products', validate({ query: listQuery }), async (req, res) => {
    const { q, status, categoryId } = req.valid.query as z.infer<typeof listQuery>;
    const where: Prisma.ProductWhereInput = {};
    if (status !== 'all') where.isActive = status === 'active';
    if (categoryId) where.categoryId = categoryId;
    if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }];
    const items = await prisma.product.findMany({ where, include: adminProductInclude, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    res.json({ items: items.map((p) => toAdminProduct(p, files)) });
  });

  r.get('/products/:id', validate({ params: idParams }), async (req, res) => {
    res.json(toAdminProduct(await load((req.valid.params as { id: string }).id), files));
  });

  r.post('/products', validate({ body: productInputSchema }), async (req, res) => {
    const { specs, slug, ...data } = req.valid.body as ProductInput;
    await ensureCategory(data.categoryId);
    const last = await prisma.product.aggregate({ _max: { sortOrder: true } });
    const p = await prisma.product.create({
      data: {
        ...data,
        slug: await uniqueProductSlug(prisma, slug ?? slugify(data.name)),
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        specs: { create: specs.map((s, i) => ({ ...s, sortOrder: i })) },
      },
      include: adminProductInclude,
    });
    res.status(201).json(toAdminProduct(p, files));
  });

  r.patch('/products/:id', validate({ params: idParams, body: productPatchSchema }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const { specs, slug, ...data } = req.valid.body as ProductPatch;
    await load(id);
    await ensureCategory(data.categoryId);
    const p = await prisma.$transaction(async (tx) => {
      if (specs) {
        await tx.productSpec.deleteMany({ where: { productId: id } });
        await tx.productSpec.createMany({ data: specs.map((s, i) => ({ ...s, productId: id, sortOrder: i })) });
      }
      return tx.product.update({
        where: { id },
        data: { ...data, ...(slug ? { slug: await uniqueProductSlug(tx, slug, id) } : {}) },
        include: adminProductInclude,
      });
    });
    res.json(toAdminProduct(p, files));
  });

  // Archive (soft-delete) or permanent delete (only allowed if 0 past orders)
  r.delete('/products/:id', validate({ params: idParams, query: deleteQuery }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const { permanent } = req.valid.query as { permanent?: string };
    await load(id);
    const orderCount = await prisma.orderItem.count({ where: { productId: id } });

    if (permanent === '1') {
      if (orderCount > 0) {
        throw new AppError(
          400,
          'CANNOT_DELETE_WITH_ORDERS',
          'This product has past orders and cannot be permanently deleted. Archive it instead.',
        );
      }
      const images = await prisma.productImage.findMany({ where: { productId: id } });
      await Promise.allSettled(images.map((img) => files.deleteImage(img.storageKey)));
      await prisma.product.delete({ where: { id } });
      return res.status(204).end();
    }

    await prisma.product.update({ where: { id }, data: { isActive: false } });
    res.status(204).end();
  });

  r.post('/products/reorder', validate({ body: reorderSchema }), async (req, res) => {
    const { ids } = req.valid.body as { ids: string[] };
    await prisma.$transaction(ids.map((id, i) => prisma.product.updateMany({ where: { id }, data: { sortOrder: i + 1 } })));
    res.status(204).end();
  });

  r.post('/products/:id/images', validate({ params: idParams }), imageUpload.array('files', 10), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    await load(id);
    const uploads = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!uploads.length) throw new AppError(400, 'VALIDATION_ERROR', 'No files uploaded');
    const stored: Awaited<ReturnType<FileClient['storeImage']>>[] = [];
    try {
      for (const f of uploads) stored.push(await files.storeImage(f.buffer, f.originalname, 'products'));
    } catch (err) {
      await Promise.allSettled(stored.map((s) => files.deleteImage(s.storageKey)));
      throw err;
    }
    const last = await prisma.productImage.aggregate({ where: { productId: id }, _max: { sortOrder: true } });
    const start = (last._max.sortOrder ?? -1) + 1;
    await prisma.productImage.createMany({ data: stored.map((s, i) => ({ ...s, productId: id, sortOrder: start + i })) });
    res.status(201).json(toAdminProduct(await load(id), files));
  });

  r.patch('/products/:id/images/order', validate({ params: idParams, body: reorderSchema }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const { ids } = req.valid.body as { ids: string[] };
    await prisma.$transaction(ids.map((imageId, i) => prisma.productImage.updateMany({ where: { id: imageId, productId: id }, data: { sortOrder: i } })));
    res.json(toAdminProduct(await load(id), files));
  });

  r.delete('/products/:id/images/:imageId', validate({ params: imageParams }), async (req, res) => {
    const { id, imageId } = req.valid.params as { id: string; imageId: string };
    const image = await prisma.productImage.findFirst({ where: { id: imageId, productId: id } });
    if (!image) throw notFound('Image');
    await prisma.productImage.delete({ where: { id: imageId } });
    await files.deleteImage(image.storageKey).catch(() => undefined);
    res.json(toAdminProduct(await load(id), files));
  });

  return r;
}
