import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import type { TgUpdate } from './client';
import { handleTelegramUpdate } from './updates';

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function telegramRouter(deps: AppDeps): Router {
  const r = Router();
  r.post('/webhook', async (req, res) => {
    const secret = deps.config.telegram.webhookSecret;
    const given = req.get('x-telegram-bot-api-secret-token') ?? '';
    if (!secret || !safeEqual(given, secret)) throw new AppError(401, 'UNAUTHORIZED', 'Bad webhook secret');
    try {
      await handleTelegramUpdate(deps, req.body as TgUpdate);
    } catch (err) {
      req.log.error({ err }, 'telegram update failed');
    }
    // Always 200 so Telegram doesn't retry forever on our bugs.
    res.json({ ok: true });
  });
  return r;
}
