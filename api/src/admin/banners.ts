import type { Banner } from '@prisma/client';
import { bannerPatchSchema, reorderSchema, uuidSchema } from '@cambo/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { AppError, notFound } from '../errors';
import type { FileClient } from '../files/client';
import { validate } from '../middleware/validate';
import { imageUpload } from './uploads';

const idParams = z.object({ id: uuidSchema });

const toAdminBanner = (b: Banner, files: FileClient) => ({
  id: b.id,
  storageKey: b.storageKey,
  linkUrl: b.linkUrl,
  isActive: b.isActive,
  sortOrder: b.sortOrder,
  width: b.width,
  height: b.height,
  image: files.imageUrls(b.storageKey, b.width),
});

export function adminBannersRouter({ prisma, files }: AppDeps): Router {
  const r = Router();

  r.get('/banners', async (_req, res) => {
    const items = await prisma.banner.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    res.json({ items: items.map((b) => toAdminBanner(b, files)) });
  });

  r.post('/banners', imageUpload.single('file'), async (req, res) => {
    if (!req.file) throw new AppError(400, 'VALIDATION_ERROR', 'No file uploaded');
    const fields = bannerPatchSchema.safeParse({ linkUrl: req.body?.linkUrl || null });
    if (!fields.success) throw new AppError(400, 'VALIDATION_ERROR', 'Link must be a valid URL');
    const stored = await files.storeImage(req.file.buffer, req.file.originalname, 'banners');
    const last = await prisma.banner.aggregate({ _max: { sortOrder: true } });
    const b = await prisma.banner.create({
      data: { ...stored, linkUrl: fields.data.linkUrl ?? null, sortOrder: (last._max.sortOrder ?? 0) + 1 },
    });
    res.status(201).json(toAdminBanner(b, files));
  });

  r.patch('/banners/:id', validate({ params: idParams, body: bannerPatchSchema }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const b = await prisma.banner.update({ where: { id }, data: req.valid.body as z.infer<typeof bannerPatchSchema> });
    res.json(toAdminBanner(b, files));
  });

  r.delete('/banners/:id', validate({ params: idParams }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const b = await prisma.banner.findUnique({ where: { id } });
    if (!b) throw notFound('Banner');
    await prisma.banner.delete({ where: { id } });
    await files.deleteImage(b.storageKey).catch(() => undefined);
    res.status(204).end();
  });

  r.post('/banners/reorder', validate({ body: reorderSchema }), async (req, res) => {
    const { ids } = req.valid.body as { ids: string[] };
    await prisma.$transaction(ids.map((id, i) => prisma.banner.updateMany({ where: { id }, data: { sortOrder: i + 1 } })));
    res.status(204).end();
  });

  return r;
}
