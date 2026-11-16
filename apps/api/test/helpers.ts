import { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import { createApp, type AppDeps } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { createLogger } from '../src/logger';
import type { StorageAdapter } from '../src/storage/types';
import type { TelegramClient } from '../src/telegram/client';
import { DEFAULT_DELIVERY_SETTINGS } from '@cambo/shared';

export const WEB_ORIGIN = 'http://localhost:5173';

let prisma: PrismaClient | undefined;
export function testPrisma(): PrismaClient {
  prisma ??= new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });
  return prisma;
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL_TEST,
    WEB_ORIGIN,
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_BOT_USERNAME: 'CamboSupplyBot',
    TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
    TELEGRAM_ADMIN_CHAT_ID: '5000',
    TELEGRAM_MODE: 'webhook',
    STORAGE_DRIVER: 'local',
    PUBLIC_UPLOADS_URL: 'http://localhost:4000/uploads',
  });
  return { ...base, ...overrides };
}

export class FakeTelegramClient implements TelegramClient {
  sent: { chatId: number | string; text: string; opts?: Parameters<TelegramClient['sendMessage']>[2] }[] = [];
  failSends = false;
  async sendMessage(chatId: number | string, text: string, opts?: Parameters<TelegramClient['sendMessage']>[2]) {
    if (this.failSends) throw new Error('telegram down');
    this.sent.push({ chatId, text, opts });
  }
  async getUpdates() {
    return [];
  }
  async setWebhook() {}
}

export class MemoryStorage implements StorageAdapter {
  files = new Map<string, { body: Buffer; contentType: string }>();
  async put(key: string, body: Buffer, contentType: string) {
    this.files.set(key, { body, contentType });
  }
  async delete(key: string) {
    this.files.delete(key);
  }
  url(key: string) {
    return `http://test.local/uploads/${key}`;
  }
}

export async function resetDb(db: PrismaClient = testPrisma()) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await db.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  }
  await db.storeSetting.create({ data: { id: 1, delivery: DEFAULT_DELIVERY_SETTINGS } });
}

export async function createTestApp(
  overrides: Partial<AppDeps> = {},
): Promise<{ app: Express; prisma: PrismaClient; telegram: FakeTelegramClient; storage: MemoryStorage; deps: AppDeps }> {
  const telegram = new FakeTelegramClient();
  const storage = new MemoryStorage();
  const deps: AppDeps = {
    config: testConfig(),
    prisma: testPrisma(),
    storage,
    telegram,
    logger: createLogger('silent'),
    ...overrides,
  };
  return { app: createApp(deps), prisma: deps.prisma, telegram, storage, deps };
}
