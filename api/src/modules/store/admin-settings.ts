import { EMPTY_STORE_INFO, settingsInputSchema, storeInfoSchema, type SettingsInput } from '@cambo/shared';
import { Router } from 'express';
import type { AppDeps } from '../../http/app';
import { getDeliverySettings } from '../orders/quote';
import { validate } from '../../http/middleware/validate';

export function adminSettingsRouter({ prisma }: AppDeps): Router {
  const r = Router();
  const view = async () => {
    const row = await prisma.storeSetting.findUnique({ where: { id: 1 } });
    return {
      storeName: row?.storeName ?? 'Cambo Keyboard Supply',
      telegramNotify: row?.telegramNotify ?? true,
      delivery: await getDeliverySettings(prisma),
      info: storeInfoSchema.catch(EMPTY_STORE_INFO).parse(row?.info ?? {}),
    };
  };
  r.get('/settings', async (_req, res) => {
    res.json(await view());
  });
  r.put('/settings', validate({ body: settingsInputSchema }), async (req, res) => {
    const input = req.valid.body as SettingsInput;
    const delivery = { ...input.delivery, grabTiers: [...input.delivery.grabTiers].sort((a, b) => a.maxKm - b.maxKm) };
    await prisma.storeSetting.upsert({
      where: { id: 1 },
      create: { id: 1, storeName: input.storeName, telegramNotify: input.telegramNotify, delivery, info: input.info },
      update: { storeName: input.storeName, telegramNotify: input.telegramNotify, delivery, info: input.info },
    });
    res.json(await view());
  });
  return r;
}
