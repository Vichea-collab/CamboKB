import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createUser, resetDb, testConfig, WEB_ORIGIN } from '../../../test/helpers';
import { verifyWebAppInitData } from './telegram-webapp';

import { KEY_HEX, signInitData } from '../../../test/telegram';
const fieldsFor = (id: number, over: Record<string, string> = {}) => ({
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: 'AAH-test',
  user: JSON.stringify({ id, first_name: 'Dara', username: `dara${id}` }),
  signature: 'sig-not-checked-by-us',
  ...over,
});

describe('verifyWebAppInitData', () => {
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);

  it('accepts a genuine signature and returns who it names', () => {
    const who = verifyWebAppInitData(signInitData(fieldsFor(777)), KEY_HEX, now);
    expect(who).toMatchObject({ telegramUserId: 777, authDate: nowSec });
    expect(who?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a wrong hash, a missing hash, or a signature made with another key', () => {
    const good = signInitData(fieldsFor(777));
    expect(verifyWebAppInitData(good.replace(/hash=[0-9a-f]/, (m) => m + (m.endsWith('a') ? 'b' : 'a')), KEY_HEX, now)).toBeNull();
    expect(verifyWebAppInitData(good.replace(/&?hash=[0-9a-f]+/, ''), KEY_HEX, now)).toBeNull();
    expect(verifyWebAppInitData(good, 'ab'.repeat(32), now)).toBeNull();
    expect(verifyWebAppInitData('hash=zz&auth_date=1', KEY_HEX, now)).toBeNull();
  });

  it('rejects an edited field (another user id)', () => {
    const forged = new URLSearchParams(signInitData(fieldsFor(777)));
    forged.set('user', JSON.stringify({ id: 1, first_name: 'Owner' }));
    expect(verifyWebAppInitData(forged.toString(), KEY_HEX, now)).toBeNull();
  });

  it('rejects a field that is sent twice', () => {
    expect(verifyWebAppInitData(`${signInitData(fieldsFor(777))}&user=%7B%22id%22%3A1%7D`, KEY_HEX, now)).toBeNull();
  });

  it('rejects auth_date older than 5 minutes or more than 30 seconds in the future, accepts the edges', () => {
    const at = (offsetSec: number) => signInitData(fieldsFor(777, { auth_date: String(nowSec + offsetSec) }));
    expect(verifyWebAppInitData(at(-299), KEY_HEX, now)).not.toBeNull();
    expect(verifyWebAppInitData(at(-301), KEY_HEX, now)).toBeNull();
    expect(verifyWebAppInitData(at(29), KEY_HEX, now)).not.toBeNull();
    expect(verifyWebAppInitData(at(31), KEY_HEX, now)).toBeNull();
    expect(verifyWebAppInitData(signInitData(fieldsFor(777, { auth_date: 'soon' })), KEY_HEX, now)).toBeNull();
  });

  it('rejects data with no usable user', () => {
    const { user: _user, ...noUser } = fieldsFor(777);
    expect(verifyWebAppInitData(signInitData(noUser), KEY_HEX, now)).toBeNull();
    expect(verifyWebAppInitData(signInitData(fieldsFor(777, { user: 'not json' })), KEY_HEX, now)).toBeNull();
    expect(verifyWebAppInitData(signInitData(fieldsFor(777, { user: JSON.stringify({ id: '777' }) })), KEY_HEX, now)).toBeNull();
  });
});

describe('POST /auth/telegram/webapp (store opened inside Telegram)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const open = (initData: string, app = ctx.app) =>
    request.agent(app).post('/api/v1/auth/telegram/webapp').set('Origin', WEB_ORIGIN).send({ initData });
  const withKey = (over = {}) => testConfig({ telegram: { botUsername: 'CamboSupplyBot', webAppKey: KEY_HEX, ...over } });

  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp({ config: withKey() });
  });

  it('logs in the account linked to the Telegram user, with a session cookie', async () => {
    const user = await createUser(ctx.prisma, { telegramUserId: 777, phone: '+85512345678' });
    const agent = request.agent(ctx.app);
    const res = await agent.post('/api/v1/auth/telegram/webapp').set('Origin', WEB_ORIGIN).send({ initData: signInitData(fieldsFor(777)) });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, phone: '+85512345678' });
    expect(String(res.headers['set-cookie'])).toMatch(/cs_session=.*HttpOnly/);
    expect((await agent.get('/api/v1/auth/me')).body.user.id).toBe(user.id);
  });

  it('accepts each signature once: a replay of the same initData is refused', async () => {
    await createUser(ctx.prisma, { telegramUserId: 777 });
    const initData = signInitData(fieldsFor(777));
    expect((await open(initData)).status).toBe(200);
    const again = await open(initData);
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('TELEGRAM_INITDATA_INVALID');
    // A fresh signature (new auth_date) for the same person is fine.
    expect((await open(signInitData(fieldsFor(777, { auth_date: String(Math.floor(Date.now() / 1000) + 1) })))).status).toBe(200);
  });

  it('refuses a wrong hash, an edited user id and stale data', async () => {
    await createUser(ctx.prisma, { telegramUserId: 777 });
    await createUser(ctx.prisma, { telegramUserId: 1, role: 'ADMIN' });
    const edited = new URLSearchParams(signInitData(fieldsFor(777)));
    edited.set('user', JSON.stringify({ id: 1 }));
    for (const initData of [
      edited.toString(),
      signInitData(fieldsFor(777), 'cd'.repeat(32)),
      signInitData(fieldsFor(777, { auth_date: String(Math.floor(Date.now() / 1000) - 600) })),
      signInitData(fieldsFor(777, { auth_date: String(Math.floor(Date.now() / 1000) + 120) })),
    ]) {
      const res = await open(initData);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TELEGRAM_INITDATA_INVALID');
    }
    expect(await ctx.prisma.session.count()).toBe(0);
  });

  it('answers TELEGRAM_NOT_LINKED for a signature with no account (so the web falls back to the deep link), and does not use up the signature', async () => {
    const initData = signInitData(fieldsFor(555));
    const res = await open(initData);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TELEGRAM_NOT_LINKED');
    expect(await ctx.prisma.telegramWebAppHash.count()).toBe(0);
    expect(await ctx.prisma.user.count()).toBe(0); // it never creates an account
  });

  it('does not log in a disabled account', async () => {
    const u = await createUser(ctx.prisma, { telegramUserId: 777 });
    await ctx.prisma.user.update({ where: { id: u.id }, data: { disabledAt: new Date() } });
    const res = await open(signInitData(fieldsFor(777)));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TELEGRAM_NOT_LINKED');
  });

  it('gives an admin the same login, with the shorter session and no extra rights from the role', async () => {
    const admin = await createUser(ctx.prisma, { telegramUserId: 777, role: 'ADMIN' });
    const agent = request.agent(ctx.app);
    expect((await agent.post('/api/v1/auth/telegram/webapp').set('Origin', WEB_ORIGIN).send({ initData: signInitData(fieldsFor(777)) })).status).toBe(200);
    const s = await ctx.prisma.session.findFirstOrThrow({ where: { userId: admin.id } });
    expect(s.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    // An admin with no Telegram link cannot get in this way at all.
    await createUser(ctx.prisma, { role: 'ADMIN', phone: '+85512000099' });
    expect((await open(signInitData(fieldsFor(4242)))).body.error.code).toBe('TELEGRAM_NOT_LINKED');
  });

  it('is unavailable (503) when the server has no key, and never trusts the data then', async () => {
    const off = await createTestApp({ config: testConfig() });
    await createUser(off.prisma, { telegramUserId: 777 });
    const res = await open(signInitData(fieldsFor(777)), off.app);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('TELEGRAM_WEBAPP_NOT_CONFIGURED');
  });

  it('forgets old signatures when a new one is accepted', async () => {
    await createUser(ctx.prisma, { telegramUserId: 777 });
    await ctx.prisma.telegramWebAppHash.create({ data: { hash: 'a'.repeat(64), expiresAt: new Date(Date.now() - 1000) } });
    expect((await open(signInitData(fieldsFor(777)))).status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(await ctx.prisma.telegramWebAppHash.count({ where: { hash: 'a'.repeat(64) } })).toBe(0);
  });

  it('rejects a body with no initData', async () => {
    const res = await request(ctx.app).post('/api/v1/auth/telegram/webapp').set('Origin', WEB_ORIGIN).send({});
    expect(res.status).toBe(400);
  });
});
