import { Router } from 'express';
import type { AppDeps } from '../http/app';
import { requireAuth, requireRole } from '../http/middleware/auth';
import { adminEventsRouter } from './admin-events';
import { adminTelegramRouter } from './bot/admin-routes';
import { adminBannersRouter } from './catalog/admin-banners';
import { adminCategoriesRouter } from './catalog/admin-categories';
import { invalidateCatalogOnWrite } from './catalog/cache-invalidation';
import { adminCustomersRouter } from './customers/admin-routes';
import { adminOrdersRouter } from './orders/admin-routes';
import { adminProductsRouter } from './catalog/admin-products';
import { adminPromosRouter } from './promos/admin-routes';
import { adminReportsRouter } from './reports/routes';
import { adminSettingsRouter } from './store/admin-settings';
import { adminStatsRouter } from './dashboard/admin-stats';

export function adminRouter(deps: AppDeps): Router {
  const r = Router();
  r.use(requireAuth, requireRole('ADMIN'));
  r.use(adminEventsRouter());
  r.use(adminTelegramRouter(deps));
  // Anything an admin changes in the catalogue must show on the public pages at once, not after the cache expires.
  r.use(['/products', '/categories', '/banners'], invalidateCatalogOnWrite(deps));
  r.use(adminProductsRouter(deps));
  r.use(adminCategoriesRouter(deps));
  r.use(adminBannersRouter(deps));
  r.use(adminOrdersRouter(deps));
  r.use(adminPromosRouter(deps));
  r.use(adminCustomersRouter(deps));
  r.use(adminSettingsRouter(deps));
  r.use(adminStatsRouter(deps));
  r.use(adminReportsRouter(deps));
  return r;
}
