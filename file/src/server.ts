import { migrate } from '@cambo/service-kit';
import { createFileApp } from './app';
import { AssetRegistry } from './assets';
import { loadConfig } from './config';
import { createPool } from './db';
import { createLogger } from './logger';
import { createStorage } from './storage';

const config = loadConfig();
const logger = createLogger(config.logLevel, config.nodeEnv === 'development');
const pool = createPool(config.databaseUrl);
const applied = await migrate(pool, new URL('../migrations', import.meta.url));
if (applied.length) logger.info({ applied }, 'database migrated');
const app = createFileApp({
  config,
  storage: createStorage(config),
  assets: new AssetRegistry(pool),
  logger,
});
const server = app.listen(config.port, () =>
  logger.info(`file service listening on :${config.port} (${config.storage.driver})`),
);

const shutdown = () => {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
