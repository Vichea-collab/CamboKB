import { Router } from 'express';
import type { AppDeps } from '../app';
import { requireAuth, requireRole } from '../middleware/auth';
import { adminBannersRouter } from './banners';
import { adminCategoriesRouter } from './categories';
import { adminProductsRouter } from './products';

export function adminRouter(deps: AppDeps): Router {
  const r = Router();
  r.use(requireAuth, requireRole('ADMIN'));
  r.use(adminProductsRouter(deps));
  r.use(adminCategoriesRouter(deps));
  r.use(adminBannersRouter(deps));
  return r;
}
