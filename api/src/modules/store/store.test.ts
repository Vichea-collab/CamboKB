import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDb, signedInAgent, WEB_ORIGIN } from '../../../test/helpers';

describe('store information', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
  });

  it('is public and includes the delivery rates the policy pages quote', async () => {
    const res = await request(ctx.app).get('/api/v1/store');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      storeName: 'Cambo Supply', // the database column default, which a new install gets until it is renamed in Admin
      info: { phone: '', telegram: '', facebook: '', address: '', hours: '', warranty: '' },
      delivery: { provinceFeeCents: 200, phnomPenhStandardFeeCents: 150, grabBeyondFeeCents: 250 },
    });
    expect(res.body.delivery.grabTiers).toEqual([{ maxKm: 3, feeCents: 150 }, { maxKm: 5, feeCents: 200 }]);
    expect(res.body.delivery.store).toBeUndefined(); // exact store location stays private
    expect(res.headers['cache-control']).toMatch(/max-age/);
  });

  it('lets an admin edit contact details and warranty text', async () => {
    const { agent } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' });
    const current = await agent.get('/api/v1/admin/settings');
    expect(current.body.info.phone).toBe('');
    const res = await agent
      .put('/api/v1/admin/settings')
      .set('Origin', WEB_ORIGIN)
      .send({ ...current.body, info: { phone: '087 522 210', telegram: 'Cambo_KB_Bot', facebook: 'https://facebook.com/cambokb', address: 'Phnom Penh', hours: 'Daily 8:00-20:00', warranty: 'Keyboards: 7 days for defects.' } });
    expect(res.status).toBe(200);
    expect(res.body.info.phone).toBe('087 522 210');
    const pub = await request(ctx.app).get('/api/v1/store');
    expect(pub.body.info).toMatchObject({ telegram: 'Cambo_KB_Bot', hours: 'Daily 8:00-20:00', warranty: 'Keyboards: 7 days for defects.' });
  });

  it('rejects unsafe links and oversized text', async () => {
    const { agent } = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' });
    const current = (await agent.get('/api/v1/admin/settings')).body;
    const put = (info: object) => agent.put('/api/v1/admin/settings').set('Origin', WEB_ORIGIN).send({ ...current, info: { ...current.info, ...info } });
    expect((await put({ facebook: 'javascript:alert(1)' })).status).toBe(400);
    expect((await put({ telegram: 'not a username!' })).status).toBe(400);
    expect((await put({ warranty: 'x'.repeat(4001) })).status).toBe(400);
  });
});
