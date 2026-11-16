import { Router } from 'express';
import type { AppDeps } from '../app';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminBannersRouter } from './banners';
import { adminCategoriesRouter } from './categories';
import { adminCustomersRouter } from './customers';
import { adminOrdersRouter } from './orders';
import { adminProductsRouter } from './products';
import { adminPromosRouter } from './promos';
import { adminSettingsRouter } from './settings';
import { adminStatsRouter } from './stats';

export function adminRouter(deps: AppDeps): Router {
  const r = Router();
  r.use(requireAuth, requireRole('ADMIN'));
  r.use(adminProductsRouter(deps));
  r.use(adminCategoriesRouter(deps));
  r.use(adminBannersRouter(deps));
  r.use(adminOrdersRouter(deps));
  r.use(adminPromosRouter(deps));
  r.use(adminCustomersRouter(deps));
  r.use(adminSettingsRouter(deps));
  r.use(adminStatsRouter(deps));
  return r;
}
