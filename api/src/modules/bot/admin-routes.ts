import { Router } from 'express';
import type { AppDeps } from '../../http/app';
import { AppError } from '../../http/errors';
import { enqueueTelegram, outboxHealth } from './outbox';

/** Lets the admin check that Telegram alerts are wired up, and send themselves a test. */
export function adminTelegramRouter(deps: AppDeps): Router {
  const r = Router();

  r.get('/telegram/status', async (_req, res) => {
    const { config, prisma } = deps;
    const settings = await prisma.storeSetting.findUnique({ where: { id: 1 } });
    res.json({
      mode: config.telegram.mode,
      botConfigured: config.telegram.mode !== 'off' && Boolean(config.telegram.botToken),
      adminChatSet: Boolean(config.telegram.adminChatId),
      alertsOn: settings?.telegramNotify ?? true,
      outbox: await outboxHealth(deps),
    });
  });

  r.post('/telegram/test', async (_req, res) => {
    const chatId = deps.config.telegram.adminChatId;
    if (deps.config.telegram.mode === 'off') throw new AppError(409, 'TELEGRAM_OFF', 'The Telegram bot is turned off (TELEGRAM_MODE=off)');
    if (!chatId) throw new AppError(409, 'NO_ADMIN_CHAT', 'Set TELEGRAM_ADMIN_CHAT_ID to the chat that should get alerts');
    await enqueueTelegram(deps, { chatId, text: '✅ Test message from Cambo Supply. Telegram alerts are working.' });
    res.json({ queued: true });
  });

  return r;
}
