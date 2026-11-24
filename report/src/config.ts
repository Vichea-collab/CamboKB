import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4200),
    LOG_LEVEL: z.string().optional(),
    REPORT_DATABASE_URL: z.string().min(1),
    REPORT_SERVICE_SECRET: z.string().min(1),
    STORE_NAME: z.string().default('Cambo Keyboard Supply'),
    CHROME_PATH: z.string().optional(),
    /** PDFs made at the same time; more wait their turn. */
    PDF_WORKERS: z.coerce.number().int().min(1).max(8).default(2),
    /** Chromium is closed after this long without a PDF to make. */
    PDF_IDLE_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production' && (e.REPORT_SERVICE_SECRET.length < 32 || e.REPORT_SERVICE_SECRET.startsWith('dev-'))) {
      ctx.addIssue({ code: 'custom', path: ['REPORT_SERVICE_SECRET'], message: 'set a random secret of at least 32 characters' });
    }
  });

export type ReportConfig = { port: number; logLevel: string; databaseUrl: string; secret: string; storeName: string; chromePath?: string; pdfWorkers: number; pdfIdleMs: number };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ReportConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    databaseUrl: e.REPORT_DATABASE_URL,
    secret: e.REPORT_SERVICE_SECRET,
    storeName: e.STORE_NAME,
    chromePath: e.CHROME_PATH,
    pdfWorkers: e.PDF_WORKERS,
    pdfIdleMs: e.PDF_IDLE_SECONDS * 1000,
  };
}
