import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Config } from '../config';
import type { Logger } from '../lib/logger';
import { adminRouter } from '../modules/admin';
import { authRouter } from '../modules/auth/routes';
import { loadUser } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { originCheck } from './middleware/origin';
import { seoRouter } from '../modules/seo/routes';
import { storeRouter } from '../modules/store/routes';
import { telegramRouter } from '../modules/bot/webhook';
import { accountRouter } from '../modules/account/routes';
import { catalogRouter } from '../modules/catalog/routes';
import { checkoutRouter } from '../modules/orders/routes';
import type { FileClient } from '../integrations/files/client';
import type { BakongClient } from '../integrations/bakong/client';
import type { ReportClient } from '../integrations/reports/client';
import { paymentRouter } from '../modules/payments/routes';
import { customerInvoiceRouter } from '../modules/reports/routes';
import type { TelegramClient } from '../integrations/telegram/client';

export type AppDeps = {
  config: Config;
  prisma: PrismaClient;
  files: FileClient;
  reports: ReportClient;
  bakong: BakongClient;
  telegram: TelegramClient;
  logger: Logger;
};

export function createApp(deps: AppDeps): express.Express {
  const { config, prisma, logger } = deps;
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string) || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/readyz' },
    }),
  );
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.webOrigin, credentials: true, maxAge: 600 }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/readyz', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

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
  api.use('/telegram', telegramRouter(deps));
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler(config.isProduction));
  return app;
}
