import { Router } from 'express';
import type { AppDeps } from '../../http/app';
import { AppError } from '../../http/errors';
import { eventsHealth } from '../events/outbox';

/** Lets the admin check that Telegram alerts are wired up, and send themselves a test. The bot lives in the notification service. */
export function adminTelegramRouter(deps: AppDeps): Router {
  const r = Router();

  r.get('/telegram/status', async (_req, res) => {
    const settings = await deps.prisma.storeSetting.findUnique({ where: { id: 1 } });
    const alertsOn = settings?.telegramNotify ?? true;
    const health = (await eventsHealth(deps))['notification']!;
    try {
      const n = await deps.notification.status();
      res.json({
        serviceReachable: true,
        mode: n.mode,
        botConfigured: n.botConfigured,
        adminChatSet: n.adminChatSet,
        alertsOn,
        outbox: n.outbox,
        waitingForService: { pending: health.pending, failed: health.failed },
      });
    } catch {
      res.json({
        serviceReachable: false,
        mode: 'off',
        botConfigured: false,
        adminChatSet: false,
        alertsOn,
        outbox: { pending: 0, failed: 0, oldestPendingAgeSec: null, lastError: health.lastError },
        waitingForService: { pending: health.pending, failed: health.failed },
      });
    }
  });

  r.post('/telegram/test', async (_req, res) => {
    try {
      await deps.notification.sendTest();
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        503,
        'NOTIFICATION_SERVICE_UNAVAILABLE',
        'The notification service is unavailable',
      );
    }
    res.json({ queued: true });
  });

  return r;
}
