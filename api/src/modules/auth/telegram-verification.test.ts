import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createUser, loginAs, resetDb, TEST_PASSWORD, WEB_ORIGIN } from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
let updateId = 1;

function webhook(ctx: Ctx, message: Record<string, unknown>, secret = 'test-webhook-secret') {
  return request(ctx.app)
    .post('/api/v1/telegram/webhook')
    .set('X-Telegram-Bot-Api-Secret-Token', secret)
    .send({ update_id: updateId++, message: { message_id: updateId, chat: { id: (message.from as { id: number }).id, type: 'private' }, ...message } });
}

const tgUser = (id: number) => ({ id, first_name: 'Dara', username: `dara${id}` });
const sendStart = (ctx: Ctx, fromId: number, token: string) => webhook(ctx, { from: tgUser(fromId), text: `/start ${token}` });
const sendContact = (ctx: Ctx, fromId: number, phone: string, contactUserId = fromId) =>
  webhook(ctx, { from: tgUser(fromId), contact: { phone_number: phone, first_name: 'Dara', user_id: contactUserId } });

async function start(ctx: Ctx, body: Record<string, unknown>, agent = request.agent(ctx.app)) {
  const res = await agent.post('/api/v1/auth/telegram/start').set('Origin', WEB_ORIGIN).send(body);
  expect(res.status).toBe(200);
  const token = new URL(res.body.deepLink).searchParams.get('start')!;
  return { agent, requestId: res.body.requestId as string, token, res };
}

const lastText = (ctx: Ctx) => ctx.telegram.sent.at(-1)?.text ?? '';

describe('telegram phone verification', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
  });

  it('signs up by sharing the phone in Telegram, then setting a password', async () => {
    const { agent, requestId, token, res } = await start(ctx, { purpose: 'SIGNUP' });
    expect(res.body.deepLink).toMatch(/^https:\/\/t\.me\/CamboSupplyBot\?start=[A-Za-z0-9_-]{20,64}$/);

    await sendStart(ctx, 777, token);
    expect(JSON.stringify(ctx.telegram.sent.at(-1)?.opts)).toContain('request_contact');
    expect((await agent.get(`/api/v1/auth/telegram/${requestId}/status`)).body.status).toBe('PENDING');

    await sendContact(ctx, 777, '85512345678');
    expect(lastText(ctx)).toMatch(/Verified/);
    const status = await agent.get(`/api/v1/auth/telegram/${requestId}/status`);
    expect(status.body).toMatchObject({ status: 'VERIFIED', firstName: 'Dara', phone: '+855 •• ••• 678' });

    const done = await agent
      .post('/api/v1/auth/signup/complete')
      .set('Origin', WEB_ORIGIN)
      .send({ requestId, name: 'Dara', password: TEST_PASSWORD });
    expect(done.status).toBe(201);
    const me = await agent.get('/api/v1/auth/me');
    expect(me.body.user).toMatchObject({ phone: '+85512345678', name: 'Dara', telegramUsername: 'dara777' });
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { phone: '+85512345678' } });
    expect(user.telegramUserId).toBe(777n);
  });

  it("rejects a contact that isn't the sender's own number", async () => {
    const { agent, requestId, token } = await start(ctx, { purpose: 'SIGNUP' });
    await sendStart(ctx, 777, token);
    await sendContact(ctx, 777, '85512345678', 999);
    expect(lastText(ctx)).toMatch(/share your own phone number/);
    expect((await agent.get(`/api/v1/auth/telegram/${requestId}/status`)).body.status).toBe('PENDING');
  });

  it('rejects expired links', async () => {
    const { agent, requestId, token } = await start(ctx, { purpose: 'SIGNUP' });
    await ctx.prisma.telegramAuthRequest.update({ where: { id: requestId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await sendStart(ctx, 777, token);
    expect(lastText(ctx)).toMatch(/expired/);
    expect((await agent.get(`/api/v1/auth/telegram/${requestId}/status`)).body.status).toBe('EXPIRED');
    const done = await agent
      .post('/api/v1/auth/signup/complete')
      .set('Origin', WEB_ORIGIN)
      .send({ requestId, name: 'Dara', password: TEST_PASSWORD });
    expect(done.status).toBe(409);
    expect(done.body.error.code).toBe('TELEGRAM_NOT_VERIFIED');
  });

  it('cannot complete the same request twice', async () => {
    const { agent, requestId, token } = await start(ctx, { purpose: 'SIGNUP' });
    await sendStart(ctx, 777, token);
    await sendContact(ctx, 777, '85512345678');
    const body = { requestId, name: 'Dara', password: TEST_PASSWORD };
    expect((await agent.post('/api/v1/auth/signup/complete').set('Origin', WEB_ORIGIN).send(body)).status).toBe(201);
    expect((await agent.post('/api/v1/auth/signup/complete').set('Origin', WEB_ORIGIN).send(body)).status).toBe(409);
  });

  it('lets a reloaded page pick up its own verified request', async () => {
    const { agent, requestId, token } = await start(ctx, { purpose: 'SIGNUP' });
    await sendStart(ctx, 777, token);
    await sendContact(ctx, 777, '85512345678');
    const res = await agent.get('/api/v1/auth/telegram/current').query({ purpose: 'SIGNUP' });
    expect(res.status).toBe(200);
    expect(res.body.request).toMatchObject({ requestId, status: 'VERIFIED', firstName: 'Dara', phone: '+855 •• ••• 678' });
  });

  it("reports a request that is still waiting, but never someone else's or a finished one", async () => {
    const { agent, requestId, token } = await start(ctx, { purpose: 'SIGNUP' });
    expect((await agent.get('/api/v1/auth/telegram/current').query({ purpose: 'SIGNUP' })).body.request).toMatchObject({ requestId, status: 'PENDING' });
    expect((await agent.get('/api/v1/auth/telegram/current').query({ purpose: 'RESET' })).body.request).toBeNull();
    expect((await request.agent(ctx.app).get('/api/v1/auth/telegram/current').query({ purpose: 'SIGNUP' })).body.request).toBeNull();
    await sendStart(ctx, 777, token);
    await sendContact(ctx, 777, '85512345678');
    await agent.post('/api/v1/auth/signup/complete').set('Origin', WEB_ORIGIN).send({ requestId, name: 'Dara', password: TEST_PASSWORD });
    expect((await agent.get('/api/v1/auth/telegram/current').query({ purpose: 'SIGNUP' })).body.request).toBeNull();
  });

  it('only the browser that started the request can read or complete it', async () => {
    const { requestId, token } = await start(ctx, { purpose: 'SIGNUP' });
    await sendStart(ctx, 777, token);
    await sendContact(ctx, 777, '85512345678');
    const stranger = request.agent(ctx.app);
    expect((await stranger.get(`/api/v1/auth/telegram/${requestId}/status`)).status).toBe(404);
    const done = await stranger
      .post('/api/v1/auth/signup/complete')
      .set('Origin', WEB_ORIGIN)
      .send({ requestId, name: 'X', password: TEST_PASSWORD });
    expect(done.status).toBe(409);
  });

  it('refuses to sign up a phone that already has an account', async () => {
    await createUser(ctx.prisma, { phone: '+85512345678' });
    const { agent, requestId, token } = await start(ctx, { purpose: 'SIGNUP' });
    await sendStart(ctx, 777, token);
    await sendContact(ctx, 777, '+85512345678');
    expect(lastText(ctx)).toMatch(/already has an account/);
    const done = await agent
      .post('/api/v1/auth/signup/complete')
      .set('Origin', WEB_ORIGIN)
      .send({ requestId, name: 'Dara', password: TEST_PASSWORD });
    expect(done.status).toBe(409);
  });

  it('resets a forgotten password through the same Telegram account', async () => {
    const u = await createUser(ctx.prisma, { phone: '+85512345678', telegramUserId: 777 });
    const other = await loginAs(ctx.app, u.phone);
    const { agent, requestId, token } = await start(ctx, { purpose: 'RESET', phone: '012 345 678' });
    await sendStart(ctx, 777, token);
    await sendContact(ctx, 777, '85512345678');
    const done = await agent
      .post('/api/v1/auth/reset/complete')
      .set('Origin', WEB_ORIGIN)
      .send({ requestId, password: 'fresh-password-9' });
    expect(done.status).toBe(200);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    expect((await other.get('/api/v1/auth/me')).status).toBe(401);
    const login = (password: string) =>
      request(ctx.app).post('/api/v1/auth/login').set('Origin', WEB_ORIGIN).send({ phone: u.phone, password });
    expect((await login(TEST_PASSWORD)).status).toBe(401);
    expect((await login('fresh-password-9')).status).toBe(200);
  });

  it('does not reset when the contact comes from a different Telegram account', async () => {
    await createUser(ctx.prisma, { phone: '+85512345678', telegramUserId: 777 });
    const { agent, requestId, token } = await start(ctx, { purpose: 'RESET', phone: '+85512345678' });
    await sendStart(ctx, 888, token);
    await sendContact(ctx, 888, '85512345678');
    expect(lastText(ctx)).toMatch(/couldn't verify/);
    expect((await agent.get(`/api/v1/auth/telegram/${requestId}/status`)).body.status).toBe('PENDING');
  });

  it('answers a reset for an unknown phone exactly like a known one', async () => {
    const { res } = await start(ctx, { purpose: 'RESET', phone: '+85598765432' });
    expect(Object.keys(res.body).sort()).toEqual(['deepLink', 'expiresAt', 'requestId']);
  });

  it('changes the phone number of a signed-in user', async () => {
    const u = await createUser(ctx.prisma, { phone: '+85512345678', telegramUserId: 777 });
    const agent = await loginAs(ctx.app, u.phone);
    const { requestId, token } = await start(ctx, { purpose: 'CHANGE_PHONE' }, agent);
    await sendStart(ctx, 777, token);
    await sendContact(ctx, 777, '85587654321');
    const done = await agent.post('/api/v1/auth/me/phone/complete').set('Origin', WEB_ORIGIN).send({ requestId });
    expect(done.status).toBe(200);
    expect(done.body.user.phone).toBe('+85587654321');
  });

  it('requires a signed-in user to change phone', async () => {
    const res = await request(ctx.app).post('/api/v1/auth/telegram/start').set('Origin', WEB_ORIGIN).send({ purpose: 'CHANGE_PHONE' });
    expect(res.status).toBe(401);
  });

  it('rejects webhook calls without the secret header', async () => {
    const res = await webhook(ctx, { from: tgUser(1), text: 'hi' }, 'wrong');
    expect(res.status).toBe(401);
  });

  describe('starting in the bot', () => {
    const shareFirst = async (id = 777, phone = '85512345678') => {
      const from = { id, first_name: 'Dara', last_name: 'Sok', username: `dara${id}` };
      await webhook(ctx, { from, text: '/start' });
      await webhook(ctx, { from, contact: { phone_number: phone, first_name: 'Dara', user_id: id } });
    };
    const linkToken = () => /\/signup\?t=([A-Za-z0-9_-]+)/.exec(JSON.stringify(ctx.telegram.sent.at(-1)))?.[1] ?? '';

    it('replies to the shared number with a one-time link to set the password', async () => {
      await shareFirst();
      expect(lastText(ctx)).toMatch(/Verified/);
      expect(linkToken()).toHaveLength(43);
      const row = await ctx.prisma.telegramAuthRequest.findFirstOrThrow({ where: { telegramUserId: 777n } });
      expect(row).toMatchObject({ purpose: 'SIGNUP', status: 'VERIFIED', phone: '+85512345678', firstName: 'Dara Sok', telegramUsername: 'dara777' });
    });

    it('the website claims the link, then asks only for a password; the name comes from Telegram', async () => {
      await shareFirst();
      const agent = request.agent(ctx.app);
      const claim = await agent.post('/api/v1/auth/telegram/claim').set('Origin', WEB_ORIGIN).send({ token: linkToken() });
      expect(claim.status).toBe(200);
      expect(claim.body).toMatchObject({ status: 'VERIFIED', firstName: 'Dara Sok', phone: '+855 •• ••• 678' });
      const done = await agent.post('/api/v1/auth/signup/complete').set('Origin', WEB_ORIGIN).send({ requestId: claim.body.requestId, password: TEST_PASSWORD });
      expect(done.status).toBe(201);
      expect((await agent.get('/api/v1/auth/me')).body.user).toMatchObject({ name: 'Dara Sok', phone: '+85512345678', telegramUsername: 'dara777' });
    });

    it('a link works once, so a leaked or forwarded link cannot be claimed by someone else afterwards', async () => {
      await shareFirst();
      const token = linkToken();
      expect((await request.agent(ctx.app).post('/api/v1/auth/telegram/claim').set('Origin', WEB_ORIGIN).send({ token })).status).toBe(200);
      const second = await request.agent(ctx.app).post('/api/v1/auth/telegram/claim').set('Origin', WEB_ORIGIN).send({ token });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('TELEGRAM_NOT_VERIFIED');
    });

    it('refuses an unknown or expired link', async () => {
      await shareFirst();
      expect((await request.agent(ctx.app).post('/api/v1/auth/telegram/claim').set('Origin', WEB_ORIGIN).send({ token: 'x'.repeat(43) })).status).toBe(409);
      await ctx.prisma.telegramAuthRequest.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await request.agent(ctx.app).post('/api/v1/auth/telegram/claim').set('Origin', WEB_ORIGIN).send({ token: linkToken() })).status).toBe(409);
    });

    it('sharing again replaces the earlier link', async () => {
      await shareFirst();
      const first = linkToken();
      await sendContact(ctx, 777, '85512345678');
      expect(linkToken()).not.toBe(first);
      expect((await request.agent(ctx.app).post('/api/v1/auth/telegram/claim').set('Origin', WEB_ORIGIN).send({ token: first })).status).toBe(409);
    });

    it('tells a number that already has an account to log in, and creates nothing', async () => {
      await createUser(ctx.prisma, { phone: '+85512345678' });
      await shareFirst();
      expect(lastText(ctx)).toMatch(/already has an account/);
      expect(await ctx.prisma.telegramAuthRequest.count()).toBe(0);
    });

    it("still rejects a contact that isn't the sender's own number", async () => {
      await webhook(ctx, { from: tgUser(777), text: '/start' });
      await sendContact(ctx, 777, '85512345678', 999);
      expect(lastText(ctx)).toMatch(/share your own phone number/);
      expect(await ctx.prisma.telegramAuthRequest.count()).toBe(0);
    });

    it('signing up from the website still needs a name when Telegram gave none', async () => {
      const { agent, requestId, token } = await start(ctx, { purpose: 'SIGNUP' });
      await sendStart(ctx, 778, token);
      await sendContact(ctx, 778, '85587654321');
      const done = await agent.post('/api/v1/auth/signup/complete').set('Origin', WEB_ORIGIN).send({ requestId, password: TEST_PASSWORD });
      expect(done.status).toBe(201);
      expect((await agent.get('/api/v1/auth/me')).body.user.name).toBe('Dara');
    });
  });
});
