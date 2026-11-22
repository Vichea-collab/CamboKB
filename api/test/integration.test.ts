import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { migrate } from '@cambo/service-kit';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpApiClient } from '../../notification/src/api-client';
import { createNotificationApp } from '../../notification/src/app';
import { loadConfig as loadNotificationConfig } from '../../notification/src/config';
import { createLogger as notificationLogger } from '../../notification/src/logger';
import { Outbox } from '../../notification/src/outbox';
import { createReportApp } from '../../report/src/app';
import { loadConfig as loadReportConfig } from '../../report/src/config';
import { createLogger as reportLogger } from '../../report/src/logger';
import { FakeTelegramClient } from '../../notification/test/helpers';
import { HttpEventSender } from '../src/integrations/services/events';
import { HttpNotificationClient } from '../src/integrations/services/notification';
import { HttpReportClient } from '../src/integrations/reports/client';
import { eventsIdle } from '../src/modules/events/outbox';
import {
  createProduct,
  createTestApp,
  resetDb,
  signedInAgent,
  testConfig,
  WEB_ORIGIN,
} from './helpers';

/**
 * The api, the report service and the notification service running as real HTTP servers, each with its own
 * database, talking to each other the way they do in Docker. Only Telegram and the PDF renderer are faked.
 */

const REPORT_SECRET = 'dev-report-secret-change-me-0123456789';
const NOTIFICATION_SECRET = 'dev-notification-secret-change-me-012345';
const INTERNAL_SECRET = 'test-internal-secret-0123456789abcdef';
const ADMIN_CHAT = 5000;

const listen = async (app: Parameters<typeof createServer>[1]) => {
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};
const close = (server: Server) => new Promise<void>((r) => server.close(() => r()));

describe('the services working together', () => {
  const reportPool = new pg.Pool({ connectionString: process.env.REPORT_DATABASE_URL_TEST });
  const notificationPool = new pg.Pool({
    connectionString: process.env.NOTIFICATION_DATABASE_URL_TEST,
  });
  const telegram = new FakeTelegramClient();
  let reportSrv: Awaited<ReturnType<typeof listen>>;
  let notificationSrv: Awaited<ReturnType<typeof listen>> | undefined;
  let apiSrv: Awaited<ReturnType<typeof listen>>;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let notificationApp: ReturnType<typeof createNotificationApp>;
  let notificationPort = 0;
  let customer: Awaited<ReturnType<typeof signedInAgent>>;
  let admin: Awaited<ReturnType<typeof signedInAgent>>;
  let product: Awaited<ReturnType<typeof createProduct>>;

  const startNotification = async () => {
    const s = createServer(notificationApp);
    await new Promise<void>((r) => s.listen(notificationPort, '127.0.0.1', r));
    notificationSrv = { server: s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
  };

  beforeAll(async () => {
    await migrate(reportPool, new URL('../../report/migrations', import.meta.url));
    await migrate(notificationPool, new URL('../../notification/migrations', import.meta.url));
  });
  afterAll(async () => {
    await Outbox.idle();
    await Promise.all([reportPool.end(), notificationPool.end()]);
  });

  beforeEach(async () => {
    await Promise.all([eventsIdle(), Outbox.idle()]);
    await resetDb();
    await reportPool.query('TRUNCATE orders CASCADE');
    await notificationPool.query('TRUNCATE messages, received_events');
    telegram.sent = [];
    telegram.edits = [];
    telegram.answers = [];

    // report service
    const reportApp = createReportApp({
      config: loadReportConfig({
        NODE_ENV: 'test',
        REPORT_DATABASE_URL: process.env.REPORT_DATABASE_URL_TEST,
        REPORT_SERVICE_SECRET: REPORT_SECRET,
      }),
      pool: reportPool,
      invoices: {
        render: async (d) => Buffer.from(`%PDF-1.7 invoice ${d.number}`),
        renderHtml: async (d) => `<!doctype html><p>invoice ${d.number}</p>`,
        renderSales: async (d) => Buffer.from(`%PDF-1.7 sales report ${d.from}`),
        renderSalesHtml: async (d) => `<!doctype html><p>sales report ${d.from}</p>`,
        close: async () => {},
      },
      logger: reportLogger('silent'),
    });
    reportSrv = await listen(reportApp);

    // the api listens too, because the notification service calls it (its app is attached once it exists)
    const apiServer = createServer();
    await new Promise<void>((r) => apiServer.listen(0, '127.0.0.1', r));
    apiSrv = {
      server: apiServer,
      url: `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`,
    };
    const apiUrl = apiSrv.url;
    notificationPort = 0; // chosen on the first start, then kept so a "restart" comes back on the same address

    const notificationConfig = loadNotificationConfig({
      NODE_ENV: 'test',
      NOTIFICATION_DATABASE_URL: process.env.NOTIFICATION_DATABASE_URL_TEST,
      NOTIFICATION_SERVICE_SECRET: NOTIFICATION_SECRET,
      API_URL: apiUrl,
      API_INTERNAL_SECRET: INTERNAL_SECRET,
      WEB_ORIGIN,
      TELEGRAM_MODE: 'webhook',
      TELEGRAM_BOT_TOKEN: 't',
      TELEGRAM_WEBHOOK_SECRET: 'hook-secret-0123456789abcdefghijklmnop',
      TELEGRAM_WEBHOOK_URL: 'https://x.test/telegram/webhook',
      TELEGRAM_ADMIN_CHAT_ID: String(ADMIN_CHAT),
    });
    const { createMetrics } = await import('@cambo/service-kit');
    const metrics = createMetrics('notification');
    const outbox = new Outbox(notificationPool, telegram, notificationLogger('silent'), metrics);
    notificationApp = createNotificationApp({
      config: notificationConfig,
      pool: notificationPool,
      outbox,
      telegram,
      api: new HttpApiClient(apiUrl, INTERNAL_SECRET),
      logger: notificationLogger('silent'),
      metrics,
    });
    await startNotification();
    notificationPort = (notificationSrv!.server.address() as AddressInfo).port;

    ctx = await createTestApp({
      config: testConfig(),
      events: new HttpEventSender({
        report: { url: reportSrv.url, secret: REPORT_SECRET },
        notification: { url: `http://127.0.0.1:${notificationPort}`, secret: NOTIFICATION_SECRET },
      }),
      reports: new HttpReportClient(reportSrv.url, REPORT_SECRET),
      notification: new HttpNotificationClient(
        `http://127.0.0.1:${notificationPort}`,
        NOTIFICATION_SECRET,
      ),
    });
    apiSrv.server.on('request', ctx.app);

    customer = await signedInAgent(ctx.app, ctx.prisma, { name: 'Dara', telegramUserId: 7001 });
    admin = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' });
    product = await createProduct(ctx.prisma, {
      name: 'Attack Shark X11 White',
      priceCents: 2100,
      stock: 10,
    });

    return async () => {
      await Promise.all([eventsIdle(), Outbox.idle()]);
      await Promise.all([
        close(reportSrv.server),
        close(apiSrv.server),
        notificationSrv ? close(notificationSrv.server) : Promise.resolve(),
      ]);
    };
  });

  const place = (requestId?: string) =>
    customer.agent
      .post('/api/v1/orders')
      .set('Origin', WEB_ORIGIN)
      .set(requestId ? { 'x-request-id': requestId } : {})
      .send({
        items: [{ productId: product.id, quantity: 2 }],
        region: 'PHNOM_PENH',
        deliveryService: 'VET',
        contactName: 'Dara',
        contactPhone: '012345678',
        addressLine: 'St. 315',
        paymentMethod: 'COD',
      });
  const reportRows = async () =>
    (await reportPool.query('SELECT number, status, total_cents FROM orders')).rows;
  const toChat = (id: number) => telegram.sent.filter((m) => Number(m.chatId) === id);

  it('an order placed in the api reaches the report service and both Telegram chats', async () => {
    const res = await place();
    expect(res.status).toBe(201);
    await vi.waitFor(async () =>
      expect(await reportRows()).toEqual([
        { number: res.body.number, status: 'PENDING', total_cents: 4350 },
      ]),
    );
    await vi.waitFor(() =>
      expect([toChat(7001).length, toChat(ADMIN_CHAT).length]).toEqual([1, 1]),
    );
    expect(toChat(7001)[0]!.text).toContain(res.body.number);
    expect(toChat(ADMIN_CHAT)[0]!.text).toContain('2 × Attack Shark X11 White');

    // The report service answers reports and invoices from its own database, asked through the api.
    const today = new Date().toISOString().slice(0, 10);
    const summary = await admin.agent
      .get('/api/v1/admin/reports/summary')
      .query({ from: today, to: today, groupBy: 'day' });
    expect(summary.body.totals).toMatchObject({ orders: 1, units: 2, revenueCents: 4350 });
    const invoice = await customer.agent.get(`/api/v1/orders/${res.body.number}/invoice.pdf`);
    expect(invoice.status).toBe(200);
    expect(invoice.body.toString()).toContain(`invoice ${res.body.number}`);
    // The sales report PDF is asked for the same way: api -> report service (which holds the order) -> PDF.
    const report = await admin.agent.get('/api/v1/admin/reports/report.pdf').query({ from: today, to: today });
    expect(report.status).toBe(200);
    expect(report.headers['content-type']).toBe('application/pdf');
    expect(report.body.toString()).toContain(`sales report ${today}`);
  });

  it('the owner confirms the order with a Telegram button: Telegram -> notification -> api -> report and the customer', async () => {
    const res = await place();
    await vi.waitFor(() => expect(toChat(ADMIN_CHAT)).toHaveLength(1));
    const confirm = (
      toChat(ADMIN_CHAT)[0]!.opts!.replyMarkup as { inline_keyboard: { callback_data: string }[][] }
    ).inline_keyboard
      .flat()
      .find((b) => b.callback_data.endsWith(':c'))!;

    const tap = await request(notificationApp)
      .post('/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', 'hook-secret-0123456789abcdefghijklmnop')
      .send({
        update_id: 1,
        callback_query: {
          id: 'cb1',
          from: { id: ADMIN_CHAT },
          message: { message_id: 7, chat: { id: ADMIN_CHAT, type: 'private' } },
          data: confirm.callback_data,
        },
      });
    expect(tap.status).toBe(200);

    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.id } })).status).toBe(
      'CONFIRMED',
    );
    expect(telegram.answers.at(-1)).toMatchObject({ text: `${res.body.number} → Confirmed` });
    await vi.waitFor(async () => expect((await reportRows())[0]!.status).toBe('CONFIRMED'));
    await vi.waitFor(() =>
      expect(toChat(7001).some((m) => m.text.includes('confirmed'))).toBe(true),
    );
  });

  it('a chat message is answered by the api through the notification service', async () => {
    await request(notificationApp)
      .post('/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', 'hook-secret-0123456789abcdefghijklmnop')
      .send({
        update_id: 2,
        message: {
          message_id: 1,
          from: { id: 7001, first_name: 'Dara' },
          chat: { id: 7001, type: 'private' },
          text: '/orders',
        },
      });
    await vi.waitFor(() => expect(toChat(7001).at(-1)?.text).toContain("haven't ordered"));
  });

  it('follows one request across all three services by its id', async () => {
    await place('trace-me-123');
    await vi.waitFor(async () =>
      expect(
        (
          await notificationPool.query(
            "SELECT count(*)::int AS n FROM messages WHERE request_id = 'trace-me-123'",
          )
        ).rows[0].n,
      ).toBe(2),
    );
    expect(
      (await ctx.prisma.serviceEvent.findMany({ where: { requestId: 'trace-me-123' } })).length,
    ).toBe(2);
  });

  it('loses nothing while the notification service is down, and catches up when it is back', async () => {
    await close(notificationSrv!.server); // "docker compose stop notification"
    notificationSrv = undefined;
    const res = await place();
    expect(res.status).toBe(201); // the shop keeps selling
    await vi.waitFor(async () => expect(await reportRows()).toHaveLength(1)); // the report service was never affected
    await vi.waitFor(async () =>
      expect(
        await ctx.prisma.serviceEvent.count({
          where: { target: 'notification', attempts: { gt: 0 } },
        }),
      ).toBe(1),
    );
    expect(telegram.sent).toHaveLength(0);
    expect(
      await ctx.prisma.serviceEvent.count({ where: { target: 'notification', status: 'PENDING' } }),
    ).toBe(1);

    await startNotification(); // "docker compose start notification"
    await ctx.prisma.serviceEvent.updateMany({
      where: { status: 'PENDING' },
      data: { nextAttemptAt: new Date(Date.now() - 1000), lockedUntil: null },
    });
    const { drainEvents } = await import('../src/modules/events/outbox');
    await drainEvents(ctx.deps);
    await vi.waitFor(() =>
      expect([toChat(7001).length, toChat(ADMIN_CHAT).length]).toEqual([1, 1]),
    );
    expect(await ctx.prisma.serviceEvent.count({ where: { status: 'PENDING' } })).toBe(0);
  });

  it('the admin status page reflects the real notification service', async () => {
    const status = (await admin.agent.get('/api/v1/admin/telegram/status')).body;
    expect(status).toMatchObject({
      serviceReachable: true,
      mode: 'webhook',
      botConfigured: true,
      adminChatSet: true,
    });
    expect(
      (await admin.agent.post('/api/v1/admin/telegram/test').set('Origin', WEB_ORIGIN)).body,
    ).toEqual({ queued: true });
    await vi.waitFor(() => expect(toChat(ADMIN_CHAT)[0]?.text).toContain('Test message'));
  });
});
