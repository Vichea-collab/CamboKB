import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
    DATABASE_URL: z.string().min(1),
    WEB_ORIGIN: z.string().default('http://localhost:5173'),
    COOKIE_DOMAIN: z.string().optional(),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
    TRUST_PROXY: bool,
    TELEGRAM_MODE: z.enum(['webhook', 'polling', 'off']).default('off'),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_BOT_USERNAME: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    TELEGRAM_WEBHOOK_URL: z.url().optional(),
    TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
    FILE_SERVICE_URL: z.url().default('http://localhost:4100'),
    FILE_SERVICE_SECRET: z.string().default('dev-file-secret-change-me-0123456789'),
    PUBLIC_FILES_URL: z.url().optional(),
    REPORT_SERVICE_URL: z.url().default('http://localhost:4200'),
    REPORT_SERVICE_SECRET: z.string().default('dev-report-secret-change-me-0123456789'),
    RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    SERVE_WEB_DIR: z.string().optional(),
  })
  .superRefine((e, ctx) => {
    if (e.TELEGRAM_MODE !== 'off') {
      for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME'] as const) {
        if (!e[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when TELEGRAM_MODE is not off' });
      }
    }
    if (e.TELEGRAM_MODE === 'webhook' && !e.TELEGRAM_WEBHOOK_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['TELEGRAM_WEBHOOK_SECRET'], message: 'required for webhook mode' });
    }
    if (e.NODE_ENV === 'production') {
      for (const key of ['FILE_SERVICE_SECRET', 'REPORT_SERVICE_SECRET'] as const) {
        if (e[key].length < 32 || e[key].startsWith('dev-')) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'set a random secret of at least 32 characters' });
        }
      }
    }
  });

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  logLevel: string;
  databaseUrl: string;
  webOrigin: string[];
  cookieDomain?: string;
  sessionTtlDays: number;
  trustProxy: boolean;
  telegram: {
    mode: 'webhook' | 'polling' | 'off';
    botToken?: string;
    botUsername?: string;
    webhookSecret?: string;
    webhookUrl?: string;
    adminChatId?: string;
  };
  services: {
    fileUrl: string;
    fileSecret: string;
    publicFilesUrl: string;
    reportUrl: string;
    reportSecret: string;
  };
  rateLimit: { loginMax: number; windowMs: number };
  serveWeb?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    port: e.PORT,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    databaseUrl: e.DATABASE_URL,
    webOrigin: e.WEB_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
    cookieDomain: e.COOKIE_DOMAIN,
    sessionTtlDays: e.SESSION_TTL_DAYS,
    trustProxy: e.TRUST_PROXY,
    telegram: {
      mode: e.TELEGRAM_MODE,
      botToken: e.TELEGRAM_BOT_TOKEN,
      botUsername: e.TELEGRAM_BOT_USERNAME,
      webhookSecret: e.TELEGRAM_WEBHOOK_SECRET,
      webhookUrl: e.TELEGRAM_WEBHOOK_URL,
      adminChatId: e.TELEGRAM_ADMIN_CHAT_ID,
    },
    services: {
      fileUrl: e.FILE_SERVICE_URL.replace(/\/$/, ''),
      fileSecret: e.FILE_SERVICE_SECRET,
      publicFilesUrl: (e.PUBLIC_FILES_URL ?? `${e.FILE_SERVICE_URL.replace(/\/$/, '')}/files`).replace(/\/$/, ''),
      reportUrl: e.REPORT_SERVICE_URL.replace(/\/$/, ''),
      reportSecret: e.REPORT_SERVICE_SECRET,
    },
    rateLimit: { loginMax: e.RATE_LIMIT_LOGIN_MAX, windowMs: e.RATE_LIMIT_WINDOW_MS },
    serveWeb: e.SERVE_WEB_DIR,
  };
}
