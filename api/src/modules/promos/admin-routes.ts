import type { PromoCode } from '@prisma/client';
import { promoInputSchema, uuidSchema, type PromoInput } from '@cambo/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../http/app';
import { validate } from '../../http/middleware/validate';

const idParams = z.object({ id: uuidSchema });
const toPromo = (p: PromoCode) => ({
  id: p.id,
  code: p.code,
  type: p.type,
  value: p.value,
  minSubtotalCents: p.minSubtotalCents,
  startsAt: p.startsAt,
  endsAt: p.endsAt,
  maxUses: p.maxUses,
  maxUsesPerUser: p.maxUsesPerUser,
  usedCount: p.usedCount,
  isActive: p.isActive,
  createdAt: p.createdAt,
});

export function adminPromosRouter({ prisma }: AppDeps): Router {
  const r = Router();
  r.get('/promos', async (_req, res) => {
    const items = await prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ items: items.map(toPromo) });
  });
  r.post('/promos', validate({ body: promoInputSchema }), async (req, res) => {
    res.status(201).json(toPromo(await prisma.promoCode.create({ data: req.valid.body as PromoInput })));
  });
  r.patch('/promos/:id', validate({ params: idParams, body: promoInputSchema }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    res.json(toPromo(await prisma.promoCode.update({ where: { id }, data: req.valid.body as PromoInput })));
  });
  r.delete('/promos/:id', validate({ params: idParams }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const used = await prisma.order.count({ where: { promoCodeId: id } });
    // Codes used by orders are kept for history; deleting just deactivates them.
    if (used) await prisma.promoCode.update({ where: { id }, data: { isActive: false } });
    else await prisma.promoCode.delete({ where: { id } });
    res.status(204).end();
  });
  return r;
}
