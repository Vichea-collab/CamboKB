import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { unlinkTelegramByPhone } from '../../cli/unlink-telegram';
import { createTestApp, createUser, loginAs, resetDb, signedInAgent, testConfig, WEB_ORIGIN } from '../../../test/helpers';
import { KEY_HEX, signInitData } from '../../../test/telegram';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
const unlink = (agent: ReturnType<typeof request.agent>, id: string) =>
  agent.post(`/api/v1/admin/customers/${id}/unlink-telegram`).set('Origin', WEB_ORIGIN);

describe('unlinking Telegram', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
  });

  it('an admin unlinks a customer: the link is cleared, every session ends, waiting logins are cancelled', async () => {
    const { agent: admin } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN', telegramUserId: 1 });
    const customer = await createUser(ctx.prisma, { phone: '+85512345678', telegramUserId: 777, name: 'Dara' });
    await ctx.prisma.user.update({ where: { id: customer.id }, data: { telegramUsername: 'dara' } });
    const a = await loginAs(ctx.app, customer.phone);
    const b = await loginAs(ctx.app, customer.phone);
    const pending = await ctx.prisma.telegramAuthRequest.create({
      data: { tokenHash: 'p', purpose: 'LOGIN', telegramUserId: 777n, userId: customer.id, expiresAt: new Date(Date.now() + 60_000) },
    });

    const res = await unlink(admin, customer.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after).toMatchObject({ telegramUserId: null, telegramChatId: null, telegramUsername: null, name: 'Dara', phone: '+85512345678' });
    expect((await a.get('/api/v1/auth/me')).status).toBe(401);
    expect((await b.get('/api/v1/auth/me')).status).toBe(401);
    expect((await ctx.prisma.telegramAuthRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('EXPIRED');
    // They can link again by sharing their phone: another Telegram account takes the number.
    const start = await request(ctx.app).post('/api/v1/auth/telegram/start').set('Origin', WEB_ORIGIN).send({ purpose: 'LOGIN' });
    expect(start.status).toBe(200);
  });

  it('the admin screens show whether a customer is linked', async () => {
    const { agent: admin } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN', telegramUserId: 1 });
    const linked = await createUser(ctx.prisma, { telegramUserId: 777, name: 'Linked' });
    const unlinked = await createUser(ctx.prisma, { name: 'Unlinked' });
    const list = await admin.get('/api/v1/admin/customers');
    const flags = Object.fromEntries(list.body.items.map((c: { name: string; telegramLinked: boolean }) => [c.name, c.telegramLinked]));
    expect(flags).toMatchObject({ Linked: true, Unlinked: false });
    expect((await admin.get(`/api/v1/admin/customers/${linked.id}`)).body.telegramLinked).toBe(true);
    expect((await admin.get(`/api/v1/admin/customers/${unlinked.id}`)).body.telegramLinked).toBe(false);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash/);
  });

  it('only admins may unlink, never yourself, and an unknown customer is 404', async () => {
    const { agent: customer, user } = await signedInAgent(ctx.app, ctx.prisma, { telegramUserId: 777 });
    const other = await createUser(ctx.prisma, { telegramUserId: 778 });
    expect((await unlink(customer, other.id)).status).toBe(403);
    expect((await unlink(customer, user.id)).status).toBe(403);
    expect((await unlink(request.agent(ctx.app), other.id)).status).toBe(401);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: other.id } })).telegramUserId).toBe(778n);

    const { agent: admin, user: adminUser } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN', telegramUserId: 1 });
    const self = await unlink(admin, adminUser.id);
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('CANNOT_UNLINK_SELF');
    expect((await unlink(admin, '7f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b11')).status).toBe(404);
  });

  it('an admin can unlink another admin (recovery for a second admin), and that admin is logged out', async () => {
    const { agent: admin } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN', telegramUserId: 1 });
    const other = await createUser(ctx.prisma, { role: 'ADMIN', telegramUserId: 2 });
    const otherAgent = await loginAs(ctx.app, other.phone);
    expect((await unlink(admin, other.id)).status).toBe(200);
    expect((await otherAgent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('a Mini App signature of the unlinked Telegram account no longer logs in', async () => {
    const BOT = KEY_HEX;
    const app = await createTestApp({ config: testConfig({ telegram: { botUsername: 'CamboSupplyBot', webAppKey: BOT } }) });
    const { agent: admin } = await signedInAgent(app.app, app.prisma, { role: 'ADMIN', telegramUserId: 1 });
    const customer = await createUser(app.prisma, { telegramUserId: 777 });
    await unlink(admin, customer.id);
    const res = await request(app.app).post('/api/v1/auth/telegram/webapp').set('Origin', WEB_ORIGIN).send({
      initData: signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 777 }) }, BOT),
    });
    expect(res.body.error.code).toBe('TELEGRAM_NOT_LINKED');
  });

  describe('admin:unlink-telegram (run over SSH by the owner)', () => {
    it('unlinks by phone in any format, logs the account out everywhere, and keeps the role', async () => {
      const owner = await createUser(ctx.prisma, { role: 'ADMIN', phone: '+85512345678', telegramUserId: 777 });
      const session = await loginAs(ctx.app, owner.phone);
      const done = await unlinkTelegramByPhone(ctx.prisma, '012 345 678');
      expect(done).toMatchObject({ id: owner.id, role: 'ADMIN', telegramUserId: null });
      expect((await session.get('/api/v1/auth/me')).status).toBe(401);
      expect(await ctx.prisma.session.count({ where: { userId: owner.id, revokedAt: null } })).toBe(0);
    });

    it('says what is wrong for a bad number, an unknown account, or an account with no link', async () => {
      await createUser(ctx.prisma, { phone: '+85512345678' });
      await expect(unlinkTelegramByPhone(ctx.prisma, 'abc')).rejects.toThrow(/Invalid phone/);
      await expect(unlinkTelegramByPhone(ctx.prisma, '+85599999999')).rejects.toThrow(/No user/);
      await expect(unlinkTelegramByPhone(ctx.prisma, '+85512345678')).rejects.toThrow(/no Telegram account linked/);
    });

    it('the owner links again through the normal flow with a new Telegram account', async () => {
      const owner = await createUser(ctx.prisma, { role: 'ADMIN', phone: '+85512345678', telegramUserId: 777 });
      await unlinkTelegramByPhone(ctx.prisma, '+85512345678');
      const start = await request(ctx.app).post('/api/v1/auth/telegram/start').set('Origin', WEB_ORIGIN).send({ purpose: 'LOGIN' });
      const token = new URL(start.body.deepLink).searchParams.get('start')!;
      const say = (message: object) =>
        request(ctx.app).post('/internal/telegram/updates').set({ Authorization: 'Bearer test-internal-secret-0123456789abcdef' }).send({
          update: { update_id: 1, message: { message_id: 1, chat: { id: 888, type: 'private' }, from: { id: 888, first_name: 'Owner' }, ...message } },
        });
      await say({ text: `/start ${token}` });
      await say({ contact: { phone_number: '+85512345678', user_id: 888 } });
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).telegramUserId).toBe(888n);
    });
  });

  describe('admin create customer', () => {
    it('takes no password: the customer links Telegram themselves', async () => {
      const { agent: admin } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN', telegramUserId: 1 });
      const res = await admin.post('/api/v1/admin/customers').set('Origin', WEB_ORIGIN).send({ name: 'Sok', phone: '012 999 111', password: 'ignored-1234' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Sok', phone: '+85512999111', telegramLinked: false });
      const row = await ctx.prisma.user.findUniqueOrThrow({ where: { phone: '+85512999111' } });
      expect(row.passwordHash).toBeNull();
    });
  });
});
