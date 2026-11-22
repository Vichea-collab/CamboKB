import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BotAction } from '@cambo/shared';
import {
  createTestApp,
  createUser,
  INTERNAL_AUTH,
  loginAs,
  resetDb,
  WEB_ORIGIN,
} from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
let updateId = 1;
let said: BotAction[] = [];

/** A chat message forwarded by the notification service to the api. */
async function webhook(ctx: Ctx, message: Record<string, unknown>) {
  const res = await request(ctx.app)
    .post('/internal/telegram/updates')
    .set(INTERNAL_AUTH)
    .send({
      update: {
        update_id: updateId++,
        message: {
          message_id: updateId,
          chat: { id: (message.from as { id: number }).id, type: 'private' },
          ...message,
        },
      },
    });
  said.push(...((res.body.actions as BotAction[] | undefined) ?? []));
  return res;
}

const tgUser = (id: number) => ({ id, first_name: 'Dara', username: `dara${id}` });
const sendStart = (ctx: Ctx, fromId: number, token: string) =>
  webhook(ctx, { from: tgUser(fromId), text: `/start ${token}` });
const sendLocation = (ctx: Ctx, fromId: number, latitude: number, longitude: number) =>
  webhook(ctx, { from: tgUser(fromId), location: { latitude, longitude } });

const STORE_NEARBY = { latitude: 11.5651, longitude: 104.9123 };

async function startShare(agent: ReturnType<typeof request.agent>, origin = WEB_ORIGIN) {
  const res = await agent
    .post('/api/v1/auth/telegram/start')
    .set('Origin', origin)
    .send({ purpose: 'SHARE_LOCATION' });
  expect(res.status).toBe(200);
  const token = new URL(res.body.deepLink).searchParams.get('start')!;
  return { requestId: res.body.requestId as string, token };
}
const status = (agent: ReturnType<typeof request.agent>, id: string) =>
  agent.get(`/api/v1/auth/telegram/${id}/status`);

describe('sharing the delivery location through the Telegram bot', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
    said = [];
  });

  async function signedIn(telegramUserId: number | null = 777) {
    const user = await createUser(ctx.prisma, { telegramUserId: telegramUserId ?? undefined });
    return { user, agent: await loginAs(ctx.app, user.phone) };
  }

  it('asks the customer to share a location, then hands the coordinates to the checkout page', async () => {
    const { agent } = await signedIn();
    const { requestId, token } = await startShare(agent);
    expect((await status(agent, requestId)).body).toEqual({ status: 'PENDING' });

    await sendStart(ctx, 777, token);
    const ask = said.at(-1)!;
    expect(ask.text).toMatch(/location/i);
    // The reply keyboard has the one-tap "share my location" button.
    expect(JSON.stringify(ask.replyMarkup)).toContain('request_location');

    await sendLocation(ctx, 777, STORE_NEARBY.latitude, STORE_NEARBY.longitude);
    expect(said.at(-1)!.text).toMatch(/checkout/i);
    expect(said.at(-1)!.replyMarkup).toEqual({ remove_keyboard: true });

    expect((await status(agent, requestId)).body).toEqual({
      status: 'VERIFIED',
      lat: STORE_NEARBY.latitude,
      lng: STORE_NEARBY.longitude,
    });
  });

  it('requires a signed-in customer to start', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/auth/telegram/start')
      .set('Origin', WEB_ORIGIN)
      .send({ purpose: 'SHARE_LOCATION' });
    expect(res.status).toBe(401);
  });

  it('only accepts the link from the Telegram account linked to that customer', async () => {
    const { agent } = await signedIn(777);
    const { requestId, token } = await startShare(agent);

    await sendStart(ctx, 888, token); // someone else opens the link
    expect(said.at(-1)!.text).toMatch(/different|another/i);
    expect(JSON.stringify(said.at(-1)!.replyMarkup)).not.toContain('request_location');

    await sendLocation(ctx, 888, 11.57, 104.9);
    expect((await status(agent, requestId)).body).toEqual({ status: 'PENDING' });
  });

  it('refuses a customer whose account has no Telegram linked', async () => {
    const { agent } = await signedIn(null);
    const { requestId, token } = await startShare(agent);
    await sendStart(ctx, 777, token);
    await sendLocation(ctx, 777, 11.57, 104.9);
    expect((await status(agent, requestId)).body).toEqual({ status: 'PENDING' });
  });

  it('explains it when the app cannot send a location and posts the button label as text instead', async () => {
    await webhook(ctx, { from: tgUser(777), text: '📍 Share my location' });
    expect(said.at(-1)!.text).toMatch(/can.t send a location/i);
    expect(said.at(-1)!.text).toMatch(/Use my location/);
    expect(JSON.stringify(said.at(-1)!.replyMarkup)).toContain('remove_keyboard');
  });

  it('ignores a location sent without opening the checkout link first', async () => {
    const { agent } = await signedIn();
    const { requestId } = await startShare(agent); // link never opened in Telegram
    await sendLocation(ctx, 777, 11.57, 104.9);
    expect(said.at(-1)!.text).toMatch(/checkout/i);
    expect((await status(agent, requestId)).body).toEqual({ status: 'PENDING' });
  });

  it('does not accept a location after the request expired, and never shows the coordinates then', async () => {
    const { agent } = await signedIn();
    const { requestId, token } = await startShare(agent);
    await sendStart(ctx, 777, token);
    await sendLocation(ctx, 777, 11.57, 104.9);
    await ctx.prisma.telegramAuthRequest.update({
      where: { id: requestId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await status(agent, requestId)).body).toEqual({ status: 'EXPIRED' });

    const second = await startShare(agent);
    await sendStart(ctx, 777, second.token);
    await ctx.prisma.telegramAuthRequest.update({
      where: { id: second.requestId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await sendLocation(ctx, 777, 1, 1);
    expect((await status(agent, second.requestId)).body).toEqual({ status: 'EXPIRED' });
  });

  it("another browser can't read the coordinates", async () => {
    const { agent } = await signedIn();
    const { requestId, token } = await startShare(agent);
    await sendStart(ctx, 777, token);
    await sendLocation(ctx, 777, 11.57, 104.9);
    const stranger = request.agent(ctx.app);
    expect((await status(stranger, requestId)).status).toBe(404);
  });

  it('lets a reloaded checkout page pick up a location that was already shared', async () => {
    const { agent } = await signedIn();
    const { token } = await startShare(agent);
    await sendStart(ctx, 777, token);
    await sendLocation(ctx, 777, 11.57, 104.9);
    const current = await agent
      .get('/api/v1/auth/telegram/current')
      .query({ purpose: 'SHARE_LOCATION' });
    expect(current.body.request).toMatchObject({ status: 'VERIFIED', lat: 11.57, lng: 104.9 });
  });

  describe('returning to the mini app', () => {
    const SHOP = 'https://shop.example.com';
    async function httpsCtx() {
      return createTestApp({ config: { ...ctx.deps.config, webOrigin: [SHOP] } });
    }

    it('sends a button that opens checkout in the mini app once the location is saved', async () => {
      const web = await httpsCtx();
      const user = await createUser(web.prisma, { telegramUserId: 777 });
      const agent = await loginAs(web.app, user.phone);
      const { token } = await startShare(agent, SHOP);
      await sendStart(web, 777, token);
      await sendLocation(web, 777, 11.57, 104.9);
      const [saved, back] = said.slice(-2);
      expect(saved!.replyMarkup).toEqual({ remove_keyboard: true });
      expect(back!.replyMarkup).toEqual({
        inline_keyboard: [[{ text: expect.stringContaining('checkout'), web_app: { url: `${SHOP}/checkout` } }]],
      });
    });

    it('sends no button when the site is not on https (Telegram only opens mini apps from https)', async () => {
      const { agent } = await signedIn();
      const { token } = await startShare(agent);
      await sendStart(ctx, 777, token);
      await sendLocation(ctx, 777, 11.57, 104.9);
      expect(said.at(-1)!.replyMarkup).toEqual({ remove_keyboard: true });
      expect(JSON.stringify(said)).not.toContain('web_app');
    });

    it('lets a fresh mini app (no cookie from the earlier page) pick up the location of the signed-in customer', async () => {
      const { user, agent } = await signedIn();
      const { token } = await startShare(agent);
      await sendStart(ctx, 777, token);
      await sendLocation(ctx, 777, 11.57, 104.9);
      const reopened = await loginAs(ctx.app, user.phone); // new webview: session cookie only
      const current = await reopened
        .get('/api/v1/auth/telegram/current')
        .query({ purpose: 'SHARE_LOCATION' });
      expect(current.body.request).toMatchObject({ status: 'VERIFIED', lat: 11.57, lng: 104.9 });
    });

    it('does not hand one customer the location another one shared, or an expired one', async () => {
      const { agent } = await signedIn(777);
      const { token } = await startShare(agent);
      await sendStart(ctx, 777, token);
      await sendLocation(ctx, 777, 11.57, 104.9);
      const other = await createUser(ctx.prisma, { telegramUserId: 999 });
      const otherAgent = await loginAs(ctx.app, other.phone);
      const theirs = await otherAgent.get('/api/v1/auth/telegram/current').query({ purpose: 'SHARE_LOCATION' });
      expect(theirs.body.request).toBeNull();

      await ctx.prisma.telegramAuthRequest.updateMany({
        where: { purpose: 'SHARE_LOCATION' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const user = (await ctx.prisma.user.findFirst({ where: { telegramUserId: 777n } }))!;
      const late = await (await loginAs(ctx.app, user.phone)).get('/api/v1/auth/telegram/current').query({ purpose: 'SHARE_LOCATION' });
      expect(late.body.request).toBeNull();
    });
  });

  it('lets a customer retry sharing many times without using up the login allowance', async () => {
    const { agent } = await signedIn();
    for (let i = 0; i < 15; i++) await startShare(agent); // more than the 10 a login start is allowed
    const login = await request(ctx.app)
      .post('/api/v1/auth/telegram/start')
      .set('Origin', WEB_ORIGIN)
      .send({ purpose: 'LOGIN' });
    expect(login.status).toBe(200);
  });

  it('rejects coordinates that are not on Earth', async () => {
    const { agent } = await signedIn();
    const { requestId, token } = await startShare(agent);
    await sendStart(ctx, 777, token);
    await sendLocation(ctx, 777, 123, 500);
    expect((await status(agent, requestId)).body).toEqual({ status: 'PENDING' });
  });
});
