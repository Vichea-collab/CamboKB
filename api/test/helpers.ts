import { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import { createApp, type AppDeps } from '../src/http/app';
import { loadConfig, type Config } from '../src/config';
import { createLogger } from '../src/lib/logger';
import { buildImageUrls, type FileClient } from '../src/integrations/files/client';
import { AppError } from '../src/http/errors';
import type { ReportClient } from '../src/integrations/reports/client';
import {
  BakongError,
  type BakongCheck,
  type BakongClient,
} from '../src/integrations/bakong/client';
import { EventDeliveryError, type EventSender } from '../src/integrations/services/events';
import type { NotificationClient } from '../src/integrations/services/notification';
import { createMetrics } from '@cambo/service-kit';
import type { EventData, EventEnvelope, EventTarget, EventType } from '@cambo/shared';
import { eventsIdle } from '../src/modules/events/outbox';
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
    TELEGRAM_BOT_USERNAME: 'CamboSupplyBot',
    API_INTERNAL_SECRET: 'test-internal-secret-0123456789abcdef',
    BAKONG_ACCOUNT_ID: 'cambosupply@aclb',
    BAKONG_TOKEN: 'test-bakong-token',
  });
  return { ...base, ...overrides };
}

/** Stands in for the report and notification services: records every event, or fails on demand. */
export class FakeEventSender implements EventSender {
  sent: { target: EventTarget; envelope: EventEnvelope }[] = [];
  /** When set, every delivery fails with this error until cleared. */
  failWith: EventDeliveryError | null = null;
  async send(target: EventTarget, envelope: EventEnvelope) {
    if (this.failWith) throw this.failWith;
    this.sent.push({ target, envelope });
  }
  /** The data of every delivered event of a type, oldest first. */
  data<T extends EventType>(type: T): EventData<T>[] {
    return this.sent
      .filter((e) => e.envelope.type === type)
      .map((e) => e.envelope.data as EventData<T>);
  }
}

export class FakeNotificationClient implements NotificationClient {
  tests = 0;
  reachable = true;
  async status() {
    if (!this.reachable) throw new AppError(503, 'NOTIFICATION_SERVICE_UNAVAILABLE', 'down');
    return {
      mode: 'webhook' as const,
      botConfigured: true,
      adminChatSet: true,
      outbox: { pending: 0, failed: 0, oldestPendingAgeSec: null, lastError: null },
    };
  }
  async sendTest() {
    if (!this.reachable) throw new AppError(503, 'NOTIFICATION_SERVICE_UNAVAILABLE', 'down');
    this.tests++;
  }
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
  publicBase() {
    return 'http://localhost:4100/files';
  }
}

/** Stands in for the report service: records calls, returns a fake PDF / JSON. */
export class FakeReportClient implements ReportClient {
  calls: { path: string; query: Record<string, string> }[] = [];
  async invoicePdf(orderId: string) {
    this.calls.push({ path: `/internal/invoices/${orderId}.pdf`, query: {} });
    return Buffer.from(`%PDF-1.7 fake invoice ${orderId}`);
  }
  async invoiceHtml(orderId: string) {
    this.calls.push({ path: `/internal/invoices/${orderId}.html`, query: {} });
    return `<!doctype html><title>fake invoice ${orderId}</title>`;
  }
  async get(path: string, query: Record<string, string>) {
    this.calls.push({ path, query });
    if (path.endsWith('.csv'))
      return { body: Buffer.from('number,total\r\n'), contentType: 'text/csv; charset=utf-8' };
    return {
      body: Buffer.from(JSON.stringify({ path, query })),
      contentType: 'application/json; charset=utf-8',
    };
  }
}

/** Stands in for the Bakong Open API: pay a QR with `pay(md5)`; every lookup is recorded. */
export class FakeBakongClient implements BakongClient {
  paid = new Map<string, Extract<BakongCheck, { found: true }>>();
  calls: string[] = [];
  failWith: BakongError | null = null;
  pay(md5: string, over: Partial<Extract<BakongCheck, { found: true }>> = {}) {
    this.paid.set(md5, {
      found: true,
      hash: `hash-${md5.slice(0, 8)}`,
      amount: 0,
      currency: 'USD',
      fromAccountId: 'customer@aba',
      toAccountId: 'cambosupply@aclb',
      paidAt: new Date(),
      raw: { md5 },
      ...over,
    });
  }
  async checkByMd5(md5: string): Promise<BakongCheck> {
    this.calls.push(md5);
    if (this.failWith) throw this.failWith;
    return this.paid.get(md5) ?? { found: false };
  }
}
export { BakongError };

/** Smallest valid PNG header bytes, enough for FakeFileClient's signature check. */
export const TINY_PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

export async function resetDb(db: PrismaClient = testPrisma()) {
  await eventsIdle();
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
): Promise<{
  app: Express;
  prisma: PrismaClient;
  events: FakeEventSender;
  notification: FakeNotificationClient;
  files: FakeFileClient;
  reports: FakeReportClient;
  bakong: FakeBakongClient;
  deps: AppDeps;
}> {
  const events = new FakeEventSender();
  const notification = new FakeNotificationClient();
  const files = new FakeFileClient();
  const reports = new FakeReportClient();
  const bakong = new FakeBakongClient();
  const deps: AppDeps = {
    config: testConfig(),
    prisma: testPrisma(),
    files,
    reports,
    bakong,
    events,
    notification,
    metrics: createMetrics('api'),
    logger: createLogger('silent'),
    ...overrides,
  };
  return {
    app: createApp(deps),
    prisma: deps.prisma,
    events,
    notification,
    files,
    reports,
    bakong: deps.bakong as FakeBakongClient,
    deps,
  };
}

import request from 'supertest';
import { createSession, SESSION_COOKIE } from '../src/modules/auth/sessions';
import type { Role } from '@prisma/client';

let phoneSeq = 0;
/** Unique valid Cambodian mobile numbers for tests: +85512000001, +85512000002, ... */
export function nextPhone(): string {
  phoneSeq += 1;
  return `+85512${String(phoneSeq).padStart(6, '0')}`;
}

export const INTERNAL_AUTH = { Authorization: 'Bearer test-internal-secret-0123456789abcdef' };

export async function createUser(
  db: PrismaClient,
  opts: {
    phone?: string;
    role?: Role;
    name?: string;
    telegramUserId?: number;
  } = {},
) {
  return db.user.create({
    data: {
      phone: opts.phone ?? nextPhone(),
      name: opts.name ?? 'Test User',
      role: opts.role ?? 'CUSTOMER',
      telegramUserId: opts.telegramUserId !== undefined ? BigInt(opts.telegramUserId) : undefined,
      telegramChatId: opts.telegramUserId !== undefined ? BigInt(opts.telegramUserId) : undefined,
    },
  });
}

/** A `cs_session=...` cookie value for a fresh session of that user (what a finished Telegram login sets). */
export async function sessionCookieFor(phone: string): Promise<string> {
  const db = testPrisma();
  const user = await db.user.findUniqueOrThrow({ where: { phone } });
  const { token } = await createSession(db, user.id, {}, user.role === 'ADMIN' ? 1 : 30);
  return `${SESSION_COOKIE}=${token}`;
}

/**
 * A supertest agent signed in as that user. Logging in is Telegram-only, so the test starts the session
 * the way a finished login does: a Session row, and its token sent as the cs_session cookie.
 */
export async function loginAs(app: Express, phone: string) {
  return request.agent(app).set('Cookie', await sessionCookieFor(phone));
}

/** Create a user and return a logged-in supertest agent. */
export async function signedInAgent(
  app: Express,
  db: PrismaClient,
  opts: Parameters<typeof createUser>[1] = {},
) {
  const user = await createUser(db, opts);
  const agent = await loginAs(app, user.phone);
  return { user, agent };
}

let slugSeq = 0;
export async function createCategory(
  db: PrismaClient,
  opts: { name?: string; slug?: string; sortOrder?: number } = {},
) {
  slugSeq += 1;
  return db.category.create({
    data: {
      name: opts.name ?? `Category ${slugSeq}`,
      slug: opts.slug ?? `category-${slugSeq}`,
      sortOrder: opts.sortOrder ?? 0,
    },
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
