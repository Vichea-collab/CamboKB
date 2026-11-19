import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Config } from '../config';
import type { Logger } from '../lib/logger';
import { currentRequestId, requestContext, type Metrics } from '@cambo/service-kit';
import { adminRouter } from '../modules/admin';
import { authRouter } from '../modules/auth/routes';
import { loadUser } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { originCheck } from './middleware/origin';
import { seoRouter } from '../modules/seo/routes';
import { storeRouter } from '../modules/store/routes';
import { accountRouter } from '../modules/account/routes';
import { catalogRouter } from '../modules/catalog/routes';
import { checkoutRouter } from '../modules/orders/routes';
import type { FileClient } from '../integrations/files/client';
import type { BakongClient } from '../integrations/bakong/client';
import type { ReportClient } from '../integrations/reports/client';
import { paymentRouter } from '../modules/payments/routes';
import { customerInvoiceRouter } from '../modules/reports/routes';
import type { EventSender } from '../integrations/services/events';
import type { NotificationClient } from '../integrations/services/notification';
import { internalRouter } from '../modules/internal/routes';
import { registerEventMetrics } from '../modules/events/outbox';
import { registerAppMetrics } from '../lib/app-metrics';

export type AppDeps = {
  config: Config;
  prisma: PrismaClient;
  files: FileClient;
  reports: ReportClient;
  bakong: BakongClient;
  /** Delivers events to the report and notification services. */
  events: EventSender;
  notification: NotificationClient;
  metrics: Metrics;
  logger: Logger;
};

export function createApp(deps: AppDeps): express.Express {
  const { config, prisma, logger, metrics } = deps;
  registerEventMetrics(deps);
  registerAppMetrics(deps.metrics);
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  // One id per request, forwarded to every service we call and stamped on every log line.
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
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.webOrigin, credentials: true, maxAge: 600 }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });
  // Prometheus scrapes this on the private network. nginx never routes /metrics or /internal.
  app.get('/metrics', metrics.handler);
  app.get('/readyz', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use('/internal', internalRouter(deps));
  app.use(originCheck(config.webOrigin));
  app.use(seoRouter(deps));

  const api = express.Router();
  api.use(loadUser(deps));
  api.use('/auth', authRouter(deps));
  api.use(catalogRouter(deps));
  api.use(storeRouter(deps));
  api.use(customerInvoiceRouter(deps));
  api.use(paymentRouter(deps));
  api.use(checkoutRouter(deps));
  api.use(accountRouter(deps));
  api.use('/admin', adminRouter(deps));
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler(config.isProduction));
  return app;
}
