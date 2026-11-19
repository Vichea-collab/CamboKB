import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createProduct,
  createTestApp,
  INTERNAL_AUTH,
  resetDb,
  signedInAgent,
  WEB_ORIGIN,
} from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

describe('internal routes for the notification service', () => {
  let ctx: Ctx;
  let orderId: string;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
    const customer = await signedInAgent(ctx.app, ctx.prisma, {
      name: 'Dara',
      telegramUserId: 7001,
    });
    const product = await createProduct(ctx.prisma, { priceCents: 600, stock: 10 });
    const res = await customer.agent
      .post('/api/v1/orders')
      .set('Origin', WEB_ORIGIN)
      .send({
        items: [{ productId: product.id, quantity: 1 }],
        region: 'PHNOM_PENH',
        deliveryService: 'VET',
        contactName: 'Dara',
        contactPhone: '012345678',
        addressLine: 'A',
        paymentMethod: 'COD',
      });
    orderId = res.body.id;
  });
  const press = (body: Record<string, unknown>, auth: Record<string, string> = INTERNAL_AUTH) =>
    request(ctx.app).post(`/internal/orders/${orderId}/status`).set(auth).send(body);

  it('is not reachable without the service secret, and not under the public API prefix', async () => {
    expect(
      (await press({ status: 'CONFIRMED', telegramUserId: 5000, requireLinkedAdmin: false }, {}))
        .status,
    ).toBe(401);
    expect(
      (
        await press(
          { status: 'CONFIRMED', telegramUserId: 5000, requireLinkedAdmin: false },
          { Authorization: 'Bearer wrong' },
        )
      ).status,
    ).toBe(401);
    expect([403, 404]).toContain(
      (
        await request(ctx.app)
          .post(`/api/v1/internal/orders/${orderId}/status`)
          .set(INTERNAL_AUTH)
          .send({})
      ).status,
    );
  });

  it("changes the order from the owner's private chat, records it as done through Telegram, and queues the usual events", async () => {
    const res = await press({
      status: 'CONFIRMED',
      telegramUserId: 5000,
      requireLinkedAdmin: false,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CONFIRMED' });
    const event = await ctx.prisma.orderStatusEvent.findFirstOrThrow({
      where: { orderId, toStatus: 'CONFIRMED' },
    });
    expect(event.note).toBe('via Telegram');
    expect(event.actorUserId).toBeNull(); // no linked account: the chat itself was trusted
    expect(await ctx.prisma.serviceEvent.count({ where: { type: 'order.status_changed' } })).toBe(
      1,
    );
  });

  it('in a group, needs the person to be a linked admin account, and records who', async () => {
    expect(
      (await press({ status: 'CONFIRMED', telegramUserId: 321, requireLinkedAdmin: true })).status,
    ).toBe(403);
    const admin = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN', telegramUserId: 321 });
    expect(
      (await press({ status: 'CONFIRMED', telegramUserId: 321, requireLinkedAdmin: true })).status,
    ).toBe(200);
    const event = await ctx.prisma.orderStatusEvent.findFirstOrThrow({
      where: { orderId, toStatus: 'CONFIRMED' },
    });
    expect(event.actorUserId).toBe(admin.user.id);
    // A customer's account doesn't count, and neither does a disabled admin.
    await ctx.prisma.user.update({
      where: { id: admin.user.id },
      data: { disabledAt: new Date() },
    });
    expect(
      (await press({ status: 'PACKED', telegramUserId: 321, requireLinkedAdmin: true })).status,
    ).toBe(403);
  });

  it('answers a stale press with where the order really is', async () => {
    await press({ status: 'PACKED', telegramUserId: 5000, requireLinkedAdmin: false });
    const res = await press({
      status: 'CONFIRMED',
      telegramUserId: 5000,
      requireLinkedAdmin: false,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { status: 'PACKED' },
    });
    expect(
      (
        await request(ctx.app)
          .post('/internal/orders/00000000-0000-4000-8000-000000000000/status')
          .set(INTERNAL_AUTH)
          .send({ status: 'CONFIRMED', telegramUserId: 1, requireLinkedAdmin: false })
      ).status,
    ).toBe(404);
    expect(
      (await press({ status: 'NOPE', telegramUserId: 1, requireLinkedAdmin: false })).status,
    ).toBe(400);
  });
});

describe('admin Telegram status', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
  });

  it('shows what the notification service reports, plus events still waiting for it', async () => {
    const admin = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' });
    const customer = await signedInAgent(ctx.app, ctx.prisma);
    expect((await customer.agent.get('/api/v1/admin/telegram/status')).status).toBe(403);
    await ctx.prisma.serviceEvent.create({
      data: {
        target: 'notification',
        type: 'admin.alert',
        payload: {},
        lastError: 'notification unreachable',
      },
    });
    const res = (await admin.agent.get('/api/v1/admin/telegram/status')).body;
    expect(res).toMatchObject({
      serviceReachable: true,
      mode: 'webhook',
      botConfigured: true,
      adminChatSet: true,
      alertsOn: true,
      waitingForService: { pending: 1, failed: 0 },
    });
  });

  it('says plainly when the notification service cannot be reached', async () => {
    const admin = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' });
    ctx.notification.reachable = false;
    const res = await admin.agent.get('/api/v1/admin/telegram/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ serviceReachable: false, botConfigured: false });
    const test = await admin.agent.post('/api/v1/admin/telegram/test').set('Origin', WEB_ORIGIN);
    expect(test.status).toBe(503);
    expect(test.body.error.code).toBe('NOTIFICATION_SERVICE_UNAVAILABLE');
  });

  it('asks the notification service to send the owner a test message', async () => {
    const admin = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' });
    expect(
      (await admin.agent.post('/api/v1/admin/telegram/test').set('Origin', WEB_ORIGIN)).body,
    ).toEqual({ queued: true });
    expect(ctx.notification.tests).toBe(1);
  });
});
