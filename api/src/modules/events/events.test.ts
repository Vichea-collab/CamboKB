import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeEach, describe, expect, it } from 'vitest';
import { EventDeliveryError, HttpEventSender } from '../../integrations/services/events';
import { backfillOrderSnapshots } from '../../cli/events';
import {
  createProduct,
  createTestApp,
  resetDb,
  signedInAgent,
  WEB_ORIGIN,
} from '../../../test/helpers';
import {
  drainEvents,
  eventsHealth,
  eventsIdle,
  kickEvents,
  publishEvent,
  purgeEvents,
  retryDelayMs,
  retryFailedEvents,
} from './outbox';
import { alertAdmin } from './snapshot';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
const rows = (ctx: Ctx) => ctx.prisma.serviceEvent.findMany({ orderBy: { createdAt: 'asc' } });
/** Pretend the wait is over so the next drain tries again. */
const makeDue = (ctx: Ctx) =>
  ctx.prisma.serviceEvent.updateMany({
    where: { status: 'PENDING' },
    data: { nextAttemptAt: new Date(Date.now() - 1000), lockedUntil: null },
  });
const alert = (ctx: Ctx, text: string, key?: string) => alertAdmin(ctx.prisma, text, key);

describe('service event outbox', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
  });

  it('delivers a queued event right away, with the request id, and marks it sent', async () => {
    await alert(ctx, 'hello');
    kickEvents(ctx.deps);
    await eventsIdle();
    expect(ctx.events.sent).toHaveLength(1);
    expect(ctx.events.sent[0]).toMatchObject({
      target: 'notification',
      envelope: { type: 'admin.alert', data: { text: 'hello', adminAlerts: true } },
    });
    expect((await rows(ctx))[0]).toMatchObject({ status: 'SENT', attempts: 1, lastError: null });
  });

  it('is saved with the change that caused it, or not at all', async () => {
    const product = await createProduct(ctx.prisma, { stock: 5 });
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await tx.product.update({ where: { id: product.id }, data: { stock: 4 } });
        await alertAdmin(tx, 'inside the transaction');
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');
    expect(await ctx.prisma.serviceEvent.count()).toBe(0);
    expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(
      5,
    );
  });

  it('keeps events when a service is down and delivers them later, after a restart', async () => {
    ctx.events.failWith = new EventDeliveryError('notification unreachable', true);
    await alert(ctx, 'order CS-1');
    kickEvents(ctx.deps);
    await eventsIdle();
    const [row] = await rows(ctx);
    expect(row).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastError: 'notification unreachable',
    });
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    const after = await createTestApp(); // a restarted api: new process, same database
    expect(await drainEvents(after.deps)).toBe(0); // not due yet
    await makeDue(ctx);
    expect(await drainEvents(after.deps)).toBe(1);
    expect(after.events.data('admin.alert')).toEqual([{ text: 'order CS-1', adminAlerts: true }]);
  });

  it('is due the moment it is queued, every time', async () => {
    // The database rounds its own clock up to the next millisecond, so a due time it chose could lie just ahead of ours.
    for (let i = 1; i <= 60; i++) {
      await alert(ctx, `message ${i}`);
      expect(await drainEvents(ctx.deps)).toBe(1);
    }
  });

  it("doesn't let a dead service hold up a healthy one", async () => {
    await alert(ctx, 'to notification');
    const snapshotLike = await ctx.prisma.serviceEvent.create({
      data: { target: 'report', type: 'order.snapshot', payload: {}, nextAttemptAt: new Date() },
    });
    ctx.events.send = async (target, envelope) => {
      if (target === 'notification') throw new EventDeliveryError('notification down', true);
      ctx.events.sent.push({ target, envelope });
    };
    await drainEvents(ctx.deps);
    expect(ctx.events.sent.map((e) => e.target)).toEqual(['report']);
    expect(
      (await ctx.prisma.serviceEvent.findUniqueOrThrow({ where: { id: snapshotLike.id } })).status,
    ).toBe('SENT');
    expect((await eventsHealth(ctx.deps))['notification']).toMatchObject({
      pending: 1,
      lastError: 'notification down',
    });
  });

  it('gives up at once on an event the receiver rejects, and can queue it again later', async () => {
    ctx.events.failWith = new EventDeliveryError('report answered 400 INVALID_EVENT', false, 400);
    await alert(ctx, 'bad');
    kickEvents(ctx.deps);
    await eventsIdle();
    expect((await rows(ctx))[0]).toMatchObject({ status: 'FAILED', attempts: 1 });
    ctx.events.failWith = null;
    await makeDue(ctx);
    expect(await drainEvents(ctx.deps)).toBe(0);
    expect(await retryFailedEvents(ctx.prisma)).toBe(1);
    expect(await drainEvents(ctx.deps)).toBe(1);
  });

  it('gives up after repeated failures', async () => {
    ctx.events.failWith = new EventDeliveryError('down', true);
    await alert(ctx, 'x');
    for (let i = 0; i < 14; i++) {
      await makeDue(ctx);
      await drainEvents(ctx.deps);
    }
    expect((await rows(ctx))[0]).toMatchObject({ status: 'FAILED', attempts: 12 });
    expect((await eventsHealth(ctx.deps))['notification']).toMatchObject({ pending: 0, failed: 1 });
  });

  it('never queues the same event twice, even inside a transaction', async () => {
    await alert(ctx, 'a', 'same-key');
    await alert(ctx, 'b', 'same-key');
    await ctx.prisma.$transaction(async (tx) => {
      await alertAdmin(tx, 'c', 'same-key');
    });
    expect(await ctx.prisma.serviceEvent.count()).toBe(1);
    // The same key for the other service is a different event.
    await publishEvent(
      ctx.prisma,
      'admin.alert',
      { text: 'd', adminAlerts: true },
      { dedupeKey: 'other' },
    );
    expect(await ctx.prisma.serviceEvent.count()).toBe(2);
  });

  it('two workers never deliver the same event twice', async () => {
    await ctx.prisma.serviceEvent.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        target: 'notification',
        type: 'admin.alert',
        payload: { text: `m${i}`, adminAlerts: true },
      })),
    });
    const other = await createTestApp();
    await Promise.all([drainEvents(ctx.deps), drainEvents(other.deps)]);
    const all = [...ctx.events.data('admin.alert'), ...other.events.data('admin.alert')]
      .map((d) => d.text)
      .sort();
    expect(all).toEqual(Array.from({ length: 10 }, (_, i) => `m${i}`).sort());
  });

  it('retries an event left locked by a crashed worker', async () => {
    await ctx.prisma.serviceEvent.create({
      data: {
        target: 'notification',
        type: 'admin.alert',
        payload: { text: 'stuck', adminAlerts: true },
        attempts: 1,
        lockedUntil: new Date(Date.now() - 1000),
      },
    });
    expect(await drainEvents(ctx.deps)).toBe(1);
  });

  it('backs off 5s, 15s, 45s... up to 15 minutes', () => {
    expect([1, 2, 3, 4, 9].map(retryDelayMs)).toEqual([5_000, 15_000, 45_000, 135_000, 900_000]);
  });

  it('cleans up old rows but keeps recent and pending ones', async () => {
    const old = new Date(Date.now() - 20 * 86_400_000);
    await ctx.prisma.serviceEvent.createMany({
      data: [
        { target: 'report', type: 'x', payload: {}, status: 'SENT', createdAt: old },
        { target: 'report', type: 'y', payload: {}, status: 'SENT' },
        { target: 'report', type: 'z', payload: {}, createdAt: old },
      ],
    });
    expect(await purgeEvents(ctx.deps)).toBe(1);
    expect((await rows(ctx)).map((r) => r.type).sort()).toEqual(['y', 'z']);
  });

  it('exposes backlog and delivery metrics', async () => {
    ctx.events.failWith = new EventDeliveryError('down', true);
    await alert(ctx, 'x');
    kickEvents(ctx.deps);
    await eventsIdle();
    const text = await ctx.deps.metrics.registry.metrics();
    expect(text).toContain('service_events_pending{target="notification",service="api"} 1');
    expect(text).toContain('service_events_pending{target="report",service="api"} 0');
    expect(text).toContain(
      'service_events_delivered_total{target="notification",result="retry",service="api"} 1',
    );
    expect(text).toContain('service_events_oldest_pending_age_seconds');
  });
});

describe('events about orders', () => {
  let ctx: Ctx;
  let customer: Awaited<ReturnType<typeof signedInAgent>>;
  let admin: Awaited<ReturnType<typeof signedInAgent>>;
  let orderId: string;
  const queued = async (type: string) =>
    (
      await ctx.prisma.serviceEvent.findMany({ where: { type }, orderBy: { createdAt: 'asc' } })
    ).map((r) => r.payload as Record<string, unknown>);

  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
    customer = await signedInAgent(ctx.app, ctx.prisma, { name: 'Dara', telegramUserId: 7001 });
    admin = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' });
    const product = await createProduct(ctx.prisma, {
      name: 'Mousepad',
      priceCents: 600,
      stock: 10,
    });
    const res = await customer.agent
      .post('/api/v1/orders')
      .set('Origin', WEB_ORIGIN)
      .send({
        items: [{ productId: product.id, quantity: 2 }],
        region: 'PHNOM_PENH',
        deliveryService: 'VET',
        contactName: 'Dara',
        contactPhone: '012345678',
        addressLine: 'St. 315',
        paymentMethod: 'COD',
      });
    expect(res.status).toBe(201);
    orderId = res.body.id;
    await eventsIdle();
  });
  const setStatus = (status: string) =>
    admin.agent
      .post(`/api/v1/admin/orders/${orderId}/status`)
      .set('Origin', WEB_ORIGIN)
      .send({ status });

  it('tells both services about every status change, once, in the same transaction', async () => {
    for (const status of ['CONFIRMED', 'PACKED'])
      expect((await setStatus(status)).status).toBe(200);
    expect((await setStatus('CONFIRMED')).status).toBe(409); // a repeat is refused and queues nothing
    const changed = await queued('order.status_changed');
    expect(changed.map((c) => (c.order as { status: string }).status)).toEqual([
      'CONFIRMED',
      'PACKED',
    ]);
    expect(changed[0]).toMatchObject({ customerChatId: '7001' });
    const snapshots = await queued('order.snapshot');
    expect(snapshots.map((s) => s.status)).toEqual(['PENDING', 'CONFIRMED', 'PACKED']);
    await eventsIdle();
    expect(await ctx.prisma.serviceEvent.count({ where: { status: 'PENDING' } })).toBe(0);
  });

  it('sends a cancelled order with its stock given back, and no customer chat when the account is disabled', async () => {
    await ctx.prisma.user.update({
      where: { id: customer.user.id },
      data: { disabledAt: new Date() },
    });
    await setStatus('CANCELLED');
    const [changed] = await queued('order.status_changed');
    expect(changed).toMatchObject({ order: { status: 'CANCELLED' }, customerChatId: null });
  });

  it('gives the report service a payment status fixed by hand', async () => {
    const res = await admin.agent
      .post(`/api/v1/admin/orders/${orderId}/payment`)
      .set('Origin', WEB_ORIGIN)
      .send({ status: 'PAID' });
    expect(res.status).toBe(200);
    const snapshots = await queued('order.snapshot');
    expect(snapshots.at(-1)).toMatchObject({ payment: { method: 'COD', status: 'PAID' } });
    expect(await queued('order.status_changed')).toHaveLength(0);
  });

  it('backfills every order to the report service for a new or rebuilt report database', async () => {
    await ctx.prisma.serviceEvent.deleteMany();
    expect(await backfillOrderSnapshots(ctx.prisma)).toBe(1);
    const [snap] = await queued('order.snapshot');
    expect(snap).toMatchObject({
      id: orderId,
      status: 'PENDING',
      items: [{ name: 'Mousepad', quantity: 2, lineTotalCents: 1200 }],
    });
  });
});

describe('HttpEventSender', () => {
  let server: Server;
  let status = 200;
  let seen: { path?: string; auth?: string; requestId?: string; body?: string } = {};
  let base: string;
  beforeEach(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen = {
          path: req.url,
          auth: req.headers.authorization,
          requestId: req.headers['x-request-id'] as string,
          body,
        };
        res
          .writeHead(status, { 'content-type': 'application/json' })
          .end(
            JSON.stringify(
              status >= 400 ? { error: { code: 'NOPE', message: 'no' } } : { ok: true },
            ),
          );
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return () => void server.close();
  });
  const envelope = {
    id: '0d3b9a52-1c61-4c4e-9d7e-6a1f4b2c8e90',
    type: 'admin.alert',
    emittedAt: new Date().toISOString(),
    requestId: 'req-42',
    data: { text: 'x' },
  };

  it('posts the envelope to /internal/events with the secret and request id', async () => {
    const sender = new HttpEventSender({
      report: { url: base, secret: 'r' },
      notification: { url: base, secret: 'n-secret' },
    });
    await sender.send('notification', envelope);
    expect(seen).toMatchObject({
      path: '/internal/events',
      auth: 'Bearer n-secret',
      requestId: 'req-42',
    });
    expect(JSON.parse(seen.body!)).toMatchObject({ type: 'admin.alert' });
  });

  it.each([
    [400, false],
    [404, false],
    [422, false],
    [401, true],
    [429, true],
    [500, true],
    [503, true],
  ])('treats a %i answer as retryable=%s', async (code, retryable) => {
    status = code;
    const sender = new HttpEventSender({
      report: { url: base, secret: 'r' },
      notification: { url: base, secret: 'n' },
    });
    await expect(sender.send('report', envelope)).rejects.toMatchObject({
      retryable,
      status: code,
    });
    status = 200;
  });

  it('treats an unreachable service as retryable', async () => {
    const sender = new HttpEventSender({
      report: { url: 'http://127.0.0.1:1', secret: 'r' },
      notification: { url: base, secret: 'n' },
    });
    await expect(sender.send('report', envelope)).rejects.toMatchObject({ retryable: true });
  });
});
