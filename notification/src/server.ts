import { createMetrics, migrate } from '@cambo/service-kit';
import { HttpApiClient } from './api-client';
import { createNotificationApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { createLogger } from './logger';
import { Outbox } from './outbox';
import { startPolling } from './poller';
import { setupBot } from './setup';
import { HttpTelegramClient, NoopTelegramClient, type TelegramClient } from './telegram';

const config = loadConfig();
const logger = createLogger(config.logLevel, config.nodeEnv === 'development');
const pool = createPool(config.databaseUrl);
const applied = await migrate(pool, new URL('../migrations', import.meta.url));
if (applied.length) logger.info({ applied }, 'database migrated');

const telegram: TelegramClient =
  config.telegram.mode === 'off' || !config.telegram.botToken
    ? new NoopTelegramClient((m) => logger.info(m))
    : new HttpTelegramClient(config.telegram.botToken);
const metrics = createMetrics('notification');
const outbox = new Outbox(pool, telegram, logger, metrics);
const api = new HttpApiClient(config.apiUrl, config.apiSecret);
const deps = { config, pool, outbox, telegram, api, logger, metrics };

const app = createNotificationApp(deps);
const server = app.listen(config.port, () =>
  logger.info(
    `notification service listening on :${config.port} (telegram: ${config.telegram.mode})`,
  ),
);
const stopOutbox = outbox.start();

// Telegram: long polling in development, webhook registration in production.
let stopPolling = () => {};
if (config.telegram.mode !== 'off') await setupBot(deps);
if (config.telegram.mode === 'polling') {
  logger.info('Telegram: polling for updates');
  stopPolling = startPolling(deps);
} else if (
  config.telegram.mode === 'webhook' &&
  config.telegram.webhookUrl &&
  config.telegram.webhookSecret
) {
  await telegram
    .setWebhook(config.telegram.webhookUrl, config.telegram.webhookSecret)
    .then(() => logger.info('Telegram: webhook registered'))
    .catch((err) => logger.error({ err }, 'Telegram: webhook registration failed'));
}

const shutdown = (signal: string) => {
  logger.info(`${signal} received, shutting down`);
  stopOutbox();
  stopPolling();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
