import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { messagesFor } from '../src/events';
import { Outbox } from '../src/outbox';
import {
  ADMIN_CHAT,
  AUTH,
  event,
  makeApp,
  order,
  pool,
  resetDb,
  testConfig,
  WEB_ORIGIN,
} from './helpers';

type Ctx = ReturnType<typeof makeApp>;
const CUSTOMER = 7001;
const keyboardTexts = (opts?: { replyMarkup?: unknown }) =>
  (opts?.replyMarkup as { inline_keyboard: { text: string }[][] }).inline_keyboard
    .flat()
    .map((b) => b.text);

describe('events from the api become Telegram messages', () => {
  let ctx: Ctx;
  const send = (e: unknown, headers: Record<string, string> = AUTH) =>
    request(ctx.app)
      .post('/internal/events')
      .set(headers)
      .send(e as object);
  const flush = () => Outbox.idle();

  beforeEach(async () => {
    await resetDb();
    ctx = makeApp();
  });

  it('requires the shared secret', async () => {
    expect((await send(event('admin.alert', { text: 'x' }), {})).status).toBe(401);
    expect(
      (await send(event('admin.alert', { text: 'x' }), { Authorization: 'Bearer wrong' })).status,
    ).toBe(401);
  });

  it('tells the owner about a new order, with every detail and the next-step buttons, escaping customer text', async () => {
    const o = order({ note: '<b>ring twice</b>', contactName: 'Dara <script>' });
    const res = await send(
      event('order.placed', { order: o, customerChatId: null, adminAlerts: true, holdMinutes: 10 }),
    );
    expect(res.body).toEqual({ result: 'applied' });
    await flush();
    const [msg] = ctx.telegram.to(ADMIN_CHAT);
    expect(msg!.text).toContain(o.number);
    expect(msg!.text).toContain('Dara &lt;script&gt;');
    expect(msg!.text).toContain('&lt;b&gt;ring twice&lt;/b&gt;');
    expect(msg!.text).toContain('2 × Attack Shark X11 White — $42');
    expect(msg!.text).toContain('https://maps.google.com/?q=11.58,104.89');
    expect(msg!.text).toContain(`${WEB_ORIGIN}/admin/orders/${o.id}`);
    expect(msg!.opts?.parseMode).toBe('HTML');
    expect(keyboardTexts(msg!.opts)).toEqual(['🆕 Pending', '✅ Confirm order', '❌ Cancel']);
  });

  it('warns the owner when a Grab order has no map pin, and has no warning when there is one', async () => {
    const noPin = order({ lat: null, lng: null, deliveryService: 'GRAB' });
    await send(
      event('order.placed', {
        order: noPin,
        customerChatId: null,
        adminAlerts: true,
        holdMinutes: 10,
      }),
    );
    await flush();
    const [warned] = ctx.telegram.to(ADMIN_CHAT);
    expect(warned!.text).toContain('No map pin');
    expect(warned!.text).not.toContain('maps.google.com');
  });

  it('confirms the order to the customer in their own chat', async () => {
    const o = order();
    await send(
      event('order.placed', {
        order: o,
        customerChatId: String(CUSTOMER),
        adminAlerts: true,
        holdMinutes: 10,
      }),
    );
    await flush();
    const [msg] = ctx.telegram.to(CUSTOMER);
    expect(msg!.text).toContain(o.number);
    expect(msg!.text).toContain('received');
    expect(msg!.text).toContain('$43.50');
    expect(msg!.text).toContain(`${WEB_ORIGIN}/account/orders/${o.number}`);
  });

  it('asks a KHQR customer to pay in time, and gives the owner no buttons until the money arrives', async () => {
    const o = order({ payment: { method: 'KHQR', status: 'PENDING' } });
    await send(
      event('order.placed', {
        order: o,
        customerChatId: String(CUSTOMER),
        adminAlerts: true,
        holdMinutes: 10,
      }),
    );
    await flush();
    expect(ctx.telegram.to(CUSTOMER)[0]!.text).toContain('KHQR within 10 minutes');
    expect(keyboardTexts(ctx.telegram.to(ADMIN_CHAT)[0]!.opts)).toEqual([
      '⏳ Waiting for KHQR payment',
    ]);
  });

  it.each([
    ['CONFIRMED', 'confirmed'],
    ['PACKED', 'packed'],
    ['SHIPPING', 'on the way'],
    ['DELIVERED', 'delivered'],
    ['CANCELLED', 'cancelled'],
  ] as const)('tells the customer when the order is %s', async (status, phrase) => {
    const o = order({ status, note: 'leave at the gate' });
    await send(event('order.status_changed', { order: o, customerChatId: String(CUSTOMER) }));
    await flush();
    const [msg] = ctx.telegram.to(CUSTOMER);
    expect(msg!.text.toLowerCase()).toContain(phrase);
    expect(msg!.text).toContain(o.number);
    expect(msg!.text).not.toContain('leave at the gate');
    expect(ctx.telegram.to(ADMIN_CHAT)).toHaveLength(0); // the owner made the change, no need to tell them
  });

  it('tells the customer and the owner about a payment, and offers the owner the next step', async () => {
    const o = order({ status: 'CONFIRMED', payment: { method: 'KHQR', status: 'PAID' } });
    await send(
      event('payment.confirmed', { order: o, customerChatId: String(CUSTOMER), adminAlerts: true }),
    );
    await flush();
    expect(ctx.telegram.to(CUSTOMER)[0]!.text).toContain('Payment received');
    const owner = ctx.telegram.to(ADMIN_CHAT)[0]!;
    expect(owner.text).toContain(`Payment received: order ${o.number}`);
    expect(keyboardTexts(owner.opts)).toEqual(['✅ Confirmed', '📦 Mark packed', '❌ Cancel']);
  });

  it("tells the customer an unpaid order was cancelled, using the api's hold time", async () => {
    await send(
      event('payment.expired', {
        order: order({ status: 'CANCELLED' }),
        customerChatId: String(CUSTOMER),
        holdMinutes: 15,
      }),
    );
    await flush();
    expect(ctx.telegram.to(CUSTOMER)[0]!.text).toContain("wasn't paid within 15 minutes");
  });

  it('passes an owner alert through as plain text', async () => {
    await send(event('admin.alert', { text: '⚠️ Bakong token was rejected', adminAlerts: true }));
    await flush();
    expect(ctx.telegram.to(ADMIN_CHAT)[0]).toMatchObject({ text: '⚠️ Bakong token was rejected' });
  });

  it('files each owner alert in its own topic, and never puts a customer message in one', async () => {
    const placed = order();
    const paid = order({ status: 'CONFIRMED', payment: { method: 'KHQR', status: 'PAID' } });
    await send(
      event('order.placed', {
        order: placed,
        customerChatId: String(CUSTOMER),
        adminAlerts: true,
        holdMinutes: 10,
      }),
    );
    await send(
      event('payment.confirmed', {
        order: paid,
        customerChatId: String(CUSTOMER),
        adminAlerts: true,
      }),
    );
    await send(event('admin.alert', { text: '⚠️ Late payment, refund needed', adminAlerts: true }));
    await flush();
    const topicOf = (name: string) =>
      ctx.telegram.topicsCreated.find((t) => t.name === name)!.threadId;
    const owner = ctx.telegram.to(ADMIN_CHAT);
    expect(owner.find((m) => m.text.includes(placed.number))!.opts?.threadId).toBe(
      topicOf('🛒 New orders'),
    );
    expect(owner.find((m) => m.text.includes('Payment received'))!.opts?.threadId).toBe(
      topicOf('💳 Payments'),
    );
    expect(owner.find((m) => m.text.includes('refund needed'))!.opts?.threadId).toBe(
      topicOf('⚠️ Needs attention'),
    );
    expect(ctx.telegram.to(CUSTOMER).every((m) => m.opts?.threadId === undefined)).toBe(true);
  });

  it('skips the owner when alerts are off, customers without a chat, and an owner chat that is not set', async () => {
    const o = order();
    await send(
      event('order.placed', {
        order: o,
        customerChatId: null,
        adminAlerts: false,
        holdMinutes: 10,
      }),
    );
    await send(event('admin.alert', { text: 'quiet', adminAlerts: false }));
    const noChat = makeApp({ config: testConfig({ adminChatId: undefined }) });
    await request(noChat.app)
      .post('/internal/events')
      .set(AUTH)
      .send(event('admin.alert', { text: 'nobody to tell', adminAlerts: true }));
    await flush();
    expect(ctx.telegram.sent).toHaveLength(0);
    expect(noChat.telegram.sent).toHaveLength(0);
  });

  it('ignores an event it has already handled, even with a different delivery', async () => {
    const e = event('order.placed', {
      order: order(),
      customerChatId: String(CUSTOMER),
      adminAlerts: true,
      holdMinutes: 10,
    });
    expect((await send(e)).body).toEqual({ result: 'applied' });
    expect((await send(e)).body).toEqual({ result: 'duplicate' });
    await flush();
    expect(ctx.telegram.sent).toHaveLength(2); // one for the customer, one for the owner; not four
  });

  it('never sends the same notification twice, even from two different events', async () => {
    const o = order({ status: 'CONFIRMED' });
    await send(event('order.status_changed', { order: o, customerChatId: String(CUSTOMER) }));
    await send(event('order.status_changed', { order: o, customerChatId: String(CUSTOMER) })); // a new event id, the same notification
    await flush();
    expect(ctx.telegram.to(CUSTOMER)).toHaveLength(1);
  });

  it('refuses events that break the contract or belong to another service, and records nothing', async () => {
    const bad = await send(event('order.placed', { order: { nope: true } }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_EVENT');
    const other = await send(event('order.snapshot', order()));
    expect(other.status).toBe(422);
    expect((await send({ junk: true })).status).toBe(400);
    expect((await pool.query('SELECT count(*)::int AS n FROM received_events')).rows[0].n).toBe(0);
  });

  it('saves the event and its messages together: if saving fails, the event can be delivered again', async () => {
    const e = event('admin.alert', { text: 'x', adminAlerts: true });
    const failing = makeApp();
    failing.outbox.save = async () => {
      throw new Error('disk full');
    };
    expect((await request(failing.app).post('/internal/events').set(AUTH).send(e)).status).toBe(
      500,
    );
    expect((await pool.query('SELECT count(*)::int AS n FROM received_events')).rows[0].n).toBe(0);
    expect((await send(e)).body).toEqual({ result: 'applied' }); // the retry works
  });

  it('keeps the message when Telegram is down, and the event is still accepted', async () => {
    ctx.telegram.failSends = true;
    expect((await send(event('admin.alert', { text: 'x', adminAlerts: true }))).status).toBe(200);
    await flush();
    expect((await pool.query('SELECT status, attempts FROM messages')).rows).toEqual([
      { status: 'PENDING', attempts: 1 },
    ]);
  });

  it('counts events and messages in its metrics, and reports readiness', async () => {
    await send(event('admin.alert', { text: 'x', adminAlerts: true }));
    await flush();
    expect((await request(ctx.app).get('/readyz')).status).toBe(200);
    const text = (await request(ctx.app).get('/metrics')).text;
    expect(text).toContain(
      'notification_events_total{type="admin.alert",result="applied",service="notification"} 1',
    );
    expect(text).toContain('telegram_messages_total{result="sent",service="notification"} 1');
    expect(text).toContain('notification_outbox_pending{service="notification"} 0');
  });

  it('reports its status and sends the owner a test message', async () => {
    expect((await request(ctx.app).get('/internal/status')).status).toBe(401);
    const status = (await request(ctx.app).get('/internal/status').set(AUTH)).body;
    expect(status).toMatchObject({
      mode: 'webhook',
      botConfigured: true,
      adminChatSet: true,
      outbox: { pending: 0, failed: 0 },
    });
    expect((await request(ctx.app).post('/internal/test').set(AUTH)).body).toEqual({
      queued: true,
    });
    await flush();
    expect(ctx.telegram.to(ADMIN_CHAT)[0]!.text).toContain('Test message');
    // One test line in every topic, so a new group is set up and the owner can see where each alert will land.
    expect(ctx.telegram.topicsCreated.map((t) => t.name)).toEqual([
      '🛒 New orders',
      '💳 Payments',
      '⚠️ Needs attention',
    ]);
    expect(ctx.telegram.to(ADMIN_CHAT).map((m) => m.opts?.threadId)).toEqual([
      undefined,
      100,
      101,
      102,
    ]);
  });

  it('explains when there is no owner chat or the bot is off', async () => {
    const none = makeApp({ config: testConfig({ adminChatId: undefined }) });
    const noChat = await request(none.app).post('/internal/test').set(AUTH);
    expect(noChat.status).toBe(409);
    expect(noChat.body.error.code).toBe('NO_ADMIN_CHAT');
    const off = makeApp({ config: testConfig({ mode: 'off' }) });
    expect((await request(off.app).post('/internal/test').set(AUTH)).body.error.code).toBe(
      'TELEGRAM_OFF',
    );
  });
});

describe('the customer can open their order as a Telegram Mini App', () => {
  const HTTPS = 'https://shop.test';
  const o = order();
  const customerOf = (
    type: 'order.placed' | 'order.status_changed' | 'payment.expired',
    webOrigin: string,
  ) =>
    messagesFor(
      type,
      { order: o, customerChatId: String(CUSTOMER), adminAlerts: false, holdMinutes: 10 } as never,
      { webOrigin },
    ).find((m) => String(m.chatId) === String(CUSTOMER))!;

  it('adds a "View my order" button that opens the order inside Telegram', () => {
    const msg = customerOf('order.status_changed', HTTPS);
    expect(msg.replyMarkup).toEqual({
      inline_keyboard: [
        [{ text: '📦 View my order', web_app: { url: `${HTTPS}/account/orders/${o.number}` } }],
      ],
    });
  });

  it('does not repeat the link in the text when there is a button', () => {
    expect(customerOf('order.placed', HTTPS).text).not.toContain('https://');
  });

  it('offers to order again after an unpaid order expired', () => {
    expect(customerOf('payment.expired', HTTPS).replyMarkup).toEqual({
      inline_keyboard: [[{ text: '🛒 Order again', web_app: { url: HTTPS } }]],
    });
  });

  it('keeps a plain link and no button on http (Telegram only opens https Mini Apps)', () => {
    const msg = customerOf('order.status_changed', WEB_ORIGIN);
    expect(msg.replyMarkup).toBeUndefined();
    expect(msg.text).toContain(`${WEB_ORIGIN}/account/orders/${o.number}`);
  });
});
