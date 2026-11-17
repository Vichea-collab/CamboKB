import { EMPTY_STORE_INFO, storeInfoSchema } from '@cambo/shared';
import { Router } from 'express';
import type { AppDeps } from '../app';
import { getDeliverySettings } from '../checkout/quote';

/** Public store details for the footer and info pages. Never exposes the exact store location. */
export function storeRouter({ prisma }: AppDeps): Router {
  const r = Router();
  r.get('/store', async (_req, res) => {
    const [row, delivery] = await Promise.all([prisma.storeSetting.findUnique({ where: { id: 1 } }), getDeliverySettings(prisma)]);
    const { store: _store, ...rates } = delivery;
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300').json({
      storeName: row?.storeName ?? 'Cambo Supply',
      info: storeInfoSchema.catch(EMPTY_STORE_INFO).parse(row?.info ?? {}),
      delivery: rates,
    });
  });
  return r;
}
