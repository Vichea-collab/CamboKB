import { createApp } from './app';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { createPrisma } from './prisma';
import { createStorage } from './storage';
import { HttpTelegramClient, NoopTelegramClient, type TelegramClient } from './telegram/client';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, config.nodeEnv === 'development');
  const prisma = createPrisma(config.databaseUrl);
  const telegram: TelegramClient =
    config.telegram.mode === 'off' || !config.telegram.botToken
      ? new NoopTelegramClient((m) => logger.info(m))
      : new HttpTelegramClient(config.telegram.botToken);
  const storage = createStorage(config);
  const deps = { config, prisma, storage, telegram, logger };

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

/** Telegram polling / webhook registration; filled in by the telegram module. */
async function startBackground(_deps: Parameters<typeof createApp>[0]): Promise<() => void> {
  return () => {};
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
