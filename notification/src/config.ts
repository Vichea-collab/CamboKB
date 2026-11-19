import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4300),
    LOG_LEVEL: z.string().optional(),
    NOTIFICATION_DATABASE_URL: z.string().min(1),
    /** What the api must send when it calls this service. */
    NOTIFICATION_SERVICE_SECRET: z.string().default('dev-notification-secret-change-me-012345'),
    /** Where the api is, and what this service must send when it calls the api. */
    API_URL: z.url().default('http://localhost:4000'),
    API_INTERNAL_SECRET: z.string().default('dev-api-internal-secret-change-me-0123456'),
    /** Used to link to the shop in messages. */
    WEB_ORIGIN: z.string().default('http://localhost:5173'),
    TELEGRAM_MODE: z.enum(['webhook', 'polling', 'off']).default('off'),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    TELEGRAM_WEBHOOK_URL: z.url().optional(),
    /** The chat that gets new-order alerts: the owner's own Telegram id, or a group id. */
    TELEGRAM_ADMIN_CHAT_ID: z
      .string()
      .regex(/^-?\d+$/, 'a number like 123456789 or -1001234567890')
      .optional(),
  })
  .superRefine((e, ctx) => {
    if (e.TELEGRAM_MODE !== 'off' && !e.TELEGRAM_BOT_TOKEN)
      ctx.addIssue({
        code: 'custom',
        path: ['TELEGRAM_BOT_TOKEN'],
        message: 'required when TELEGRAM_MODE is not off',
      });
    if (e.TELEGRAM_MODE === 'webhook') {
      if (!e.TELEGRAM_WEBHOOK_SECRET)
        ctx.addIssue({
          code: 'custom',
          path: ['TELEGRAM_WEBHOOK_SECRET'],
          message: 'required for webhook mode',
        });
      if (!e.TELEGRAM_WEBHOOK_URL)
        ctx.addIssue({
          code: 'custom',
          path: ['TELEGRAM_WEBHOOK_URL'],
          message: 'required for webhook mode',
        });
    }
    if (e.NODE_ENV === 'production') {
      for (const key of ['NOTIFICATION_SERVICE_SECRET', 'API_INTERNAL_SECRET'] as const) {
        if (e[key].length < 32 || e[key].startsWith('dev-'))
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'set a random secret of at least 32 characters',
          });
      }
    }
  });

export type NotificationConfig = {
  nodeEnv: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  secret: string;
  apiUrl: string;
  apiSecret: string;
  webOrigin: string;
  telegram: {
    mode: 'webhook' | 'polling' | 'off';
    botToken?: string;
    webhookSecret?: string;
    webhookUrl?: string;
    adminChatId?: string;
  };
};

/** Docker Compose passes an unset variable as an empty string. Treat that as "not set". */
const withoutEmpty = (env: NodeJS.ProcessEnv) =>
  Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): NotificationConfig {
  const parsed = envSchema.safeParse(withoutEmpty(env));
  if (!parsed.success) {
    throw new Error(
      `Invalid configuration:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    databaseUrl: e.NOTIFICATION_DATABASE_URL,
    secret: e.NOTIFICATION_SERVICE_SECRET,
    apiUrl: e.API_URL.replace(/\/$/, ''),
    apiSecret: e.API_INTERNAL_SECRET,
    webOrigin: e.WEB_ORIGIN.split(',')[0]!.trim().replace(/\/$/, ''),
    telegram: {
      mode: e.TELEGRAM_MODE,
      botToken: e.TELEGRAM_BOT_TOKEN,
      webhookSecret: e.TELEGRAM_WEBHOOK_SECRET,
      webhookUrl: e.TELEGRAM_WEBHOOK_URL,
      adminChatId: e.TELEGRAM_ADMIN_CHAT_ID,
    },
  };
}
