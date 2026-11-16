import { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import { createApp, type AppDeps } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { createLogger } from '../src/logger';
import { buildImageUrls, type FileClient } from '../src/files/client';
import { AppError } from '../src/errors';
import type { ReportClient } from '../src/reports/client';
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

const IMAGE_SIGNATURES = ['89504e47', 'ffd8ff', '52494646'];
let fakeImageSeq = 0;

/** Stands in for the file service: accepts PNG/JPEG/WebP bytes and records keys. */
export class FakeFileClient implements FileClient {
  stored: string[] = [];
  deleted: string[] = [];
  async storeImage(body: Buffer, _filename: string, prefix: 'products' | 'banners') {
    const hex = body.subarray(0, 4).toString('hex');
    if (!IMAGE_SIGNATURES.some((sig) => hex.startsWith(sig))) {
      throw new AppError(400, 'UNSUPPORTED_IMAGE', 'Upload a JPEG, PNG or WebP image');
    }
    fakeImageSeq += 1;
    const storageKey = `${prefix}/00000000-0000-4000-9000-${String(fakeImageSeq).padStart(12, '0')}`;
    this.stored.push(storageKey);
    return { storageKey, width: 1200, height: 1200 };
  }
  async deleteImage(storageKey: string) {
    this.deleted.push(storageKey);
  }
  imageUrls(storageKey: string, width: number) {
    return buildImageUrls('http://localhost:4100/files', storageKey, width);
  }
}

/** Stands in for the report service: records calls, returns a fake PDF / JSON. */
export class FakeReportClient implements ReportClient {
  calls: { path: string; query: Record<string, string> }[] = [];
  async invoicePdf(orderId: string) {
    this.calls.push({ path: `/internal/invoices/${orderId}.pdf`, query: {} });
    return Buffer.from(`%PDF-1.7 fake invoice ${orderId}`);
  }
  async get(path: string, query: Record<string, string>) {
    this.calls.push({ path, query });
    if (path.endsWith('.csv')) return { body: Buffer.from('number,total\r\n'), contentType: 'text/csv; charset=utf-8' };
    return { body: Buffer.from(JSON.stringify({ path, query })), contentType: 'application/json; charset=utf-8' };
  }
}

/** Smallest valid PNG header bytes, enough for FakeFileClient's signature check. */
export const TINY_PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

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
): Promise<{ app: Express; prisma: PrismaClient; telegram: FakeTelegramClient; files: FakeFileClient; reports: FakeReportClient; deps: AppDeps }> {
  const telegram = new FakeTelegramClient();
  const files = new FakeFileClient();
  const reports = new FakeReportClient();
  const deps: AppDeps = {
    config: testConfig(),
    prisma: testPrisma(),
    files,
    reports,
    telegram,
    logger: createLogger('silent'),
    ...overrides,
  };
  return { app: createApp(deps), prisma: deps.prisma, telegram, files, reports, deps };
}

import request from 'supertest';
import { hashPassword } from '../src/auth/password';
import type { Role } from '@prisma/client';

let phoneSeq = 0;
/** Unique valid Cambodian mobile numbers for tests: +85512000001, +85512000002, ... */
export function nextPhone(): string {
  phoneSeq += 1;
  return `+85512${String(phoneSeq).padStart(6, '0')}`;
}

export const TEST_PASSWORD = 'kb-store-2026';

export async function createUser(
  db: PrismaClient,
  opts: { phone?: string; password?: string; role?: Role; name?: string; telegramUserId?: number } = {},
) {
  return db.user.create({
    data: {
      phone: opts.phone ?? nextPhone(),
      passwordHash: await hashPassword(opts.password ?? TEST_PASSWORD),
      name: opts.name ?? 'Test User',
      role: opts.role ?? 'CUSTOMER',
      telegramUserId: opts.telegramUserId !== undefined ? BigInt(opts.telegramUserId) : undefined,
      telegramChatId: opts.telegramUserId !== undefined ? BigInt(opts.telegramUserId) : undefined,
    },
  });
}

export async function loginAs(app: Express, phone: string, password = TEST_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set('Origin', WEB_ORIGIN).send({ phone, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

/** Create a user and return a logged-in supertest agent. */
export async function signedInAgent(app: Express, db: PrismaClient, opts: Parameters<typeof createUser>[1] = {}) {
  const user = await createUser(db, opts);
  const agent = await loginAs(app, user.phone, opts.password);
  return { user, agent };
}

let slugSeq = 0;
export async function createCategory(db: PrismaClient, opts: { name?: string; slug?: string; sortOrder?: number } = {}) {
  slugSeq += 1;
  return db.category.create({
    data: { name: opts.name ?? `Category ${slugSeq}`, slug: opts.slug ?? `category-${slugSeq}`, sortOrder: opts.sortOrder ?? 0 },
  });
}

export async function createProduct(
  db: PrismaClient,
  opts: {
    categoryId?: string;
    name?: string;
    slug?: string;
    priceCents?: number;
    stock?: number;
    isActive?: boolean;
    isSoldOut?: boolean;
    specsLine?: string;
    description?: string;
    sortOrder?: number;
    specs?: { label: string; value: string }[];
    images?: number;
  } = {},
) {
  slugSeq += 1;
  const categoryId = opts.categoryId ?? (await createCategory(db)).id;
  return db.product.create({
    data: {
      categoryId,
      name: opts.name ?? `Product ${slugSeq}`,
      slug: opts.slug ?? `product-${slugSeq}`,
      priceCents: opts.priceCents ?? 2100,
      stock: opts.stock ?? 10,
      isActive: opts.isActive ?? true,
      isSoldOut: opts.isSoldOut ?? false,
      specsLine: opts.specsLine ?? '',
      description: opts.description ?? '',
      sortOrder: opts.sortOrder ?? 0,
      specs: { create: (opts.specs ?? []).map((s, i) => ({ ...s, sortOrder: i })) },
      images: {
        create: Array.from({ length: opts.images ?? 1 }, (_, i) => ({
          storageKey: `products/00000000-0000-4000-8000-${String(slugSeq * 10 + i).padStart(12, '0')}`,
          width: 1200,
          height: 1200,
          sortOrder: i,
        })),
      },
    },
  });
}
