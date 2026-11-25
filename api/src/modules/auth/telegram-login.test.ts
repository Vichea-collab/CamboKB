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
import { eventsIdle } from '../events/outbox';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
let updateId = 1;

/** Everything the bot was asked to say, in order (the notification service would send these). */
let said: BotAction[] = [];

/** A chat message forwarded by the notification service to the api. */
async function webhook(ctx: Ctx, message: Record<string, unknown>, auth: Record<string, string> = INTERNAL_AUTH) {
  const res = await request(ctx.app)
    .post('/internal/telegram/updates')
    .set(auth)
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
const sendStart = (ctx: Ctx, fromId: number, token: string) => webhook(ctx, { from: tgUser(fromId), text: `/start ${token}` });
const sendContact = (ctx: Ctx, fromId: number, phone: string, contactUserId = fromId) =>
  webhook(ctx, { from: tgUser(fromId), contact: { phone_number: phone, first_name: 'Dara', user_id: contactUserId } });
/** Tap "Log me in" (y) or "Not me" (n) as Telegram user `fromId`. */
const tap = (ctx: Ctx, requestId: string, decision: 'y' | 'n', fromId: number, auth = INTERNAL_AUTH) =>
  request(ctx.app).post('/internal/telegram/login-confirm').set(auth).send({ requestId, telegramUserId: fromId, decision });

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

async function startLogin(ctx: Ctx, agent = request.agent(ctx.app)) {
  const res = await agent.post('/api/v1/auth/telegram/start').set('Origin', WEB_ORIGIN).set('User-Agent', CHROME_ANDROID).send({ purpose: 'LOGIN' });
  expect(res.status).toBe(200);
  const token = new URL(res.body.deepLink).searchParams.get('start')!;
  return { agent, requestId: res.body.requestId as string, token, res };
}
const complete = (agent: ReturnType<typeof request.agent>, requestId: string) =>
  agent.post('/api/v1/auth/login/complete').set('Origin', WEB_ORIGIN).send({ requestId });
const statusOf = async (agent: ReturnType<typeof request.agent>, requestId: string) =>
  (await agent.get(`/api/v1/auth/telegram/${requestId}/status`)).body;
const lastText = () => said.at(-1)?.text ?? '';
const markupOf = (a: BotAction | undefined) => JSON.stringify(a?.replyMarkup ?? {});

describe('Continue with Telegram (login by deep link)', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
    said = [];
  });

  describe('starting', () => {
    it('gives a deep link, a 2-digit match code and a 5 minute life, and remembers the browser', async () => {
      const { res, requestId } = await startLogin(ctx);
      expect(res.body.deepLink).toMatch(/^https:\/\/t\.me\/CamboSupplyBot\?start=[A-Za-z0-9_-]{20,64}$/);
      expect(res.body.matchCode).toMatch(/^\d\d$/);
      const minutes = (new Date(res.body.expiresAt).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(4.5);
      expect(minutes).toBeLessThanOrEqual(5);
      const row = await ctx.prisma.telegramAuthRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(row).toMatchObject({ purpose: 'LOGIN', status: 'PENDING', matchCode: res.body.matchCode, browser: 'Chrome on Android' });
    });

    it('needs no account and no sign-in', async () => {
      const res = await request(ctx.app).post('/api/v1/auth/telegram/start').set('Origin', WEB_ORIGIN).send({ purpose: 'LOGIN' });
      expect(res.status).toBe(200);
    });

    it('shows the match code again after a reload (status and current)', async () => {
      const { agent, requestId, res } = await startLogin(ctx);
      expect(await statusOf(agent, requestId)).toMatchObject({ status: 'PENDING', matchCode: res.body.matchCode });
      const current = await agent.get('/api/v1/auth/telegram/current').query({ purpose: 'LOGIN' });
      expect(current.body.request).toMatchObject({ requestId, status: 'PENDING', matchCode: res.body.matchCode });
    });

    it('no longer starts a password reset or a website sign-up', async () => {
      for (const purpose of ['RESET', 'SIGNUP']) {
        const res = await request(ctx.app).post('/api/v1/auth/telegram/start').set('Origin', WEB_ORIGIN).send({ purpose, phone: '012345678' });
        expect(res.status).toBe(400);
      }
    });
  });

  describe('a linked account', () => {
    it('is asked to confirm in the bot, then logged in; the tap is what makes the request verified', async () => {
      const user = await createUser(ctx.prisma, { phone: '+85512345678', telegramUserId: 777, name: 'Dara Sok' });
      const { agent, requestId, token, res } = await startLogin(ctx);

      await sendStart(ctx, 777, token);
      expect(lastText()).toContain('Log in to Cambo Keyboard Supply as Dara Sok?');
      expect(lastText()).toContain('Chrome on Android');
      expect(lastText()).toContain(`\n\n<b>Code: ${res.body.matchCode}</b>\n\n`); // easy to compare: its own line, bold
      expect(lastText()).toContain('Only tap if you are doing this right now');
      expect(markupOf(said.at(-1))).toContain(`login:${requestId}:y`);
      expect(markupOf(said.at(-1))).toContain(`login:${requestId}:n`);
      expect((await statusOf(agent, requestId)).status).toBe('PENDING');
      // Not verified yet: the website cannot finish.
      expect((await complete(agent, requestId)).status).toBe(409);

      const confirmed = await tap(ctx, requestId, 'y', 777);
      expect(confirmed.body.outcome).toBe('confirmed');
      expect((await statusOf(agent, requestId)).status).toBe('VERIFIED');

      const done = await complete(agent, requestId);
      expect(done.status).toBe(200);
      expect(done.body.user).toMatchObject({ id: user.id, phone: '+85512345678' });
      const cookies = String(done.headers['set-cookie']);
      expect(cookies).toMatch(/cs_session=.*HttpOnly.*SameSite=Lax/);
      expect(cookies).toMatch(/cs_tg_req=;/); // the browser binding is cleared
      expect((await agent.get('/api/v1/auth/me')).body.user.id).toBe(user.id);
      expect((await ctx.prisma.telegramAuthRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('COMPLETED');
    });

    it('cannot complete the same request twice', async () => {
      await createUser(ctx.prisma, { telegramUserId: 777 });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 777, token);
      await tap(ctx, requestId, 'y', 777);
      expect((await complete(agent, requestId)).status).toBe(200);
      const again = await complete(agent, requestId);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('TELEGRAM_NOT_VERIFIED');
    });

    it('"Not me" logs nobody in and ends the request', async () => {
      await createUser(ctx.prisma, { telegramUserId: 777 });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 777, token);
      const res = await tap(ctx, requestId, 'n', 777);
      expect(res.body.outcome).toBe('declined');
      expect((await statusOf(agent, requestId)).status).toBe('EXPIRED');
      expect((await complete(agent, requestId)).status).toBe(409);
      // And a later "Log me in" on the same message does nothing.
      expect((await tap(ctx, requestId, 'y', 777)).body.outcome).toBe('expired');
      expect((await complete(agent, requestId)).status).toBe(409);
    });

    it("a tap from a different Telegram account does nothing (a forwarded message is useless)", async () => {
      await createUser(ctx.prisma, { telegramUserId: 777 });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 777, token);
      const res = await tap(ctx, requestId, 'y', 888);
      expect(res.body.outcome).toBe('not_yours');
      expect((await tap(ctx, requestId, 'n', 888)).body.outcome).toBe('not_yours');
      expect((await statusOf(agent, requestId)).status).toBe('PENDING');
      expect((await complete(agent, requestId)).status).toBe(409);
    });

    it("another Telegram account cannot take over a link that was already opened", async () => {
      await createUser(ctx.prisma, { telegramUserId: 777 });
      await createUser(ctx.prisma, { telegramUserId: 888 });
      const { requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 777, token);
      await sendStart(ctx, 888, token);
      expect(lastText()).toMatch(/expired/);
      const row = await ctx.prisma.telegramAuthRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(row.telegramUserId).toBe(777n);
    });

    it('only the browser that started the request can finish it', async () => {
      await createUser(ctx.prisma, { telegramUserId: 777 });
      const { requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 777, token);
      await tap(ctx, requestId, 'y', 777);
      const stranger = request.agent(ctx.app);
      expect((await statusOf(stranger, requestId)).error?.code).toBe('NOT_FOUND');
      expect((await complete(stranger, requestId)).status).toBe(409);
      expect((await stranger.get('/api/v1/auth/me')).status).toBe(401);
    });

    it('refuses an expired link, and an expired request cannot be confirmed or completed', async () => {
      await createUser(ctx.prisma, { telegramUserId: 777 });
      const first = await startLogin(ctx);
      await ctx.prisma.telegramAuthRequest.update({ where: { id: first.requestId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await sendStart(ctx, 777, first.token);
      expect(lastText()).toMatch(/expired/);
      expect((await statusOf(first.agent, first.requestId)).status).toBe('EXPIRED');

      const second = await startLogin(ctx);
      await sendStart(ctx, 777, second.token);
      await ctx.prisma.telegramAuthRequest.update({ where: { id: second.requestId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await tap(ctx, second.requestId, 'y', 777)).body.outcome).toBe('expired');
      expect((await complete(second.agent, second.requestId)).status).toBe(409);
    });

    it('a disabled account is not logged in, before or after the tap', async () => {
      const u = await createUser(ctx.prisma, { telegramUserId: 777 });
      await ctx.prisma.user.update({ where: { id: u.id }, data: { disabledAt: new Date() } });
      const a = await startLogin(ctx);
      await sendStart(ctx, 777, a.token);
      expect(lastText()).toMatch(/couldn't verify/);
      expect(markupOf(said.at(-1))).not.toContain('login:');
      expect((await complete(a.agent, a.requestId)).status).toBe(409);

      await ctx.prisma.user.update({ where: { id: u.id }, data: { disabledAt: null } });
      const b = await startLogin(ctx);
      await sendStart(ctx, 777, b.token);
      await tap(ctx, b.requestId, 'y', 777);
      await ctx.prisma.user.update({ where: { id: u.id }, data: { disabledAt: new Date() } });
      const done = await complete(b.agent, b.requestId);
      expect(done.status).toBe(403);
      expect(done.body.error.code).toBe('ACCOUNT_DISABLED');
      expect((await b.agent.get('/api/v1/auth/me')).status).toBe(401);
    });

    it('is not logged in if the account was unlinked from that Telegram account before the website finished', async () => {
      const u = await createUser(ctx.prisma, { telegramUserId: 777 });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 777, token);
      await tap(ctx, requestId, 'y', 777);
      await ctx.prisma.user.update({ where: { id: u.id }, data: { telegramUserId: 999n } });
      expect((await complete(agent, requestId)).status).toBe(409);
    });

    it('rejects login-confirm calls without the service secret, and unknown requests', async () => {
      await createUser(ctx.prisma, { telegramUserId: 777 });
      const { requestId } = await startLogin(ctx);
      expect((await tap(ctx, requestId, 'y', 777, { Authorization: 'Bearer wrong' })).status).toBe(401);
      expect((await tap(ctx, '7f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b11', 'y', 777)).body.outcome).toBe('expired');
      // A request of another purpose cannot be confirmed as a login.
      const other = await ctx.prisma.telegramAuthRequest.create({
        data: { tokenHash: 'other-purpose', purpose: 'CHANGE_PHONE', telegramUserId: 777n, expiresAt: new Date(Date.now() + 60_000) },
      });
      expect((await tap(ctx, other.id, 'y', 777)).body.outcome).toBe('expired');
      expect((await ctx.prisma.telegramAuthRequest.findUniqueOrThrow({ where: { id: other.id } })).status).toBe('PENDING');
    });
  });

  describe('an account that is not linked to Telegram yet', () => {
    it('links the account whose phone is shared, then logs in (no confirm button needed)', async () => {
      const user = await createUser(ctx.prisma, { phone: '+85512345678', name: 'Admin-made' });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 777, token);
      expect(JSON.stringify(said.at(-1)?.replyMarkup)).toContain('request_contact');
      expect(lastText()).toContain('Chrome on Android');
      await sendContact(ctx, 777, '85512345678');
      expect(lastText()).toMatch(/logged in/);
      expect((await statusOf(agent, requestId)).status).toBe('VERIFIED');
      const done = await complete(agent, requestId);
      expect(done.status).toBe(200);
      expect(done.body.user.id).toBe(user.id);
      const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after).toMatchObject({ telegramUserId: 777n, telegramChatId: 777n, telegramUsername: 'dara777', name: 'Admin-made' });
    });

    it('refuses a phone that is linked to a different Telegram account, and changes nothing', async () => {
      const user = await createUser(ctx.prisma, { phone: '+85512345678', telegramUserId: 555 });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 777, token);
      await sendContact(ctx, 777, '85512345678');
      expect(lastText()).toMatch(/contact the shop/);
      expect((await statusOf(agent, requestId)).status).toBe('EXPIRED');
      expect((await complete(agent, requestId)).status).toBe(409);
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).telegramUserId).toBe(555n);
    });

    it("refuses a contact that isn't the sender's own number (a forwarded contact)", async () => {
      const user = await createUser(ctx.prisma, { phone: '+85512345678' });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 777, token);
      await sendContact(ctx, 777, '85512345678', 999);
      expect(lastText()).toMatch(/share your own phone number/);
      expect((await statusOf(agent, requestId)).status).toBe('PENDING');
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).telegramUserId).toBeNull();
    });

    it('a disabled account is not linked', async () => {
      const user = await createUser(ctx.prisma, { phone: '+85512345678' });
      await ctx.prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 777, token);
      await sendContact(ctx, 777, '85512345678');
      expect(lastText()).toMatch(/couldn't verify/);
      expect((await complete(agent, requestId)).status).toBe(409);
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).telegramUserId).toBeNull();
    });

    it('signs up a phone that has no account (the same button), named from the Telegram profile, and tells the owner', async () => {
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 777, token);
      await sendContact(ctx, 777, '85512345678');
      const done = await complete(agent, requestId);
      expect(done.status).toBe(200);
      expect(done.body.user).toMatchObject({ phone: '+85512345678', name: 'Dara', telegramUsername: 'dara777', role: 'CUSTOMER' });
      const row = await ctx.prisma.user.findUniqueOrThrow({ where: { phone: '+85512345678' } });
      expect(row.telegramUserId).toBe(777n);
      await eventsIdle();
      expect(ctx.events.data('customer.signed_up')).toEqual([{ name: 'Dara', phone: '+85512345678', telegramUsername: 'dara777', adminAlerts: true }]);
    });

    it('does not use the contact once the login link was answered by a linked account', async () => {
      await createUser(ctx.prisma, { phone: '+85512345678', telegramUserId: 777 });
      const { requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 777, token);
      await sendContact(ctx, 777, '85512345678');
      expect(lastText()).toMatch(/Log me in/);
      expect((await ctx.prisma.telegramAuthRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('PENDING');
    });
  });

  describe('admins use exactly the same flow (no shortcut)', () => {
    it('a linked admin must confirm in Telegram, gets a 1-day session, and reaches the admin area', async () => {
      const admin = await createUser(ctx.prisma, { role: 'ADMIN', telegramUserId: 777 });
      const { agent, requestId, token } = await startLogin(ctx);
      // No confirmation yet: nothing, even though the account is an admin.
      expect((await complete(agent, requestId)).status).toBe(409);
      await sendStart(ctx, 777, token);
      expect((await complete(agent, requestId)).status).toBe(409);
      await tap(ctx, requestId, 'y', 777);
      expect((await complete(agent, requestId)).status).toBe(200);
      expect((await agent.get('/api/v1/admin/stats')).status).not.toBe(403);
      const s = await ctx.prisma.session.findFirstOrThrow({ where: { userId: admin.id } });
      expect(s.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    });

    it("someone else's Telegram account cannot log in as an admin, with or without sharing the admin's phone", async () => {
      const admin = await createUser(ctx.prisma, { role: 'ADMIN', phone: '+85512345678', telegramUserId: 777 });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 888, token); // 888 is an unlinked stranger
      await sendContact(ctx, 888, '85512345678');
      expect(lastText()).toMatch(/contact the shop/);
      expect((await complete(agent, requestId)).status).toBe(409);
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).telegramUserId).toBe(777n);
    });
  });

  describe('starting in the bot', () => {
    const shareFirst = async (id = 777, phone = '85512345678') => {
      const from = { id, first_name: 'Dara', last_name: 'Sok', username: `dara${id}` };
      await webhook(ctx, { from, text: '/start' });
      await webhook(ctx, { from, contact: { phone_number: phone, first_name: 'Dara', user_id: id } });
    };
    const linkToken = () => /\/login\?t=([A-Za-z0-9_-]+)/.exec(JSON.stringify(said.at(-1)))?.[1] ?? '';
    const claim = (agent: ReturnType<typeof request.agent>, token: string) =>
      agent.post('/api/v1/auth/telegram/claim').set('Origin', WEB_ORIGIN).send({ token });

    it('creates the account and replies with a one-time link that logs in', async () => {
      await shareFirst();
      expect(lastText()).toMatch(/Verified/);
      expect(lastText()).not.toMatch(/password/i);
      expect(linkToken()).toHaveLength(43);
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { phone: '+85512345678' } });
      expect(user).toMatchObject({ name: 'Dara Sok', telegramUserId: 777n, telegramUsername: 'dara777', role: 'CUSTOMER' });
      const row = await ctx.prisma.telegramAuthRequest.findFirstOrThrow({ where: { telegramUserId: 777n } });
      expect(row).toMatchObject({ purpose: 'LOGIN', status: 'VERIFIED', userId: user.id, phone: '+85512345678' });
    });

    it('the website claims the link, then completes the login', async () => {
      await shareFirst();
      const agent = request.agent(ctx.app);
      const res = await claim(agent, linkToken());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'VERIFIED', firstName: 'Dara Sok', phone: '+855 •• ••• 678' });
      expect((await agent.get('/api/v1/auth/me')).status).toBe(401); // claiming alone logs nobody in
      const done = await complete(agent, res.body.requestId);
      expect(done.status).toBe(200);
      expect((await agent.get('/api/v1/auth/me')).body.user).toMatchObject({ name: 'Dara Sok', phone: '+85512345678', telegramUsername: 'dara777' });
    });

    it('a link works once, so a leaked or forwarded link cannot be claimed by someone else afterwards', async () => {
      await shareFirst();
      const token = linkToken();
      const first = request.agent(ctx.app);
      const claimed = await claim(first, token);
      expect(claimed.status).toBe(200);
      const second = await claim(request.agent(ctx.app), token);
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('TELEGRAM_NOT_VERIFIED');
      // Only the browser that claimed it can finish.
      expect((await complete(request.agent(ctx.app), claimed.body.requestId)).status).toBe(409);
    });

    it('refuses an unknown or expired link', async () => {
      await shareFirst();
      expect((await claim(request.agent(ctx.app), 'x'.repeat(43))).status).toBe(409);
      await ctx.prisma.telegramAuthRequest.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await claim(request.agent(ctx.app), linkToken())).status).toBe(409);
    });

    it('a request the website started cannot be claimed as if it were a link', async () => {
      const { token } = await startLogin(ctx);
      expect((await claim(request.agent(ctx.app), token)).status).toBe(409);
    });

    it('tells a number that already has an account to use Continue with Telegram, and creates nothing', async () => {
      await createUser(ctx.prisma, { phone: '+85512345678' });
      await shareFirst();
      expect(lastText()).toMatch(/Continue with Telegram/);
      expect(await ctx.prisma.telegramAuthRequest.count()).toBe(0);
      expect(await ctx.prisma.user.count()).toBe(1);
    });

    it("still rejects a contact that isn't the sender's own number", async () => {
      await webhook(ctx, { from: tgUser(777), text: '/start' });
      await sendContact(ctx, 777, '85512345678', 999);
      expect(lastText()).toMatch(/share your own phone number/);
      expect(await ctx.prisma.user.count()).toBe(0);
    });
  });

  describe('changing the phone number (unchanged)', () => {
    it('changes the phone number of a signed-in user', async () => {
      const u = await createUser(ctx.prisma, { phone: '+85512345678', telegramUserId: 777 });
      const agent = await loginAs(ctx.app, u.phone);
      const res = await agent.post('/api/v1/auth/telegram/start').set('Origin', WEB_ORIGIN).send({ purpose: 'CHANGE_PHONE' });
      const token = new URL(res.body.deepLink).searchParams.get('start')!;
      await sendStart(ctx, 777, token);
      await sendContact(ctx, 777, '85587654321');
      const done = await agent.post('/api/v1/auth/me/phone/complete').set('Origin', WEB_ORIGIN).send({ requestId: res.body.requestId });
      expect(done.status).toBe(200);
      expect(done.body.user.phone).toBe('+85587654321');
    });

    it('requires a signed-in user to change phone', async () => {
      const res = await request(ctx.app).post('/api/v1/auth/telegram/start').set('Origin', WEB_ORIGIN).send({ purpose: 'CHANGE_PHONE' });
      expect(res.status).toBe(401);
    });
  });

  it('rejects internal calls without the service secret', async () => {
    const res = await webhook(ctx, { from: tgUser(1), text: 'hi' }, { Authorization: 'Bearer wrong' });
    expect(res.status).toBe(401);
  });
});
