import { createMetrics, migrate } from '@cambo/service-kit';
import type {
  BotAction,
  OrderButtonRequest,
  OrderSnapshot,
  OrderStatus,
  TelegramUpdateInput,
} from '@cambo/shared';
import pg from 'pg';
import { ApiError, type ApiClient } from '../src/api-client';
import { createNotificationApp } from '../src/app';
import { loadConfig, type NotificationConfig } from '../src/config';
import { createLogger } from '../src/logger';
import { Outbox } from '../src/outbox';
import { TelegramError, type SendOptions, type TelegramClient, type TgUpdate } from '../src/telegram';

export const SECRET = 'test-notification-secret-0123456789ab';
export const WEBHOOK_SECRET = 'test-webhook-secret';
export const ADMIN_CHAT = 5000;
export const AUTH = { Authorization: `Bearer ${SECRET}` };
export const WEB_ORIGIN = 'http://localhost:5173';

export const pool = new pg.Pool({ connectionString: process.env.NOTIFICATION_DATABASE_URL_TEST });

/** The notification service's own test database, migrated and empty. */
export async function resetDb() {
  await Outbox.idle();
  await migrate(pool, new URL('../migrations', import.meta.url));
  await pool.query('TRUNCATE messages, received_events, topics');
}

export function testConfig(over: Partial<NotificationConfig['telegram']> = {}): NotificationConfig {
  const base = loadConfig({
    NODE_ENV: 'test',
    NOTIFICATION_DATABASE_URL: process.env.NOTIFICATION_DATABASE_URL_TEST,
    NOTIFICATION_SERVICE_SECRET: SECRET,
    WEB_ORIGIN,
    TELEGRAM_MODE: 'webhook',
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    TELEGRAM_WEBHOOK_URL: 'https://shop.example.com/telegram/webhook',
    TELEGRAM_ADMIN_CHAT_ID: String(ADMIN_CHAT),
  });
  return { ...base, telegram: { ...base.telegram, ...over } };
}

export class FakeTelegramClient implements TelegramClient {
  sent: { chatId: number | string; text: string; opts?: SendOptions }[] = [];
  failSends = false;
  /** When set, sends fail with this error (e.g. a 429 or 403) until cleared. */
  failWith: Error | null = null;
  answers: { id: string; text?: string; alert?: boolean }[] = [];
  edits: { chatId: number | string; messageId: number; replyMarkup: unknown }[] = [];
  commands: { command: string; description: string }[] = [];
  menuButton: { url: string; text: string } | null = null;
  /** Forum topics created through createForumTopic, and how to make the chat behave differently. */
  topicsCreated: { chatId: number | string; name: string; threadId: number }[] = [];
  notForum = false;
  deletedThreads = new Set<number>();
  private nextThread = 100;
  async createForumTopic(chatId: number | string, name: string) {
    if (this.notForum) throw new TelegramError('Telegram createForumTopic failed: Bad Request: the chat is not a forum', 400);
    const threadId = this.nextThread++;
    this.topicsCreated.push({ chatId, name, threadId });
    return threadId;
  }
  async sendMessage(chatId: number | string, text: string, opts?: SendOptions) {
    if (this.failWith) throw this.failWith;
    if (opts?.threadId !== undefined && this.deletedThreads.has(opts.threadId))
      throw new TelegramError('Telegram sendMessage failed: Bad Request: message thread not found', 400);
    if (this.failSends) throw new Error('telegram down');
    this.sent.push({ chatId, text, opts });
  }
  async answerCallbackQuery(id: string, text?: string, alert?: boolean) {
    this.answers.push({ id, text, alert });
  }
  async editReplyMarkup(chatId: number | string, messageId: number, replyMarkup: unknown) {
    this.edits.push({ chatId, messageId, replyMarkup });
  }
  async getUpdates() {
    return [] as TgUpdate[];
  }
  async setWebhook() {}
  async setCommands(commands: { command: string; description: string }[]) {
    this.commands = commands;
  }
  async setMenuButton(url: string, text: string) {
    this.menuButton = { url, text };
  }
  to(chatId: number) {
    return this.sent.filter((m) => Number(m.chatId) === chatId);
  }
}

/** Stands in for the api: answers chat messages and order-button presses as set up by the test. */
export class FakeApiClient implements ApiClient {
  forwarded: TelegramUpdateInput[] = [];
  answers: BotAction[] = [];
  statusCalls: { orderId: string; body: OrderButtonRequest }[] = [];
  /** Order statuses by id; a press that doesn't match the flow answers 409 with the real one. */
  orders = new Map<string, { number: string; status: OrderStatus }>();
  down = false;
  forbid = false;
  async forwardUpdate(update: TelegramUpdateInput) {
    if (this.down) throw new ApiError(0, 'API_UNREACHABLE', 'down');
    this.forwarded.push(update);
    return this.answers;
  }
  async changeOrderStatus(orderId: string, body: OrderButtonRequest) {
    this.statusCalls.push({ orderId, body });
    if (this.down) throw new ApiError(0, 'API_UNREACHABLE', 'down');
    if (this.forbid) throw new ApiError(403, 'FORBIDDEN', 'no');
    const order = this.orders.get(orderId);
    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Order not found');
    const FLOW = ['PENDING', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'];
    const ok =
      body.status === 'CANCELLED'
        ? ['PENDING', 'CONFIRMED', 'PACKED'].includes(order.status)
        : FLOW.indexOf(body.status) > FLOW.indexOf(order.status);
    if (!ok)
      throw new ApiError(409, 'INVALID_TRANSITION', 'no', {
        status: order.status,
        number: order.number,
      });
    order.status = body.status;
    return { number: order.number, status: body.status };
  }
}

export function makeApp(over: { config?: NotificationConfig } = {}) {
  const config = over.config ?? testConfig();
  const telegram = new FakeTelegramClient();
  const api = new FakeApiClient();
  const metrics = createMetrics('notification');
  const logger = createLogger('silent');
  const outbox = new Outbox(pool, telegram, logger, metrics);
  const deps = { config, pool, outbox, telegram, api, logger, metrics };
  return { ...deps, deps, app: createNotificationApp(deps) };
}

let n = 0;
export function order(over: Partial<OrderSnapshot> = {}): OrderSnapshot {
  n += 1;
  return {
    id: `5b0f1c4e-6f0d-4d52-9a6e-${String(n).padStart(12, '0')}`,
    number: `CS-${100000 + n}`,
    status: 'PENDING',
    createdAt: '2026-11-19T01:00:00.000Z',
    contactName: 'Dara',
    contactPhone: '+85512345678',
    region: 'PHNOM_PENH',
    deliveryService: 'VET',
    addressLine: 'St. 315',
    lat: 11.58,
    lng: 104.89,
    distanceKm: null,
    note: null,
    subtotalCents: 4200,
    deliveryFeeCents: 150,
    discountCents: 0,
    totalCents: 4350,
    promoCode: null,
    trackingNumber: null,
    payment: { method: 'COD', status: 'UNPAID' },
    items: [
      {
        productId: '8d7a0b3e-3c5a-4e0b-8f6a-0d9a8f1e2b34',
        name: 'Attack Shark X11 White',
        quantity: 2,
        priceCents: 2100,
        lineTotalCents: 4200,
      },
    ],
    ...over,
  };
}

let ev = 0;
export function event(type: string, data: unknown, over: Record<string, unknown> = {}) {
  ev += 1;
  return {
    id: `0d3b9a52-1c61-4c4e-9d7e-${String(ev).padStart(12, '0')}`,
    type,
    emittedAt: new Date().toISOString(),
    requestId: `req-${ev}`,
    data,
    ...over,
  };
}
