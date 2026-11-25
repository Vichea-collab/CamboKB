import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { BOT_COMMANDS, type BotAction } from '@cambo/shared';
import {
  createProduct,
  createTestApp,
  createUser,
  INTERNAL_AUTH,
  resetDb,
  testConfig,
  WEB_ORIGIN,
} from '../../../test/helpers';

import { sha256 } from '../auth/sessions';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
const TG_ID = 7001;
let updateId = 1;

/** What the notification service does when someone messages the bot: forward it, then send the answer. */
async function ask(ctx: Ctx, text: string, fromId = TG_ID): Promise<BotAction[]> {
  const res = await request(ctx.app)
    .post('/internal/telegram/updates')
    .set(INTERNAL_AUTH)
    .send({
      update: {
        update_id: updateId++,
        message: {
          message_id: updateId,
          from: { id: fromId, first_name: 'Dara' },
          chat: { id: fromId, type: 'private' },
          text,
        },
      },
    });
  expect(res.status).toBe(200);
  return res.body.actions;
}

describe('bot commands (answered by the api, sent by the notification service)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
  });

  it('/orders lists the latest orders of the customer', async () => {
    const user = await createUser(ctx.prisma, { telegramUserId: TG_ID, name: 'Dara' });
    const product = await createProduct(ctx.prisma, { name: 'Mousepad XL', priceCents: 600 });
    for (const [i, status] of (['DELIVERED', 'SHIPPING'] as const).entries()) {
      await ctx.prisma.order.create({
        data: {
          userId: user.id,
          status,
          contactName: 'Dara',
          contactPhone: user.phone,
          region: 'PHNOM_PENH',
          deliveryService: 'VET',
          addressLine: 'A',
          subtotalCents: 600,
          deliveryFeeCents: 150,
          totalCents: 750,
          createdAt: new Date(Date.now() - (2 - i) * 3600_000),
          items: {
            create: {
              productId: product.id,
              name: product.name,
              priceCents: 600,
              quantity: 1,
              lineTotalCents: 600,
            },
          },
        },
      });
    }
    const [reply] = await ask(ctx, '/orders');
    expect(reply).toMatchObject({ type: 'send', chatId: TG_ID });
    expect(reply!.text).toMatch(/CS-\d{6} · On the way · \$7\.50/);
    expect(reply!.text).toMatch(/CS-\d{6} · Delivered · \$7\.50/);
    expect(reply!.text.indexOf('On the way')).toBeLessThan(reply!.text.indexOf('Delivered'));
  });

  it('/orders has a button for each order that opens it inside Telegram (https)', async () => {
    const https = await createTestApp({ config: testConfig({ webOrigin: ['https://shop.test'] }) });
    const user = await createUser(https.prisma, { telegramUserId: TG_ID, name: 'Dara' });
    for (const [i, status] of (['DELIVERED', 'SHIPPING'] as const).entries())
      await https.prisma.order.create({
        data: {
          userId: user.id, status, contactName: 'Dara', contactPhone: user.phone, region: 'PHNOM_PENH', deliveryService: 'VET',
          addressLine: 'A', subtotalCents: 600, deliveryFeeCents: 150, totalCents: 750, createdAt: new Date(Date.now() - (2 - i) * 3600_000),
        },
      });
    const [newest, older] = await https.prisma.order.findMany({ orderBy: { createdAt: 'desc' } });
    const [reply] = await ask(https, '/orders');
    expect(reply!.text).toBe('Your latest orders. Tap one to open it:');
    expect(reply!.replyMarkup).toEqual({
      inline_keyboard: [
        [{ text: `🚚 ${newest!.number} · On the way · $7.50`, web_app: { url: `https://shop.test/account/orders/${newest!.number}` } }],
        [{ text: `🎉 ${older!.number} · Delivered · $7.50`, web_app: { url: `https://shop.test/account/orders/${older!.number}` } }],
      ],
    });
  });

  it('/orders invites a visitor without an account to sign up', async () => {
    expect((await ask(ctx, '/orders'))[0]!.text).toContain(`${WEB_ORIGIN}/signup`);
  });

  it('/orders says when there are no orders yet', async () => {
    await createUser(ctx.prisma, { telegramUserId: TG_ID });
    expect((await ask(ctx, '/orders'))[0]!.text).toContain("haven't ordered");
  });

  it('/help lists the commands and /shop links to the store', async () => {
    const help = (await ask(ctx, '/help'))[0]!.text;
    for (const c of BOT_COMMANDS) expect(help).toContain(`/${c.command}`);
    expect((await ask(ctx, '/shop'))[0]!.text).toContain(WEB_ORIGIN);
  });

  it('/shop opens the store as a Telegram app when the site is on https', async () => {
    const https = await createTestApp({
      config: { ...ctx.deps.config, webOrigin: ['https://shop.example.com'] },
    });
    const [reply] = await ask(https, '/shop');
    expect(JSON.stringify(reply!.replyMarkup)).toContain(
      '"web_app":{"url":"https://shop.example.com"}',
    );
  });

  describe('someone asks a question', () => {
    const contact = (info: object) =>
      ctx.prisma.storeSetting.update({ where: { id: 1 }, data: { info: { phone: '', telegram: '', facebook: '', address: '', hours: '', warranty: '', ...info } } });

    it('tells a customer how to reach a person, with a button, and how to use the bot', async () => {
      await contact({ phone: '017 312 404', telegram: 'CamboKB' });
      await createUser(ctx.prisma, { telegramUserId: TG_ID });
      const [reply] = await ask(ctx, 'Is this in stock?');
      expect(reply!.text).toContain('@CamboKB');
      expect(reply!.text).toContain('017 312 404');
      expect(reply!.text).toContain('/shop');
      expect(reply!.replyMarkup).toEqual({ inline_keyboard: [[{ text: '💬 Message us', url: 'https://t.me/CamboKB' }]] });
    });

    it('leaves out what the shop has not filled in', async () => {
      await contact({ phone: '017 312 404' });
      await createUser(ctx.prisma, { telegramUserId: TG_ID });
      const [reply] = await ask(ctx, 'hello');
      expect(reply!.text).toContain('017 312 404');
      expect(reply!.text).not.toContain('@');
      expect(reply!.replyMarkup).toBeUndefined();
    });

    it('still names the commands when the shop has no contact details', async () => {
      await createUser(ctx.prisma, { telegramUserId: TG_ID });
      const [reply] = await ask(ctx, 'hello');
      expect(reply!.text).toContain('/help');
      expect(reply!.text).not.toContain('Call');
    });

    it('lets a new person sign up right there, and tells them how to reach the shop', async () => {
      await contact({ telegram: 'CamboKB' });
      const [reply] = await ask(ctx, 'hello');
      expect(reply!.text).toContain('Welcome to Cambo Keyboard Supply');
      expect(reply!.text).toContain('@CamboKB');
      expect(reply!.replyMarkup).toMatchObject({ keyboard: [[{ text: '📱 Share my phone number', request_contact: true }]] });
    });
  });

  it('points a customer who types something that is not a command to the commands, not to sign-up', async () => {
    await createUser(ctx.prisma, { telegramUserId: TG_ID, name: 'Dara' });
    const [reply] = await ask(ctx, 'hello');
    expect(reply!.text).toContain('/shop');
    expect(reply!.text).toContain('/help');
    expect(reply!.text).not.toMatch(/sign-up/i);
  });

  it('ignores group chats and bots, and answers a stranger with how to start', async () => {
    const group = await request(ctx.app)
      .post('/internal/telegram/updates')
      .set(INTERNAL_AUTH)
      .send({
        update: {
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 5 },
            chat: { id: -9, type: 'group' },
            text: '/orders',
          },
        },
      });
    expect(group.body.actions).toEqual([]);
    expect((await ask(ctx, 'hello'))[0]!.text).toContain('share your phone number');
  });

  it('a name or browser with < or & in it cannot break the login question (it is HTML, for the bold code)', async () => {
    const user = await createUser(ctx.prisma, { telegramUserId: TG_ID, name: 'Dara <b> & Co' });
    const token = 'x'.repeat(32);
    await ctx.prisma.telegramAuthRequest.create({
      data: { tokenHash: sha256(token), purpose: 'LOGIN', matchCode: '42', browser: 'Chrome <1>', expiresAt: new Date(Date.now() + 60_000) },
    });
    const [reply] = await ask(ctx, `/start ${token}`);
    expect(reply!.parseMode).toBe('HTML');
    expect(reply!.text).toContain('Dara &lt;b&gt; &amp; Co?');
    expect(reply!.text).toContain('Chrome &lt;1&gt;');
    expect(reply!.text).toContain('<b>Code: 42</b>');
    expect(user.name).toBe('Dara <b> & Co');
  });

  it('only answers the notification service', async () => {
    const res = await request(ctx.app)
      .post('/internal/telegram/updates')
      .send({ update: { update_id: 1 } });
    expect(res.status).toBe(401);
    expect(
      (
        await request(ctx.app)
          .post('/internal/telegram/updates')
          .set(INTERNAL_AUTH)
          .send({ nope: true })
      ).status,
    ).toBe(400);
  });
});
