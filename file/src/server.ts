import { createFileApp } from './app';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { createStorage } from './storage';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const app = createFileApp({ config, storage: createStorage(config), logger });
const server = app.listen(config.port, () => logger.info(`file service listening on :${config.port} (${config.storage.driver})`));

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
