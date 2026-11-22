import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BotAction } from '@cambo/shared';
import {
  createTestApp,
  createUser,
  INTERNAL_AUTH,
  loginAs,
  resetDb,
  testConfig,
  WEB_ORIGIN,
} from '../../../test/helpers';
import { KEY_HEX, signInitData } from '../../../test/telegram';
import { unlinkTelegram } from './unlink';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
let updateId = 1000;
let said: BotAction[] = [];

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
const tap = (ctx: Ctx, requestId: string, decision: 'y' | 'n', fromId: number, auth = INTERNAL_AUTH) =>
  request(ctx.app).post('/internal/telegram/login-confirm').set(auth).send({ requestId, telegramUserId: fromId, decision });

const fieldsFor = (id: number, over: Record<string, string> = {}) => ({
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: 'AAH-test',
  user: JSON.stringify({ id, first_name: 'Dara', username: `dara${id}` }),
  signature: 'sig-placeholder',
  ...over,
});

async function startLogin(ctx: Ctx, agent = request.agent(ctx.app)) {
  const res = await agent.post('/api/v1/auth/telegram/start').set('Origin', WEB_ORIGIN).send({ purpose: 'LOGIN' });
  expect(res.status).toBe(200);
  const token = new URL(res.body.deepLink).searchParams.get('start')!;
  return { agent, requestId: res.body.requestId as string, token, res };
}

const complete = (agent: ReturnType<typeof request.agent>, requestId: string) =>
  agent.post('/api/v1/auth/login/complete').set('Origin', WEB_ORIGIN).send({ requestId });
const lastText = () => said.at(-1)?.text ?? '';

describe('Reviewer Angela — Telegram-only login checklist', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp({
      config: testConfig({
        telegram: { botUsername: 'CamboSupplyBot', webAppKey: KEY_HEX },
      }),
    });
    said = [];
  });

  describe('1. initData', () => {
    it('valid initData passes and logs in user', async () => {
      const u = await createUser(ctx.prisma, { telegramUserId: 12345, phone: '+85512111222' });
      const agent = request.agent(ctx.app);
      const res = await agent
        .post('/api/v1/auth/telegram/webapp')
        .set('Origin', WEB_ORIGIN)
        .send({ initData: signInitData(fieldsFor(12345)) });
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(u.id);
      expect((await agent.get('/api/v1/auth/me')).body.user.id).toBe(u.id);
    });

    it('wrong hash fails', async () => {
      await createUser(ctx.prisma, { telegramUserId: 12345 });
      const good = signInitData(fieldsFor(12345));
      const bad = good.replace(/hash=[0-9a-f]{2}/, 'hash=00');
      const res = await request(ctx.app)
        .post('/api/v1/auth/telegram/webapp')
        .set('Origin', WEB_ORIGIN)
        .send({ initData: bad });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TELEGRAM_INITDATA_INVALID');
    });

    it('edited field fails', async () => {
      await createUser(ctx.prisma, { telegramUserId: 12345 });
      const forged = new URLSearchParams(signInitData(fieldsFor(12345)));
      forged.set('user', JSON.stringify({ id: 99999, first_name: 'Attacker' }));
      const res = await request(ctx.app)
        .post('/api/v1/auth/telegram/webapp')
        .set('Origin', WEB_ORIGIN)
        .send({ initData: forged.toString() });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TELEGRAM_INITDATA_INVALID');
    });

    it('auth_date older than 5 min or in future (>30s) fails', async () => {
      await createUser(ctx.prisma, { telegramUserId: 12345 });
      const nowSec = Math.floor(Date.now() / 1000);
      const stale = signInitData(fieldsFor(12345, { auth_date: String(nowSec - 305) }));
      const resStale = await request(ctx.app)
        .post('/api/v1/auth/telegram/webapp')
        .set('Origin', WEB_ORIGIN)
        .send({ initData: stale });
      expect(resStale.status).toBe(401);
      expect(resStale.body.error.code).toBe('TELEGRAM_INITDATA_INVALID');

      const future = signInitData(fieldsFor(12345, { auth_date: String(nowSec + 60) }));
      const resFuture = await request(ctx.app)
        .post('/api/v1/auth/telegram/webapp')
        .set('Origin', WEB_ORIGIN)
        .send({ initData: future });
      expect(resFuture.status).toBe(401);
      expect(resFuture.body.error.code).toBe('TELEGRAM_INITDATA_INVALID');
    });

    it('reused hash fails', async () => {
      await createUser(ctx.prisma, { telegramUserId: 12345 });
      const initData = signInitData(fieldsFor(12345));
      const res1 = await request(ctx.app)
        .post('/api/v1/auth/telegram/webapp')
        .set('Origin', WEB_ORIGIN)
        .send({ initData });
      expect(res1.status).toBe(200);

      const res2 = await request(ctx.app)
        .post('/api/v1/auth/telegram/webapp')
        .set('Origin', WEB_ORIGIN)
        .send({ initData });
      expect(res2.status).toBe(401);
      expect(res2.body.error.code).toBe('TELEGRAM_INITDATA_INVALID');
    });
  });

  describe('2. deep link', () => {
    it('expired token fails', async () => {
      await createUser(ctx.prisma, { telegramUserId: 12345 });
      const { agent, requestId, token } = await startLogin(ctx);
      await ctx.prisma.telegramAuthRequest.update({
        where: { id: requestId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await sendStart(ctx, 12345, token);
      expect(lastText()).toMatch(/expired/);
      expect((await complete(agent, requestId)).status).toBe(409);
    });

    it('used twice fails', async () => {
      await createUser(ctx.prisma, { telegramUserId: 12345 });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 12345, token);
      await tap(ctx, requestId, 'y', 12345);
      expect((await complete(agent, requestId)).status).toBe(200);

      const again = await complete(agent, requestId);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('TELEGRAM_NOT_VERIFIED');
    });

    it('confirm from a different Telegram id is rejected', async () => {
      await createUser(ctx.prisma, { telegramUserId: 12345 });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 12345, token);
      const res = await tap(ctx, requestId, 'y', 99999);
      expect(res.body.outcome).toBe('not_yours');
      expect((await complete(agent, requestId)).status).toBe(409);
    });

    it('"Not me" declines and expires request', async () => {
      await createUser(ctx.prisma, { telegramUserId: 12345 });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 12345, token);
      const res = await tap(ctx, requestId, 'n', 12345);
      expect(res.body.outcome).toBe('declined');
      expect((await complete(agent, requestId)).status).toBe(409);
    });

    it('complete without cs_tg_req cookie fails', async () => {
      await createUser(ctx.prisma, { telegramUserId: 12345 });
      const { requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 12345, token);
      await tap(ctx, requestId, 'y', 12345);

      const stranger = request.agent(ctx.app);
      const res = await complete(stranger, requestId);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('TELEGRAM_NOT_VERIFIED');
    });

    it('disabled user fails', async () => {
      const u = await createUser(ctx.prisma, { telegramUserId: 12345 });
      await ctx.prisma.user.update({ where: { id: u.id }, data: { disabledAt: new Date() } });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 12345, token);
      expect(lastText()).toMatch(/couldn't verify/);
      expect((await complete(agent, requestId)).status).toBe(409);
    });

    it('admin gets no bypass: requires bot confirmation and gets 1-day session', async () => {
      const admin = await createUser(ctx.prisma, { role: 'ADMIN', telegramUserId: 12345 });
      const { agent, requestId, token } = await startLogin(ctx);
      expect((await complete(agent, requestId)).status).toBe(409);

      await sendStart(ctx, 12345, token);
      expect((await complete(agent, requestId)).status).toBe(409);

      await tap(ctx, requestId, 'y', 12345);
      const res = await complete(agent, requestId);
      expect(res.status).toBe(200);

      const s = await ctx.prisma.session.findFirstOrThrow({ where: { userId: admin.id } });
      const durationHours = (s.expiresAt.getTime() - Date.now()) / (3600 * 1000);
      expect(durationHours).toBeGreaterThan(23);
      expect(durationHours).toBeLessThanOrEqual(24);
    });
  });

  describe('3. linking', () => {
    it('unlinked phone links on contact share', async () => {
      const user = await createUser(ctx.prisma, { phone: '+85512999888', name: 'Unlinked' });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 12345, token);
      await sendContact(ctx, 12345, '85512999888');
      expect((await complete(agent, requestId)).status).toBe(200);

      const updated = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(updated.telegramUserId).toBe(12345n);
    });

    it('phone linked to another Telegram id is refused', async () => {
      await createUser(ctx.prisma, { phone: '+85512999888', telegramUserId: 99999 });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 12345, token);
      await sendContact(ctx, 12345, '85512999888');
      expect(lastText()).toMatch(/contact the shop/);
      expect((await complete(agent, requestId)).status).toBe(409);
    });

    it('forwarded contact is refused', async () => {
      await createUser(ctx.prisma, { phone: '+85512999888' });
      const { agent, requestId, token } = await startLogin(ctx);
      await sendStart(ctx, 12345, token);
      await sendContact(ctx, 12345, '85512999888', 88888);
      expect(lastText()).toMatch(/share your own phone number/);
      expect((await complete(agent, requestId)).status).toBe(409);
    });
  });

  describe('4. unlink', () => {
    it('unlink ends sessions', async () => {
      const u = await createUser(ctx.prisma, { phone: '+85512333444', telegramUserId: 12345 });
      const customerAgent = await loginAs(ctx.app, u.phone);
      expect((await customerAgent.get('/api/v1/auth/me')).status).toBe(200);

      await unlinkTelegram(ctx.prisma, u.id);
      expect((await customerAgent.get('/api/v1/auth/me')).status).toBe(401);
      expect(await ctx.prisma.session.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
    });
  });

  describe('5. old routes answer 404', () => {
    it('/login, /reset/complete, /change-password answer 404', async () => {
      const u = await createUser(ctx.prisma);
      for (const route of ['login', 'reset/complete', 'change-password']) {
        const res = await request(ctx.app)
          .post(`/api/v1/auth/${route}`)
          .set('Origin', WEB_ORIGIN)
          .send({ phone: u.phone, password: 'password123' });
        expect(res.status).toBe(404);
      }
    });
  });
});
