import {
  changePasswordSchema,
  changePhoneCompleteSchema,
  loginSchema,
  resetCompleteSchema,
  signupCompleteSchema,
  TELEGRAM_AUTH_PURPOSES,
  telegramStartSchema,
  uuidSchema,
  type ChangePasswordInput,
  type LoginInput,
  type ResetCompleteInput,
  type SignupCompleteInput,
  type TelegramStartInput,
} from '@cambo/shared';
import { z } from 'zod';
import { Router } from 'express';
import type { AppDeps } from '../../http/app';
import { AppError } from '../../http/errors';
import { requireAuth } from '../../http/middleware/auth';
import { limiter, loginLimiter } from '../../http/middleware/rate-limit';
import { validate } from '../../http/middleware/validate';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import { clearSessionCookie, revokeAllSessions, revokeSession, startSession, toPublicUser } from './sessions';
import {
  consumeVerifiedRequest,
  effectiveStatus,
  findOwnRequest,
  startTelegramAuth,
  statusView,
  TG_REQUEST_COOKIE,
  TG_REQUEST_TTL_MS,
} from './telegram-verification';

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

  // --- Telegram phone verification (sign up, reset password, change phone) ---

  r.post('/telegram/start', limiter(10, 15 * 60 * 1000), validate({ body: telegramStartSchema }), async (req, res) => {
    const { purpose, phone } = req.valid.body as TelegramStartInput;
    if (purpose === 'CHANGE_PHONE' && !req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
    if (purpose === 'RESET' && !phone) throw new AppError(400, 'VALIDATION_ERROR', 'Phone number is required');
    const result = await startTelegramAuth(deps, {
      purpose,
      phone: purpose === 'RESET' ? phone : undefined,
      userId: purpose === 'CHANGE_PHONE' ? req.user!.id : undefined,
    });
    res.cookie(TG_REQUEST_COOKIE, result.requestId, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      path: '/api/v1/auth',
      domain: config.cookieDomain || undefined,
      maxAge: TG_REQUEST_TTL_MS + 5 * 60 * 1000,
    });
    res.json(result);
  });

  // The request this browser started (found through its cookie), so a page that was reloaded or
  // suspended while the customer was in Telegram can carry on instead of starting over.
  r.get('/telegram/current', validate({ query: z.object({ purpose: z.enum(TELEGRAM_AUTH_PURPOSES) }) }), async (req, res) => {
    const { purpose } = req.valid.query as { purpose: (typeof TELEGRAM_AUTH_PURPOSES)[number] };
    const id = req.cookies?.[TG_REQUEST_COOKIE];
    const found = typeof id === 'string' && uuidSchema.safeParse(id).success ? await findOwnRequest(deps, req, id) : null;
    const open = found && found.purpose === purpose && ['PENDING', 'VERIFIED'].includes(effectiveStatus(found));
    res.set('Cache-Control', 'no-store').json({ request: open ? { requestId: found.id, ...statusView(found) } : null });
  });

  r.get('/telegram/:id/status', validate({ params: z.object({ id: uuidSchema }) }), async (req, res) => {
    const { id } = req.valid.params as { id: string };
    const found = await findOwnRequest(deps, req, id);
    if (!found) throw new AppError(404, 'NOT_FOUND', 'Not found');
    res.set('Cache-Control', 'no-store').json(statusView(found));
  });

  r.post('/signup/complete', validate({ body: signupCompleteSchema }), async (req, res) => {
    const { requestId, name, password } = req.valid.body as SignupCompleteInput;
    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(async (tx) => {
      const verified = await consumeVerifiedRequest(tx, req, requestId, 'SIGNUP');
      const taken = await tx.user.findFirst({
        where: { OR: [{ phone: verified.phone! }, { telegramUserId: verified.telegramUserId! }] },
      });
      if (taken) throw new AppError(409, 'PHONE_TAKEN', 'This phone number already has an account');
      return tx.user.create({
        data: {
          phone: verified.phone!,
          name,
          passwordHash,
          telegramUserId: verified.telegramUserId,
          telegramChatId: verified.telegramChatId,
          telegramUsername: verified.telegramUsername,
        },
      });
    });
    res.clearCookie(TG_REQUEST_COOKIE, { path: '/api/v1/auth' });
    await startSession(prisma, config, res, user, { ip: req.ip, userAgent: req.get('user-agent') });
    res.status(201).json({ user: toPublicUser(user) });
  });

  r.post('/reset/complete', validate({ body: resetCompleteSchema }), async (req, res) => {
    const { requestId, password } = req.valid.body as ResetCompleteInput;
    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(async (tx) => {
      const verified = await consumeVerifiedRequest(tx, req, requestId, 'RESET');
      const updated = await tx.user.update({
        where: { phone: verified.phone! },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      await tx.session.updateMany({ where: { userId: updated.id, revokedAt: null }, data: { revokedAt: new Date() } });
      return updated;
    });
    res.clearCookie(TG_REQUEST_COOKIE, { path: '/api/v1/auth' });
    await startSession(prisma, config, res, user, { ip: req.ip, userAgent: req.get('user-agent') });
    res.json({ user: toPublicUser(user) });
  });

  r.post('/me/phone/complete', requireAuth, validate({ body: changePhoneCompleteSchema }), async (req, res) => {
    const { requestId } = req.valid.body as { requestId: string };
    const user = await prisma.$transaction(async (tx) => {
      const verified = await consumeVerifiedRequest(tx, req, requestId, 'CHANGE_PHONE');
      if (verified.userId !== req.user!.id) throw new AppError(409, 'TELEGRAM_NOT_VERIFIED', 'Verification mismatch');
      return tx.user.update({ where: { id: req.user!.id }, data: { phone: verified.phone! } });
    });
    res.clearCookie(TG_REQUEST_COOKIE, { path: '/api/v1/auth' });
    res.json({ user: toPublicUser(user) });
  });

  return r;
}
