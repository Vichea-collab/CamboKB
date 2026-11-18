import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4100),
    LOG_LEVEL: z.string().optional(),
    FILE_SERVICE_SECRET: z.string().min(1),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    UPLOADS_DIR: z.string().default('./uploads'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    TRUST_PROXY: z.enum(['true', 'false']).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production' && (e.FILE_SERVICE_SECRET.length < 32 || e.FILE_SERVICE_SECRET.startsWith('dev-'))) {
      ctx.addIssue({ code: 'custom', path: ['FILE_SERVICE_SECRET'], message: 'set a random secret of at least 32 characters' });
    }
    if (e.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!e[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required for s3 storage' });
      }
    }
  });

export type FileConfig = {
  nodeEnv: string;
  port: number;
  logLevel: string;
  secret: string;
  corsOrigin: string[];
  trustProxy: boolean;
  storage:
    | { driver: 'local'; dir: string }
    | { driver: 's3'; bucket: string; region: string; endpoint?: string; accessKeyId: string; secretAccessKey: string };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): FileConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    secret: e.FILE_SERVICE_SECRET,
    corsOrigin: e.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: e.TRUST_PROXY === 'true',
    storage:
      e.STORAGE_DRIVER === 's3'
        ? {
            driver: 's3',
            bucket: e.S3_BUCKET!,
            region: e.S3_REGION,
            endpoint: e.S3_ENDPOINT,
            accessKeyId: e.S3_ACCESS_KEY_ID!,
            secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
          }
        : { driver: 'local', dir: e.UPLOADS_DIR },
  };
}
