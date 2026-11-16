import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', '*.password', '*.passwordHash'],
      remove: true,
    },
    transport: pretty ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  });
}
