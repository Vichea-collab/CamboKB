import pino from 'pino';
import { currentRequestId } from './context';

export type Logger = pino.Logger;

/**
 * One JSON object per line on stdout: `service`, a text `level`, an ISO `time`, and the request id of
 * whatever was being handled. The log collector (Alloy -> Loki) turns these into searchable labels.
 */
export function createLogger(opts: { service: string; level: string; pretty?: boolean }): Logger {
  return pino({
    level: opts.level,
    base: { service: opts.service },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    mixin: () => {
      const requestId = currentRequestId();
      return requestId ? { requestId } : {};
    },
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        '*.password',
        '*.passwordHash',
        '*.token',
        '*.secret',
      ],
      remove: true,
    },
    transport: opts.pretty ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  });
}
