import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProduct,
  createTestApp,
  resetDb,
  signedInAgent,
  WEB_ORIGIN,
} from '../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

/** Opens the live stream like a browser would and collects its events. */
async function listen(url: string, cookie: string) {
  const controller = new AbortController();
  const res = await fetch(url, { headers: { cookie }, signal: controller.signal });
  const events: { event: string; data: Record<string, unknown> }[] = [];
  let text = '';
  const done = (async () => {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        text += decoder.decode(chunk, { stream: true });
        for (let i = text.indexOf('\n\n'); i !== -1; i = text.indexOf('\n\n')) {
          const block = text.slice(0, i);
          text = text.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
        }
      }
    } catch {
      // aborted
    }
  })();
  return { res, events, close: () => controller.abort(), done };
}

describe('live admin events', () => {
  let ctx: Ctx;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
    server = ctx.app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/admin/events`;
  });
  afterEach(() => {
    server.closeAllConnections();
    server.close();
  });

  const cookieOf = async (role: 'ADMIN' | 'CUSTOMER') => {
    const u = await signedInAgent(ctx.app, ctx.prisma, { role });
    const jar = await request(ctx.app)
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ phone: u.user.phone, password: 'kb-store-2026' });
    return {
      cookie: (jar.headers['set-cookie'] as unknown as string[])
        .map((c) => c.split(';')[0])
        .join('; '),
      agent: u.agent,
    };
  };

  it('is for signed-in admins only', async () => {
    expect((await fetch(base)).status).toBe(401);
    const c = await cookieOf('CUSTOMER');
    expect((await fetch(base, { headers: { cookie: c.cookie } })).status).toBe(403);
  });

  it('streams new orders and status changes as they happen', async () => {
    const admin = await cookieOf('ADMIN');
    const stream = await listen(base, admin.cookie);
    expect(stream.res.status).toBe(200);
    expect(stream.res.headers.get('content-type')).toContain('text/event-stream');
    expect(stream.res.headers.get('x-accel-buffering')).toBe('no');

    const shopper = await signedInAgent(ctx.app, ctx.prisma, { name: 'Dara' });
    const product = await createProduct(ctx.prisma, { priceCents: 600, stock: 5 });
    const placed = await shopper.agent
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
    await expect
      .poll(() => stream.events.find((e) => e.event === 'order.created'))
      .toMatchObject({
        data: { orderId: placed.body.id, number: placed.body.number, customer: 'Dara' },
      });

    await admin.agent
      .post(`/api/v1/admin/orders/${placed.body.id}/status`)
      .set('Origin', WEB_ORIGIN)
      .send({ status: 'CONFIRMED' });
    await expect
      .poll(() => stream.events.find((e) => e.event === 'order.updated'))
      .toMatchObject({ data: { orderId: placed.body.id, status: 'CONFIRMED' } });

    await admin.agent
      .post(`/api/v1/admin/orders/${placed.body.id}/payment`)
      .set('Origin', WEB_ORIGIN)
      .send({ status: 'PAID' });
    await expect
      .poll(() => stream.events.find((e) => e.event === 'payment.updated'))
      .toMatchObject({ data: { status: 'PAID' } });

    stream.close();
    await stream.done;
  });

  it('keeps every open tab up to date and cleans up when one closes', async () => {
    const admin = await cookieOf('ADMIN');
    const a = await listen(base, admin.cookie);
    const b = await listen(base, admin.cookie);
    const { publishAdminEvent } = await import('../lib/events');
    publishAdminEvent({ type: 'order.updated', orderId: 'x', number: 'CS-1', status: 'PACKED' });
    await expect.poll(() => a.events.length).toBe(1);
    await expect.poll(() => b.events.length).toBe(1);
    a.close();
    await a.done;
    await new Promise((r) => setTimeout(r, 50));
    publishAdminEvent({ type: 'order.updated', orderId: 'x', number: 'CS-1', status: 'SHIPPING' });
    await expect.poll(() => b.events.length).toBe(2);
    expect(a.events.length).toBe(1);
    b.close();
    await b.done;
  });

  it('limits how many tabs one admin can hold open', async () => {
    const admin = await cookieOf('ADMIN');
    const open = await Promise.all(Array.from({ length: 8 }, () => listen(base, admin.cookie)));
    expect((await fetch(base, { headers: { cookie: admin.cookie } })).status).toBe(429);
    for (const s of open) s.close();
    await Promise.all(open.map((s) => s.done));
  });
});
