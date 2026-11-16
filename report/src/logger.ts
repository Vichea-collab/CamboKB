import pino from 'pino';

export type Logger = pino.Logger;
export const createLogger = (level: string) =>
  pino({ level, redact: { paths: ['req.headers.authorization'], remove: true } });
