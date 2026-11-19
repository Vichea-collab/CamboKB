import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { BOT_COMMANDS, type BotAction } from '@cambo/shared';
import {
  createProduct,
  createTestApp,
  createUser,
  INTERNAL_AUTH,
  resetDb,
  WEB_ORIGIN,
} from '../../../test/helpers';

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
    expect((await ask(ctx, 'hello'))[0]!.text).toContain('sign-up link');
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
