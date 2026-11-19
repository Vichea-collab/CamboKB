import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createUser, loginAs, resetDb, TEST_PASSWORD, testConfig, WEB_ORIGIN } from '../../../test/helpers';

const post = (app: Parameters<typeof request>[0], path: string) =>
  request(app).post(path).set('Origin', WEB_ORIGIN);

describe('phone + password auth', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
  });

  it('logs in with a local-format phone and sets a hardened session cookie', async () => {
    await createUser(ctx.prisma, { phone: '+85512345678' });
    const res = await post(ctx.app, '/api/v1/auth/login').send({ phone: '012 345 678', password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.phone).toBe('+85512345678');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/cs_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('gives the same error for a wrong password and an unknown phone', async () => {
    const u = await createUser(ctx.prisma);
    const wrong = await post(ctx.app, '/api/v1/auth/login').send({ phone: u.phone, password: 'not-the-password' });
    const unknown = await post(ctx.app, '/api/v1/auth/login').send({ phone: '+85599999999', password: TEST_PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
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
    expect(signedIn.body.user.passwordHash).toBeUndefined();

    await agent.post('/api/v1/auth/logout').set('Origin', WEB_ORIGIN);
    expect((await agent.get('/api/v1/auth/session')).body).toEqual({ user: null });
  });

  it('logs out', async () => {
    const u = await createUser(ctx.prisma);
    const agent = await loginAs(ctx.app, u.phone);
    expect((await agent.post('/api/v1/auth/logout').set('Origin', WEB_ORIGIN)).status).toBe(204);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('changing the password revokes other sessions but keeps the current one', async () => {
    const u = await createUser(ctx.prisma);
    const a = await loginAs(ctx.app, u.phone);
    const b = await loginAs(ctx.app, u.phone);
    const res = await a
      .post('/api/v1/auth/change-password')
      .set('Origin', WEB_ORIGIN)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'brand-new-pass-1' });
    expect(res.status).toBe(204);
    expect((await a.get('/api/v1/auth/me')).status).toBe(200);
    expect((await b.get('/api/v1/auth/me')).status).toBe(401);
    expect((await post(ctx.app, '/api/v1/auth/login').send({ phone: u.phone, password: 'brand-new-pass-1' })).status).toBe(200);
  });

  it('rejects change-password with a wrong current password', async () => {
    const u = await createUser(ctx.prisma);
    const a = await loginAs(ctx.app, u.phone);
    const res = await a
      .post('/api/v1/auth/change-password')
      .set('Origin', WEB_ORIGIN)
      .send({ currentPassword: 'wrong-wrong', newPassword: 'brand-new-pass-1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('logout-all revokes every session', async () => {
    const u = await createUser(ctx.prisma);
    const a = await loginAs(ctx.app, u.phone);
    const b = await loginAs(ctx.app, u.phone);
    expect((await a.post('/api/v1/auth/logout-all').set('Origin', WEB_ORIGIN)).status).toBe(204);
    expect((await a.get('/api/v1/auth/me')).status).toBe(401);
    expect((await b.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('blocks disabled users from logging in and from existing sessions', async () => {
    const u = await createUser(ctx.prisma);
    const a = await loginAs(ctx.app, u.phone);
    await ctx.prisma.user.update({ where: { id: u.id }, data: { disabledAt: new Date() } });
    expect((await a.get('/api/v1/auth/me')).status).toBe(401);
    expect((await post(ctx.app, '/api/v1/auth/login').send({ phone: u.phone, password: TEST_PASSWORD })).status).toBe(401);
  });

  it('rejects expired sessions', async () => {
    const u = await createUser(ctx.prisma);
    const a = await loginAs(ctx.app, u.phone);
    await ctx.prisma.session.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await a.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('rate limits repeated failed logins', async () => {
    const limited = await createTestApp({ config: testConfig({ rateLimit: { loginMax: 10, windowMs: 60_000 } }) });
    const u = await createUser(limited.prisma);
    for (let i = 0; i < 10; i++) {
      await post(limited.app, '/api/v1/auth/login').send({ phone: u.phone, password: 'nope-nope' });
    }
    const res = await post(limited.app, '/api/v1/auth/login').send({ phone: u.phone, password: 'nope-nope' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
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
});
