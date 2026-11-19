import pino from 'pino';
import { currentRequestId } from './context';

export type Logger = pino.Logger;

/**
 * One JSON object per line on stdout: `service`, a text `level`, an ISO `time`, and the request id of
 * whatever was being handled. The log collector (Alloy -> Loki) turns these into searchable labels.
 */
export function createLogger(opts: {
  service: string;
  level: string;
  pretty?: boolean;
  /** Where the lines go (stdout by default); tests pass their own. */
  destination?: pino.DestinationStream;
}): Logger {
  return pino(
    {
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
          'req.headers["proxy-authorization"]',
          'req.headers["x-api-key"]',
          // Telegram's webhook secret: whoever has it can post fake updates to the bot.
          'req.headers["x-telegram-bot-api-secret-token"]',
          'res.headers["set-cookie"]',
          '*.password',
          '*.passwordHash',
          '*.token',
          '*.secret',
        ],
        remove: true,
      },
      transport:
        opts.pretty && !opts.destination
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    opts.destination,
  );
}
