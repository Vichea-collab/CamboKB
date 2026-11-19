import { createMetrics } from '@cambo/service-kit';
import { createApp } from './http/app';
import { loadConfig } from './config';
import { createLogger } from './lib/logger';
import { createPrisma } from './db/prisma';
import { HttpBakongClient } from './integrations/bakong/client';
import { HttpFileClient } from './integrations/files/client';
import { HttpReportClient } from './integrations/reports/client';
import { HttpEventSender } from './integrations/services/events';
import { HttpNotificationClient } from './integrations/services/notification';
import { startEventWorker } from './modules/events/outbox';
import { startKhqrSweeper } from './modules/payments/khqr';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, config.nodeEnv === 'development');
  const prisma = createPrisma(config.databaseUrl);
  const files = new HttpFileClient(
    config.services.fileUrl,
    config.services.fileSecret,
    config.services.publicFilesUrl,
  );
  const reports = new HttpReportClient(config.services.reportUrl, config.services.reportSecret);
  const bakong = new HttpBakongClient(config.bakong.apiUrl, config.bakong.token);
  const events = new HttpEventSender({
    report: { url: config.services.reportUrl, secret: config.services.reportSecret },
    notification: {
      url: config.services.notificationUrl,
      secret: config.services.notificationSecret,
    },
  });
  const notification = new HttpNotificationClient(
    config.services.notificationUrl,
    config.services.notificationSecret,
  );
  const deps = {
    config,
    prisma,
    files,
    reports,
    bakong,
    events,
    notification,
    metrics: createMetrics('api'),
    logger,
  };

  const app = createApp(deps);
  const server = app.listen(config.port, () => logger.info(`API listening on :${config.port}`));
  // Delivers what the other services have not received yet, and retries what failed.
  const stopEvents = startEventWorker(deps);
  const stopSweeper = config.bakong.enabled ? startKhqrSweeper(deps) : () => {};
  if (!config.bakong.enabled)
    logger.info('KHQR payments off (set BAKONG_ACCOUNT_ID and BAKONG_TOKEN to turn them on)');

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    stopEvents();
    stopSweeper();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
