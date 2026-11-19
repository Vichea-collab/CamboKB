import { createLogger as createKitLogger, type Logger } from '@cambo/service-kit';

export type { Logger };
export const createLogger = (level: string, pretty = false) =>
  createKitLogger({ service: 'api', level, pretty });
