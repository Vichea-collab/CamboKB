import { Router } from 'express';
import type { AppDeps } from '../app';
import { requireAuth, requireRole } from '../middleware/auth';

export function adminRouter(_deps: AppDeps): Router {
  const r = Router();
  r.use(requireAuth, requireRole('ADMIN'));
  return r;
}
