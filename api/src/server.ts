import { createApp } from './http/app';
import { loadConfig } from './config';
import { createLogger } from './lib/logger';
import { createPrisma } from './db/prisma';
import { HttpFileClient } from './integrations/files/client';
import { HttpReportClient } from './integrations/reports/client';
import { HttpTelegramClient, NoopTelegramClient, type TelegramClient } from './integrations/telegram/client';
import { startPolling } from './modules/bot/poller';
import { setupBot } from './modules/bot/setup';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, config.nodeEnv === 'development');
  const prisma = createPrisma(config.databaseUrl);
  const telegram: TelegramClient =
    config.telegram.mode === 'off' || !config.telegram.botToken
      ? new NoopTelegramClient((m) => logger.info(m))
      : new HttpTelegramClient(config.telegram.botToken);
  const files = new HttpFileClient(config.services.fileUrl, config.services.fileSecret, config.services.publicFilesUrl);
  const reports = new HttpReportClient(config.services.reportUrl, config.services.reportSecret);
  const deps = { config, prisma, files, reports, telegram, logger };

  const app = createApp(deps);
  const server = app.listen(config.port, () => logger.info(`API listening on :${config.port}`));
  const stopBackground = await startBackground(deps);

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    stopBackground();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/** Telegram: long polling in development, webhook registration in production. */
async function startBackground(deps: Parameters<typeof createApp>[0]): Promise<() => void> {
  const { telegram, config, logger } = deps;
  if (config.telegram.mode !== 'off') await setupBot(deps);
  if (config.telegram.mode === 'polling') {
    logger.info('Telegram: polling for updates');
    return startPolling(deps);
  }
  if (config.telegram.mode === 'webhook' && config.telegram.webhookUrl && config.telegram.webhookSecret) {
    await telegram
      .setWebhook(config.telegram.webhookUrl, config.telegram.webhookSecret)
      .then(() => logger.info('Telegram: webhook registered'))
      .catch((err) => logger.error({ err }, 'Telegram: webhook registration failed'));
  }
  return () => {};
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
