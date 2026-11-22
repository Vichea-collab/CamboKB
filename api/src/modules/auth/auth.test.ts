import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createUser, loginAs, resetDb, sessionCookieFor, testConfig, WEB_ORIGIN } from '../../../test/helpers';

const post = (app: Parameters<typeof request>[0], path: string) =>
  request(app).post(path).set('Origin', WEB_ORIGIN);

describe('sessions', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
  });

  it('returns the current user without secrets, or 401 when signed out', async () => {
    const u = await createUser(ctx.prisma);
    const agent = await loginAs(ctx.app, u.phone);
    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: u.id, phone: u.phone, role: 'CUSTOMER' });
    expect(me.body.user.passwordHash).toBeUndefined();
    expect((await request(ctx.app).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('answers "who am I" with 200 even when signed out, so guests do not see an error', async () => {
    const guest = await request(ctx.app).get('/api/v1/auth/session');
    expect(guest.status).toBe(200);
    expect(guest.body).toEqual({ user: null });

    const u = await createUser(ctx.prisma);
    const agent = await loginAs(ctx.app, u.phone);
    const signedIn = await agent.get('/api/v1/auth/session');
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user).toMatchObject({ id: u.id, phone: u.phone });

    await agent.post('/api/v1/auth/logout').set('Origin', WEB_ORIGIN);
    expect((await agent.get('/api/v1/auth/session')).body).toEqual({ user: null });
  });

  it('logs out', async () => {
    const u = await createUser(ctx.prisma);
    const agent = await loginAs(ctx.app, u.phone);
    expect((await agent.post('/api/v1/auth/logout').set('Origin', WEB_ORIGIN)).status).toBe(204);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('logout-all revokes every session', async () => {
    const u = await createUser(ctx.prisma);
    const a = await loginAs(ctx.app, u.phone);
    const b = await loginAs(ctx.app, u.phone);
    expect((await a.post('/api/v1/auth/logout-all').set('Origin', WEB_ORIGIN)).status).toBe(204);
    expect((await a.get('/api/v1/auth/me')).status).toBe(401);
    expect((await b.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('blocks existing sessions of a disabled user', async () => {
    const u = await createUser(ctx.prisma);
    const a = await loginAs(ctx.app, u.phone);
    await ctx.prisma.user.update({ where: { id: u.id }, data: { disabledAt: new Date() } });
    expect((await a.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('rejects expired sessions', async () => {
    const u = await createUser(ctx.prisma);
    const a = await loginAs(ctx.app, u.phone);
    await ctx.prisma.session.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await a.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('a customer session slides forward at most once a day', async () => {
    const u = await createUser(ctx.prisma);
    const a = await loginAs(ctx.app, u.phone);
    const stale = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await ctx.prisma.session.updateMany({ where: { userId: u.id }, data: { extendedAt: stale, expiresAt: new Date(Date.now() + 60_000) } });
    const res = await a.get('/api/v1/auth/me');
    expect(res.status).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(/cs_session=/);
    const s = await ctx.prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    expect(s.expiresAt.getTime()).toBeGreaterThan(Date.now() + 25 * 24 * 60 * 60 * 1000);
  });

  it('forbids customers from admin routes and lets admins through', async () => {
    const c = await createUser(ctx.prisma);
    const customer = await loginAs(ctx.app, c.phone);
    expect((await customer.get('/api/v1/admin/stats')).status).toBe(403);
    expect((await request(ctx.app).get('/api/v1/admin/stats')).status).toBe(401);
    const a = await createUser(ctx.prisma, { role: 'ADMIN' });
    const admin = await loginAs(ctx.app, a.phone);
    expect((await admin.get('/api/v1/admin/stats')).status).not.toBe(403);
  });

  describe('admin sessions are shorter', () => {
    it('last one day by default, and never slide forward', async () => {
      const a = await createUser(ctx.prisma, { role: 'ADMIN' });
      const agent = await loginAs(ctx.app, a.phone);
      const s = await ctx.prisma.session.findFirstOrThrow({ where: { userId: a.id } });
      const hours = (s.expiresAt.getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(23);
      expect(hours).toBeLessThanOrEqual(24);
      await ctx.prisma.session.update({ where: { id: s.id }, data: { extendedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } });
      const res = await agent.get('/api/v1/auth/me');
      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect((await ctx.prisma.session.findUniqueOrThrow({ where: { id: s.id } })).expiresAt.getTime()).toBe(s.expiresAt.getTime());
    });

    it('end one day after login even when the stored expiry is further away (an older, longer session)', async () => {
      const a = await createUser(ctx.prisma, { role: 'ADMIN' });
      const agent = await loginAs(ctx.app, a.phone);
      await ctx.prisma.session.updateMany({
        where: { userId: a.id },
        data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000), expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000) },
      });
      expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    });

    it('follow ADMIN_SESSION_TTL_DAYS, and a promoted customer is cut to the admin length too', async () => {
      const three = await createTestApp({ config: testConfig({ adminSessionTtlDays: 3 }) });
      const a = await createUser(three.prisma, { role: 'ADMIN' });
      const cookie = await sessionCookieFor(a.phone);
      const agent = request.agent(three.app).set('Cookie', cookie);
      await three.prisma.session.updateMany({ where: { userId: a.id }, data: { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } });
      expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
      await three.prisma.session.updateMany({ where: { userId: a.id }, data: { createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) } });
      expect((await agent.get('/api/v1/auth/me')).status).toBe(401);

      const c = await createUser(ctx.prisma);
      const customer = await loginAs(ctx.app, c.phone);
      await ctx.prisma.session.updateMany({ where: { userId: c.id }, data: { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } });
      expect((await customer.get('/api/v1/auth/me')).status).toBe(200);
      await ctx.prisma.user.update({ where: { id: c.id }, data: { role: 'ADMIN' } });
      expect((await customer.get('/api/v1/auth/me')).status).toBe(401);
    });
  });

  it('the password routes are gone', async () => {
    const u = await createUser(ctx.prisma);
    const agent = await loginAs(ctx.app, u.phone);
    for (const path of ['login', 'reset/complete', 'change-password', 'signup/complete']) {
      expect((await post(ctx.app, `/api/v1/auth/${path}`).send({ phone: u.phone, password: 'x' })).status).toBe(404);
      expect((await agent.post(`/api/v1/auth/${path}`).set('Origin', WEB_ORIGIN).send({})).status).toBe(404);
    }
  });
});
