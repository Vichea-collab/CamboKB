import { createReportApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { createInvoiceRenderer } from './invoice';
import { createLogger } from './logger';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const pool = createPool(config.databaseUrl);
const invoices = await createInvoiceRenderer({ chromePath: config.chromePath, workers: config.pdfWorkers });
const app = createReportApp({ config, pool, invoices, logger });
const server = app.listen(config.port, () => logger.info(`report service listening on :${config.port}`));

const shutdown = () => {
  server.close(async () => {
    await invoices.close();
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
