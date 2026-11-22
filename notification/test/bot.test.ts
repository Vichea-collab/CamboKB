import request from 'supertest';
import { BOT_COMMANDS } from '@cambo/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupBot } from '../src/setup';
import { Outbox } from '../src/outbox';
import { ADMIN_CHAT, makeApp, order, resetDb, testConfig, WEBHOOK_SECRET } from './helpers';

type Ctx = ReturnType<typeof makeApp>;
let updateId = 1;
const CUSTOMER = 7001;

const post = (ctx: Ctx, body: object, secret: string | null = WEBHOOK_SECRET) => {
  const r = request(ctx.app).post('/webhook');
  return (secret === null ? r : r.set('X-Telegram-Bot-Api-Secret-Token', secret)).send(body);
};
const message = (text: string, fromId = CUSTOMER, chatType = 'private') => ({
  update_id: updateId++,
  message: {
    message_id: updateId,
    from: { id: fromId, first_name: 'Dara' },
    chat: { id: fromId, type: chatType },
    text,
  },
});
const press = (
  ctx: Ctx,
  data: string,
  o: { fromId?: number; chatId?: number; text?: string; entities?: unknown[] } = {},
) =>
  post(ctx, {
    update_id: updateId++,
    callback_query: {
      id: `cb${updateId}`,
      from: { id: o.fromId ?? ADMIN_CHAT, first_name: 'Owner' },
      message: {
        message_id: 99,
        chat: { id: o.chatId ?? ADMIN_CHAT, type: 'private' },
        ...(o.text ? { text: o.text, entities: o.entities } : {}),
      },
      data,
    },
  });
const buttons = (markup: unknown) =>
  (
    markup as { inline_keyboard: { text: string; callback_data: string }[][] }
  ).inline_keyboard.flat();

describe('Telegram webhook', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    await resetDb();
    ctx = makeApp();
  });

  it('only accepts calls that carry the webhook secret', async () => {
    expect((await post(ctx, message('hi'), null)).status).toBe(401);
    expect((await post(ctx, message('hi'), 'wrong')).status).toBe(401);
    expect((await post(ctx, message('hi'))).status).toBe(200);
  });

  it('forwards a chat message to the api and sends what the api answers', async () => {
    ctx.api.answers = [
      {
        type: 'send',
        chatId: CUSTOMER,
        text: 'Tap to share your number',
        replyMarkup: { keyboard: [[{ text: 'Share', request_contact: true }]] },
      },
      { type: 'send', chatId: CUSTOMER, text: 'Second', parseMode: 'HTML' },
    ];
    expect((await post(ctx, message('/start abc'))).status).toBe(200);
    await Outbox.idle();
    expect(ctx.api.forwarded[0]!.message).toMatchObject({
      text: '/start abc',
      from: { id: CUSTOMER },
      chat: { type: 'private' },
    });
    expect(ctx.telegram.to(CUSTOMER).map((m) => m.text)).toEqual([
      'Tap to share your number',
      'Second',
    ]);
    expect(JSON.stringify(ctx.telegram.to(CUSTOMER)[0]!.opts)).toContain('request_contact');
    expect(ctx.telegram.to(CUSTOMER)[1]!.opts?.parseMode).toBe('HTML');
  });

  it('always answers Telegram 200, and tells the person when the api cannot be reached', async () => {
    ctx.api.down = true;
    expect((await post(ctx, message('/orders'))).status).toBe(200);
    await Outbox.idle();
    expect(ctx.telegram.to(CUSTOMER)[0]!.text).toContain('something went wrong');
    ctx.telegram.sent = [];
    expect((await post(ctx, message('/orders', -9, 'group'))).status).toBe(200); // no apology into group chats
    await Outbox.idle();
    expect(ctx.telegram.sent).toHaveLength(0);
  });

  it('registers the command menu, and the Shop button only on https sites', async () => {
    await setupBot(ctx.deps);
    expect(ctx.telegram.commands.map((c) => c.command)).toEqual(BOT_COMMANDS.map((c) => c.command));
    expect(ctx.telegram.menuButton).toBeNull();
    const https = makeApp({ config: { ...testConfig(), webOrigin: 'https://shop.example.com' } });
    await setupBot(https.deps);
    expect(https.telegram.menuButton).toEqual({ url: 'https://shop.example.com', text: 'Shop' });
  });
});

describe('order buttons in Telegram', () => {
  let ctx: Ctx;
  let o = order();
  const keyboardOf = () => buttons(ctx.telegram.edits.at(-1)!.replyMarkup).map((x) => x.text);

  beforeEach(async () => {
    await resetDb();
    ctx = makeApp();
    o = order();
    ctx.api.orders.set(o.id, { number: o.number, status: 'PENDING' });
  });

  it('confirms the order through the api, answers the tap, and moves the buttons on', async () => {
    expect((await press(ctx, `o:${o.id}:c`)).status).toBe(200);
    expect(ctx.api.statusCalls).toEqual([
      {
        orderId: o.id,
        body: { status: 'CONFIRMED', telegramUserId: ADMIN_CHAT, requireLinkedAdmin: false },
      },
    ]);
    expect(ctx.telegram.answers.at(-1)).toMatchObject({ text: `${o.number} → Confirmed` });
    expect(keyboardOf()).toEqual(['📦 Mark packed', '❌ Cancel']);
  });

  describe('the status line in the message text', () => {
    // What Telegram hands back for the new-order message: plain text, with the bold title and the map link as entities.
    const text = '🛒 New order CS-1\n🆕 Status: Pending\n🗺 Open map pin\nTotal: $5';
    const entities = [
      { type: 'bold', offset: 3, length: 11 },
      { type: 'text_link', offset: text.indexOf('Open map pin'), length: 12, url: 'https://maps.google.com/?q=1,2' },
    ];

    it('updates the status line with the buttons, keeps the formatting, and keeps the Open order button', async () => {
      const https = makeApp({ config: { ...testConfig(), webOrigin: 'https://shop.example.com' } });
      https.api.orders.set(o.id, { number: o.number, status: 'PENDING' });
      await press(https, `o:${o.id}:c`, { text, entities });
      const [edit] = https.telegram.textEdits;
      expect(edit!.text).toBe(text.replace('🆕 Status: Pending', '✅ Status: Confirmed'));
      // The link starts after the changed line: its offset still points at the same words.
      const link = edit!.entities!.find((e) => (e as { type: string }).type === 'text_link') as { offset: number; length: number };
      expect(edit!.text.slice(link.offset, link.offset + link.length)).toBe('Open map pin');
      expect(edit!.entities![0]).toEqual(entities[0]); // before the line: unchanged
      const rows = (edit!.replyMarkup as { inline_keyboard: { text: string }[][] }).inline_keyboard;
      expect(rows.flat().map((b) => b.text)).toEqual(['📦 Mark packed', '❌ Cancel', '🔗 Open order']);
      expect(https.telegram.edits).toHaveLength(0);
    });

    it('walks the line forward through every status, and shows the real one when the order moved elsewhere', async () => {
      let current = text;
      for (const code of ['c', 'p', 's', 'd'])
        await press(ctx, `o:${o.id}:${code}`, { text: current, entities: [] }).then(() => {
          current = ctx.telegram.textEdits.at(-1)!.text;
        });
      expect(current.split('\n')[1]).toBe('🎉 Status: Delivered');
      ctx.api.orders.set(o.id, { number: o.number, status: 'PACKED' });
      await press(ctx, `o:${o.id}:c`, { text, entities });
      expect(ctx.telegram.textEdits.at(-1)!.text.split('\n')[1]).toBe('📦 Status: Packed');
    });

    it('adds the line under the title on a message sent before the line existed', async () => {
      await press(ctx, `o:${o.id}:c`, { text: '🛒 New order CS-1\nTotal: $5', entities: [{ type: 'bold', offset: 18, length: 8 }] });
      const [edit] = ctx.telegram.textEdits;
      expect(edit!.text).toBe('🛒 New order CS-1\n✅ Status: Confirmed\nTotal: $5');
      const bold = edit!.entities![0] as { offset: number; length: number };
      expect(edit!.text.slice(bold.offset, bold.offset + bold.length)).toBe('Total: $');
    });

    it('leaves the text alone for the cancel question and "keep" (only the buttons change)', async () => {
      await press(ctx, `o:${o.id}:x:p`, { text, entities });
      await press(ctx, `o:${o.id}:k:p`, { text, entities });
      expect(ctx.telegram.textEdits).toHaveLength(0);
      expect(ctx.telegram.edits).toHaveLength(2);
    });
  });

  it('walks the order all the way to delivered', async () => {
    for (const code of ['c', 'p', 's', 'd']) await press(ctx, `o:${o.id}:${code}`);
    expect(ctx.api.orders.get(o.id)!.status).toBe('DELIVERED');
    expect(keyboardOf()).toEqual([]); // nothing left to do: the status is in the text
  });

  it('asks before cancelling, then cancels', async () => {
    await press(ctx, `o:${o.id}:x:p`);
    expect(ctx.api.statusCalls).toHaveLength(0);
    expect(keyboardOf()).toContain('⚠️ Yes, cancel it');
    await press(ctx, `o:${o.id}:k:p`);
    expect(keyboardOf()).toContain('✅ Confirm order');
    await press(ctx, `o:${o.id}:X`);
    expect(ctx.api.orders.get(o.id)!.status).toBe('CANCELLED');
    expect(keyboardOf()).toEqual([]);
  });

  it("ignores taps from any chat but the owner's, without bothering the api", async () => {
    await press(ctx, `o:${o.id}:c`, { fromId: 999, chatId: 999 });
    expect(ctx.api.statusCalls).toHaveLength(0);
    expect(ctx.telegram.answers.at(-1)).toMatchObject({
      alert: true,
      text: expect.stringContaining('Only the shop admin'),
    });
    expect(ctx.telegram.edits).toHaveLength(0);
  });

  it("in a group, passes on that the person must be a linked admin, and respects the api's no", async () => {
    const group = makeApp({ config: testConfig({ adminChatId: '-100123' }) });
    group.api.orders.set(o.id, { number: o.number, status: 'PENDING' });
    group.api.forbid = true;
    await press(group, `o:${o.id}:c`, { fromId: 321, chatId: -100123 });
    expect(group.api.statusCalls[0]!.body).toMatchObject({
      telegramUserId: 321,
      requireLinkedAdmin: true,
    });
    expect(group.telegram.answers.at(-1)).toMatchObject({ alert: true });
    expect(group.telegram.edits).toHaveLength(0);
    group.api.forbid = false;
    await press(group, `o:${o.id}:c`, { fromId: 321, chatId: -100123 });
    expect(group.api.orders.get(o.id)!.status).toBe('CONFIRMED');
  });

  it("refreshes the buttons from the api's answer when the order already moved on elsewhere", async () => {
    ctx.api.orders.get(o.id)!.status = 'PACKED'; // changed on the website
    await press(ctx, `o:${o.id}:c`);
    expect(ctx.telegram.answers.at(-1)).toMatchObject({
      alert: true,
      text: `Order ${o.number} is already Packed.`,
    });
    expect(keyboardOf()).toContain('🚚 Out for delivery');
  });

  it('says so when the order is gone or the api cannot be reached', async () => {
    await press(ctx, `o:00000000-0000-4000-8000-000000000000:c`);
    expect(ctx.telegram.answers.at(-1)).toMatchObject({ text: 'Order not found.', alert: true });
    ctx.api.down = true;
    await press(ctx, `o:${o.id}:c`);
    expect(ctx.telegram.answers.at(-1)).toMatchObject({
      alert: true,
      text: expect.stringContaining('not reachable'),
    });
  });

  it('ignores malformed button data but still answers the tap', async () => {
    expect((await press(ctx, 'o:not-a-uuid:c')).status).toBe(200);
    expect((await press(ctx, 'noop')).status).toBe(200);
    expect(ctx.telegram.answers).toHaveLength(2);
    expect(ctx.api.statusCalls).toHaveLength(0);
  });

  it('keeps every button within Telegram’s 64-byte limit', async () => {
    const { orderKeyboard } = await import('../src/buttons');
    for (const status of [
      'PENDING',
      'CONFIRMED',
      'PACKED',
      'SHIPPING',
      'DELIVERED',
      'CANCELLED',
    ] as const) {
      for (const ask of [false, true]) {
        for (const b of buttons(orderKeyboard({ id: o.id, status }, ask)))
          expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
      }
    }
  });

  describe('login buttons', () => {
    const REQ = '7f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b11';
    const tap = (data: string, fromId = CUSTOMER) => press(ctx, data, { fromId, chatId: fromId });

    it('passes the tap and the tapper\'s Telegram id to the api, then removes the buttons', async () => {
      ctx.api.loginReply = { outcome: 'confirmed', text: 'Done! You are logged in.' };
      expect((await tap(`login:${REQ}:y`)).status).toBe(200);
      await Outbox.idle();
      expect(ctx.api.loginCalls).toEqual([{ requestId: REQ, telegramUserId: CUSTOMER, decision: 'y' }]);
      expect(ctx.telegram.edits.at(-1)?.replyMarkup).toEqual({ inline_keyboard: [] });
      expect(ctx.telegram.answers.at(-1)).toMatchObject({ text: 'Done! You are logged in.' });
      expect(ctx.telegram.to(CUSTOMER).map((m) => m.text)).toEqual(['Done! You are logged in.']);
    });

    it('works for anyone in their own chat (not only the shop admin) and never touches order buttons', async () => {
      await tap(`login:${REQ}:n`, 4242);
      expect(ctx.api.loginCalls[0]).toMatchObject({ telegramUserId: 4242, decision: 'n' });
      expect(ctx.api.statusCalls).toEqual([]);
    });

    it('shows an alert and leaves the buttons when the tap is from another Telegram account', async () => {
      ctx.api.loginReply = { outcome: 'not_yours', text: 'This login request is for a different Telegram account.' };
      await tap(`login:${REQ}:y`);
      expect(ctx.telegram.answers.at(-1)).toMatchObject({ alert: true });
      expect(ctx.telegram.edits).toEqual([]);
    });

    it('answers the tap even when the api is down, and ignores malformed data', async () => {
      ctx.api.down = true;
      await tap(`login:${REQ}:y`);
      expect(ctx.telegram.answers.at(-1)).toMatchObject({ alert: true });
      ctx.api.down = false;
      ctx.api.loginCalls = [];
      await tap('login:not-an-id:y');
      expect(ctx.api.loginCalls).toEqual([]);
    });
  });
});
