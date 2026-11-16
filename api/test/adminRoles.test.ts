import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDb, signedInAgent, WEB_ORIGIN } from './helpers';

describe('admin role management', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let admin: Awaited<ReturnType<typeof signedInAgent>>;
  let customer: Awaited<ReturnType<typeof signedInAgent>>;

  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
    admin = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN', name: 'Owner' });
    customer = await signedInAgent(ctx.app, ctx.prisma, { name: 'Dara' });
  });

  const setRole = (agent: Awaited<ReturnType<typeof signedInAgent>>["agent"], id: string, role: string) =>
    agent.post(`/api/v1/admin/customers/${id}/role`).set('Origin', WEB_ORIGIN).send({ role });

  it('promotes a customer, who can then use the admin', async () => {
    expect((await customer.agent.get('/api/v1/admin/stats')).status).toBe(403);
    const res = await setRole(admin.agent, customer.user.id, 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('ADMIN');
    expect((await customer.agent.get('/api/v1/admin/stats')).status).toBe(200);
  });

  it('demotes an admin back to customer, effective immediately', async () => {
    await setRole(admin.agent, customer.user.id, 'ADMIN');
    const res = await setRole(admin.agent, customer.user.id, 'CUSTOMER');
    expect(res.body.role).toBe('CUSTOMER');
    expect((await customer.agent.get('/api/v1/admin/stats')).status).toBe(403);
  });

  it("won't let an admin change their own role", async () => {
    const res = await setRole(admin.agent, admin.user.id, 'CUSTOMER');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_CHANGE_OWN_ROLE');
  });

  it('rejects unknown roles and customers calling it', async () => {
    expect((await setRole(admin.agent, customer.user.id, 'SUPERUSER')).status).toBe(400);
    expect((await setRole(customer.agent, admin.user.id, 'CUSTOMER')).status).toBe(403);
  });

  it('never removes the last admin', async () => {
    // Two admins; one demotes the other, leaving one. The survivor can't be demoted by anyone.
    await setRole(admin.agent, customer.user.id, 'ADMIN');
    await setRole(customer.agent, admin.user.id, 'CUSTOMER');
    const res = await setRole(customer.agent, customer.user.id, 'CUSTOMER');
    expect(res.status).toBe(400);
    expect(await ctx.prisma.user.count({ where: { role: 'ADMIN' } })).toBe(1);
  });
});
