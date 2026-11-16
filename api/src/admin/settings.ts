import { settingsInputSchema, type SettingsInput } from '@cambo/shared';
import { Router } from 'express';
import type { AppDeps } from '../app';
import { getDeliverySettings } from '../checkout/quote';
import { validate } from '../middleware/validate';

export function adminSettingsRouter({ prisma }: AppDeps): Router {
  const r = Router();
  const view = async () => {
    const row = await prisma.storeSetting.findUnique({ where: { id: 1 } });
    return { storeName: row?.storeName ?? 'Cambo Supply', telegramNotify: row?.telegramNotify ?? true, delivery: await getDeliverySettings(prisma) };
  };
  r.get('/settings', async (_req, res) => {
    res.json(await view());
  });
  r.put('/settings', validate({ body: settingsInputSchema }), async (req, res) => {
    const input = req.valid.body as SettingsInput;
    const delivery = { ...input.delivery, grabTiers: [...input.delivery.grabTiers].sort((a, b) => a.maxKm - b.maxKm) };
    await prisma.storeSetting.upsert({
      where: { id: 1 },
      create: { id: 1, storeName: input.storeName, telegramNotify: input.telegramNotify, delivery },
      update: { storeName: input.storeName, telegramNotify: input.telegramNotify, delivery },
    });
    res.json(await view());
  });
  return r;
}
