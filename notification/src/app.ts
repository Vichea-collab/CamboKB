import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createMetrics,
  currentRequestId,
  requestContext,
  requireServiceSecret,
} from '@cambo/service-kit';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type pg from 'pg';
import { pinoHttp } from 'pino-http';
import { handleUpdate, type BotDeps } from './bot';
import type { NotificationConfig } from './config';
import { NotificationError } from './errors';
import { handleEvent } from './events';
import type { Logger } from './logger';
import type { Outbox } from './outbox';
import { TOPIC_KEYS, TOPICS } from './topics';
import type { TelegramClient, TgUpdate } from './telegram';
import type { ApiClient } from './api-client';

export type NotificationDeps = {
  config: NotificationConfig;
  pool: pg.Pool;
  outbox: Outbox;
  telegram: TelegramClient;
  api: ApiClient;
  logger: Logger;
  metrics: ReturnType<typeof createMetrics>;
};

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createNotificationApp(deps: NotificationDeps) {
  const { config, pool, outbox, logger, metrics } = deps;
  const events = metrics.counter('notification_events_total', 'Events received from the api', [
    'type',
    'result',
  ] as const);
  const botDeps: BotDeps = { config, telegram: deps.telegram, api: deps.api, outbox, logger };

  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext());
  app.use(metrics.middleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: () => currentRequestId() ?? randomUUID(),
      autoLogging: {
        ignore: (req) => req.url === '/healthz' || req.url === '/readyz' || req.url === '/metrics',
      },
    }),
  );
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/readyz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  app.get('/metrics', metrics.handler);

  // Telegram calls this (through nginx) in webhook mode. It proves who it is with the secret header.
  app.post('/webhook', async (req, res) => {
    const secret = config.telegram.webhookSecret;
    if (!secret || !safeEqual(req.get('x-telegram-bot-api-secret-token') ?? '', secret))
      throw new NotificationError(401, 'UNAUTHORIZED', 'Bad webhook secret');
    try {
      await handleUpdate(botDeps, req.body as TgUpdate);
    } catch (err) {
      req.log.error({ err }, 'telegram update failed');
    }
    // Always 200 so Telegram doesn't retry forever on our bugs.
    res.json({ ok: true });
  });

  const internal = express.Router();
  internal.use(
    requireServiceSecret(
      config.secret,
      () => new NotificationError(401, 'UNAUTHORIZED', 'Missing or invalid service credentials'),
    ),
  );

  // The api tells us what happened. At-least-once: a repeat is recognised and ignored.
  internal.post('/events', async (req, res) => {
    const type =
      typeof req.body?.type === 'string' ? String(req.body.type).slice(0, 40) : 'unknown';
    try {
      const result = await handleEvent({ pool, outbox, config }, req.body);
      events.inc({ type, result });
      req.log.info({ eventType: type, eventId: req.body?.id, result }, 'event received');
      res.json({ result });
    } catch (err) {
      events.inc({ type, result: err instanceof NotificationError ? 'rejected' : 'error' });
      throw err;
    }
  });

  internal.get('/status', async (_req, res) => {
    res.json({
      mode: config.telegram.mode,
      botConfigured: config.telegram.mode !== 'off' && Boolean(config.telegram.botToken),
      adminChatSet: Boolean(config.telegram.adminChatId),
      outbox: await outbox.health(),
    });
  });

  internal.post('/test', async (_req, res) => {
    const chatId = config.telegram.adminChatId;
    if (config.telegram.mode === 'off')
      throw new NotificationError(
        409,
        'TELEGRAM_OFF',
        'The Telegram bot is turned off (TELEGRAM_MODE=off)',
      );
    if (!chatId)
      throw new NotificationError(
        409,
        'NO_ADMIN_CHAT',
        'Set TELEGRAM_ADMIN_CHAT_ID to the chat that should get alerts',
      );
    await outbox.enqueue({
      chatId,
      text: '✅ Test message from Cambo Supply. Telegram alerts are working.',
      requestId: currentRequestId(),
    });
    // One line in every topic: a new group gets its topics, and the owner sees where each alert will land.
    for (const key of TOPIC_KEYS)
      await outbox.enqueue({
        chatId,
        topic: key,
        text: `✅ ${TOPICS[key].name}: alerts of this kind will appear in this topic.`,
        requestId: currentRequestId(),
      });
    res.json({ queued: true });
  });

  app.use('/internal', internal);
  app.use((_req, _res, next) => next(new NotificationError(404, 'NOT_FOUND', 'Not found')));
  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    const known = err instanceof NotificationError;
    if (!known) req.log?.error({ err }, 'unhandled error');
    res
      .status(known ? err.status : 500)
      .json({
        error: {
          code: known ? err.code : 'INTERNAL',
          message: known ? err.message : 'Something went wrong',
        },
      });
  };
  app.use(onError);
  return app;
}
