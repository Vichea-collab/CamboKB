import { changePasswordSchema, loginSchema, type ChangePasswordInput, type LoginInput } from '@cambo/shared';
import { Router } from 'express';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import { requireAuth } from '../middleware/auth';
import { loginLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import { clearSessionCookie, revokeAllSessions, revokeSession, startSession, toPublicUser } from './sessions';

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Wrong phone number or password');

export function authRouter(deps: AppDeps): Router {
  const { prisma, config } = deps;
  const r = Router();

  r.post('/login', loginLimiter(config), validate({ body: loginSchema }), async (req, res) => {
    const { phone, password } = req.valid.body as LoginInput;
    const user = await prisma.user.findUnique({ where: { phone } });
    const ok = user ? await verifyPassword(user.passwordHash, password) : await verifyAgainstDummy(password);
    if (!user || !ok || user.disabledAt) throw invalidCredentials();
    await startSession(prisma, config, res, user, { ip: req.ip, userAgent: req.get('user-agent') });
    res.json({ user: toPublicUser(user) });
  });

  r.post('/logout', async (req, res) => {
    if (req.sessionId) await revokeSession(prisma, req.sessionId);
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  r.post('/logout-all', requireAuth, async (req, res) => {
    await revokeAllSessions(prisma, req.user!.id);
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  r.get('/me', requireAuth, (req, res) => {
    res.json({ user: toPublicUser(req.user!) });
  });

  r.post('/change-password', requireAuth, validate({ body: changePasswordSchema }), async (req, res) => {
    const { currentPassword, newPassword } = req.valid.body as ChangePasswordInput;
    const user = req.user!;
    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new AppError(400, 'INVALID_CREDENTIALS', 'Current password is wrong');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() },
    });
    await revokeAllSessions(prisma, user.id, req.sessionId);
    res.status(204).end();
  });

  return r;
}
