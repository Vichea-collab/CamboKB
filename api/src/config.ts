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
    // Admins get a shorter session: it never slides, it ends this many days after login.
    ADMIN_SESSION_TTL_DAYS: z.coerce.number().int().positive().default(1),
    TRUST_PROXY: bool,
    // Secure cookies need https. Defaults to on in production; set COOKIE_SECURE=false only for a plain-http local stack.
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),
    // The bot itself (token, webhook, admin chat) belongs to the notification service. The api only
    // needs the bot's name to build the sign-up link.
    TELEGRAM_BOT_USERNAME: z.string().optional(),
    // hex(HMAC_SHA256("WebAppData", bot token)): lets the api check Mini App signatures without holding the bot token.
    TELEGRAM_WEBAPP_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'Use the 64-character hex key (see docs/deployment.md)')
      .optional(),
    NOTIFICATION_SERVICE_URL: z.url().default('http://localhost:4300'),
    NOTIFICATION_SERVICE_SECRET: z.string().default('dev-notification-secret-change-me-012345'),
    // What the notification service must send when it calls the api (/internal/*).
    API_INTERNAL_SECRET: z.string().default('dev-api-internal-secret-change-me-0123456'),
    FILE_SERVICE_URL: z.url().default('http://localhost:4100'),
    FILE_SERVICE_SECRET: z.string().default('dev-file-secret-change-me-0123456789'),
    PUBLIC_FILES_URL: z.url().optional(),
    REPORT_SERVICE_URL: z.url().default('http://localhost:4200'),
    REPORT_SERVICE_SECRET: z.string().default('dev-report-secret-change-me-0123456789'),
    // Optional. Unset: no cache and an in-memory rate limiter (a single api instance). Set: the catalogue cache and the
    // rate limits live in Redis.
    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\//, 'Use a redis:// or rediss:// URL')
      .optional(),
    RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),
    SERVE_WEB_DIR: z.string().optional(),
    // Bakong KHQR. Payments are offered only when both the account and the token are set.
    BAKONG_ACCOUNT_ID: z
      .string()
      .trim()
      .regex(/^[^@\s]+@[a-z0-9]+$/i, 'Use a Bakong account ID like name@aclb')
      .optional(),
    BAKONG_TOKEN: z.string().optional(),
    BAKONG_API_URL: z.url().default('https://api-bakong.nbc.gov.kh'),
    BAKONG_MERCHANT_NAME: z.string().trim().min(1).max(25).default('Cambo Keyboard Supply'),
    BAKONG_MERCHANT_CITY: z.string().trim().min(1).max(15).default('Phnom Penh'),
    KHQR_QR_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
    KHQR_ORDER_HOLD_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .default(10),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production') {
      if (!e.TELEGRAM_WEBAPP_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['TELEGRAM_WEBAPP_KEY'],
          message: 'required in production: 64 hex characters, hex(HMAC_SHA256("WebAppData", bot token))',
        });
      }
      for (const key of [
        'FILE_SERVICE_SECRET',
        'REPORT_SERVICE_SECRET',
        'NOTIFICATION_SERVICE_SECRET',
        'API_INTERNAL_SECRET',
      ] as const) {
        if (e[key].length < 32 || e[key].startsWith('dev-')) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'set a random secret of at least 32 characters',
          });
        }
      }
    }
  });

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  cookieSecure: boolean;
  port: number;
  logLevel: string;
  databaseUrl: string;
  webOrigin: string[];
  cookieDomain?: string;
  sessionTtlDays: number;
  adminSessionTtlDays: number;
  trustProxy: boolean;
  telegram: { botUsername?: string; webAppKey?: string };
  services: {
    notificationUrl: string;
    notificationSecret: string;
    /** Required of the notification service when it calls the api. */
    internalSecret: string;
    fileUrl: string;
    fileSecret: string;
    publicFilesUrl: string;
    reportUrl: string;
    reportSecret: string;
  };
  /** Redis for the catalogue cache and the rate limits; undefined means neither is used. */
  redisUrl?: string;
  rateLimit: { windowMs: number };
  serveWeb?: string;
  bakong: {
    enabled: boolean;
    accountId: string;
    token: string;
    apiUrl: string;
    merchantName: string;
    merchantCity: string;
    qrTtlMinutes: number;
    holdMinutes: number;
  };
};

/** Docker Compose passes an unset variable as an empty string. Treat that as "not set". */
const withoutEmpty = (env: NodeJS.ProcessEnv) =>
  Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(withoutEmpty(env));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : e.NODE_ENV === 'production',
    port: e.PORT,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    databaseUrl: e.DATABASE_URL,
    webOrigin: e.WEB_ORIGIN.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    cookieDomain: e.COOKIE_DOMAIN,
    sessionTtlDays: e.SESSION_TTL_DAYS,
    adminSessionTtlDays: e.ADMIN_SESSION_TTL_DAYS,
    trustProxy: e.TRUST_PROXY,
    telegram: { botUsername: e.TELEGRAM_BOT_USERNAME, webAppKey: e.TELEGRAM_WEBAPP_KEY },
    services: {
      notificationUrl: e.NOTIFICATION_SERVICE_URL.replace(/\/$/, ''),
      notificationSecret: e.NOTIFICATION_SERVICE_SECRET,
      internalSecret: e.API_INTERNAL_SECRET,
      fileUrl: e.FILE_SERVICE_URL.replace(/\/$/, ''),
      fileSecret: e.FILE_SERVICE_SECRET,
      publicFilesUrl: (
        e.PUBLIC_FILES_URL ?? `${e.FILE_SERVICE_URL.replace(/\/$/, '')}/files`
      ).replace(/\/$/, ''),
      reportUrl: e.REPORT_SERVICE_URL.replace(/\/$/, ''),
      reportSecret: e.REPORT_SERVICE_SECRET,
    },
    redisUrl: e.REDIS_URL,
    rateLimit: { windowMs: e.RATE_LIMIT_WINDOW_MS },
    serveWeb: e.SERVE_WEB_DIR,
    bakong: {
      enabled: Boolean(e.BAKONG_ACCOUNT_ID && e.BAKONG_TOKEN),
      accountId: e.BAKONG_ACCOUNT_ID ?? '',
      token: e.BAKONG_TOKEN ?? '',
      apiUrl: e.BAKONG_API_URL.replace(/\/$/, ''),
      merchantName: e.BAKONG_MERCHANT_NAME,
      merchantCity: e.BAKONG_MERCHANT_CITY,
      qrTtlMinutes: e.KHQR_QR_TTL_MINUTES,
      holdMinutes: e.KHQR_ORDER_HOLD_MINUTES,
    },
  };
}
