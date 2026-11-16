import { createReportApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { createLogger } from './logger';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const pool = createPool(config.databaseUrl);
const app = createReportApp({ config, pool, logger });
const server = app.listen(config.port, () => logger.info(`report service listening on :${config.port}`));

const shutdown = () => {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
