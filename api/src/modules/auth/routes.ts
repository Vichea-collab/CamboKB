import {
  changePhoneCompleteSchema,
  loginCompleteSchema,
  TELEGRAM_AUTH_PURPOSES,
  telegramStartSchema,
  telegramWebAppSchema,
  uuidSchema,
  type LoginCompleteInput,
  type TelegramStartInput,
  type TelegramWebAppInput,
} from '@cambo/shared';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Router, type RequestHandler, type Response } from 'express';
import type { AppDeps } from '../../http/app';
import { AppError } from '../../http/errors';
import { requireAuth } from '../../http/middleware/auth';
import { limiter } from '../../http/middleware/rate-limit';
import { validate } from '../../http/middleware/validate';
import { clearSessionCookie, randomToken, revokeAllSessions, revokeSession, sha256, startSession, toPublicUser } from './sessions';
import {
  consumeVerifiedRequest,
  effectiveStatus,
  findOwnRequest,
  startTelegramAuth,
  statusView,
  TG_REQUEST_COOKIE,
  TG_REQUEST_TTL_MS,
} from './telegram-verification';
import { verifyWebAppInitData, WEBAPP_MAX_AGE_SEC } from './telegram-webapp';

export function authRouter(deps: AppDeps): Router {
  const { prisma, config } = deps;
  const r = Router();

  /** Remember (by cookie) which browser started or claimed a verification request. */
  const bindRequest = (res: Response, requestId: string) =>
    res.cookie(TG_REQUEST_COOKIE, requestId, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      path: '/api/v1/auth',
      domain: config.cookieDomain || undefined,
      maxAge: TG_REQUEST_TTL_MS + 5 * 60 * 1000,
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

  /**
   * The web app's "who is signed in?" probe. Unlike /me it answers 200 with `user: null` for a guest,
   * so every first page load doesn't log a red 401 in the browser console.
   */
  r.get('/session', (req, res) => {
    res.json({ user: req.user ? toPublicUser(req.user) : null });
  });

  // --- Telegram: log in / sign up, change phone, share a location ---

  // Sharing a delivery location is something a signed-in customer retries at checkout, so it has its own,
  // larger allowance and never uses up (or is blocked by) the sign-up / reset budget.
  const startLimit = limiter(10, 15 * 60 * 1000);
  const locationStartLimit = limiter(30, 15 * 60 * 1000);
  const startLimiter: RequestHandler = (req, res, next) =>
    (req.body?.purpose === 'SHARE_LOCATION' ? locationStartLimit : startLimit)(req, res, next);
  r.post('/telegram/start', startLimiter, validate({ body: telegramStartSchema }), async (req, res) => {
    const { purpose } = req.valid.body as TelegramStartInput;
    const needsLogin = purpose === 'CHANGE_PHONE' || purpose === 'SHARE_LOCATION';
    if (needsLogin && !req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
    const result = await startTelegramAuth(deps, {
      purpose,
      userId: needsLogin ? req.user!.id : undefined,
      userAgent: req.get('user-agent'),
    });
    bindRequest(res, result.requestId);
    res.json(result);
  });

  // The website end of a sign-up that started in the bot: the link carries a one-time token. Claiming it
  // ties the verified login request to this browser (then /login/complete starts the session), and the token
  // stops working so a forwarded link is useless.
  r.post('/telegram/claim', limiter(20, 15 * 60 * 1000), validate({ body: z.object({ token: z.string().min(20).max(128) }) }), async (req, res) => {
    const { token } = req.valid.body as { token: string };
    const notVerified = new AppError(409, 'TELEGRAM_NOT_VERIFIED', 'This link has expired or was already used. Please start again.');
    const found = await prisma.telegramAuthRequest.findUnique({ where: { tokenHash: sha256(token) } });
    if (!found) throw notVerified;
    const { count } = await prisma.telegramAuthRequest.updateMany({
      where: { id: found.id, tokenHash: found.tokenHash, purpose: 'LOGIN', status: 'VERIFIED', expiresAt: { gt: new Date() } },
      data: { tokenHash: sha256(randomToken()) },
    });
    if (count !== 1) throw notVerified;
    bindRequest(res, found.id);
    res.set('Cache-Control', 'no-store').json({ requestId: found.id, ...statusView(found) });
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

  // The website end of "Continue with Telegram": the person tapped "Log me in" in the bot, so the request is
  // VERIFIED and names the account. It is used once, only by the browser that asked (cookie), and the account
  // must still be linked to the very Telegram user who confirmed. Admins go through exactly the same checks.
  r.post('/login/complete', limiter(30, 15 * 60 * 1000), validate({ body: loginCompleteSchema }), async (req, res) => {
    const { requestId } = req.valid.body as LoginCompleteInput;
    const user = await prisma.$transaction(async (tx) => {
      const verified = await consumeVerifiedRequest(tx, req, requestId, 'LOGIN');
      const account = verified.userId ? await tx.user.findUnique({ where: { id: verified.userId } }) : null;
      if (account?.disabledAt) throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is disabled. Please contact the shop.');
      if (
        !account ||
        account.telegramUserId === null ||
        account.telegramUserId !== verified.telegramUserId
      ) {
        throw new AppError(409, 'TELEGRAM_NOT_VERIFIED', 'Login was not confirmed. Please start again.');
      }
      return account;
    });
    res.clearCookie(TG_REQUEST_COOKIE, { path: '/api/v1/auth' });
    await startSession(prisma, config, res, user, { ip: req.ip, userAgent: req.get('user-agent') });
    res.set('Cache-Control', 'no-store').json({ user: toPublicUser(user) });
  });

  // Inside Telegram the store opens as a Mini App and Telegram already says who is looking, signed with the
  // bot's key. Check the signature, accept each one once, and log in the account linked to that Telegram user.
  r.post('/telegram/webapp', limiter(30, 15 * 60 * 1000), validate({ body: telegramWebAppSchema }), async (req, res) => {
    const { initData } = req.valid.body as TelegramWebAppInput;
    const key = config.telegram.webAppKey;
    if (!key) throw new AppError(503, 'TELEGRAM_WEBAPP_NOT_CONFIGURED', 'Telegram sign-in is not available here');
    const who = verifyWebAppInitData(initData, key);
    if (!who) throw new AppError(401, 'TELEGRAM_INITDATA_INVALID', 'Telegram could not confirm who you are. Please use Continue with Telegram.');
    const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(who.telegramUserId) } });
    if (!user || user.disabledAt) {
      throw new AppError(401, 'TELEGRAM_NOT_LINKED', 'This Telegram account has no Cambo Supply account yet. Please use Continue with Telegram.');
    }
    try {
      await prisma.telegramWebAppHash.create({
        data: { hash: who.hash, expiresAt: new Date((who.authDate + WEBAPP_MAX_AGE_SEC) * 1000 + 60_000) },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(401, 'TELEGRAM_INITDATA_INVALID', 'Telegram could not confirm who you are. Please use Continue with Telegram.');
      }
      throw err;
    }
    // Housekeeping: forget signatures that can no longer be replayed anyway (they are past the age limit).
    void prisma.telegramWebAppHash.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
    await startSession(prisma, config, res, user, { ip: req.ip, userAgent: req.get('user-agent') });
    res.set('Cache-Control', 'no-store').json({ user: toPublicUser(user) });
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
