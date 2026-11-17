import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProduct, createTestApp, createUser, resetDb, signedInAgent, WEB_ORIGIN } from './helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
const TG_ID = 7001;
let updateId = 1;

const send = (ctx: Ctx, text: string, fromId = TG_ID) =>
  request(ctx.app)
    .post('/api/v1/telegram/webhook')
    .set('X-Telegram-Bot-Api-Secret-Token', 'test-webhook-secret')
    .send({
      update_id: updateId++,
      message: { message_id: updateId, from: { id: fromId, first_name: 'Dara' }, chat: { id: fromId, type: 'private' }, text },
    });

const toCustomer = (ctx: Ctx) => ctx.telegram.sent.filter((m) => m.chatId === TG_ID);

describe('customer messages from the bot', () => {
  let ctx: Ctx;
  let customer: Awaited<ReturnType<typeof signedInAgent>>;
  let admin: Awaited<ReturnType<typeof signedInAgent>>;
  let product: Awaited<ReturnType<typeof createProduct>>;

  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
    customer = await signedInAgent(ctx.app, ctx.prisma, { name: 'Dara', telegramUserId: TG_ID });
    admin = await signedInAgent(ctx.app, ctx.prisma, { role: 'ADMIN' });
    product = await createProduct(ctx.prisma, { name: 'Attack Shark X11 White', priceCents: 2100, stock: 10 });
  });

  const placeOrder = async () => {
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
    return res.body as { id: string; number: string };
  };
  const setStatus = (id: string, status: string) => admin.agent.post(`/api/v1/admin/orders/${id}/status`).set('Origin', WEB_ORIGIN).send({ status });

  it('confirms a new order to the customer on Telegram', async () => {
    const o = await placeOrder();
    await vi.waitFor(() => expect(toCustomer(ctx)).toHaveLength(1));
    const text = toCustomer(ctx)[0]!.text;
    expect(text).toContain(o.number);
    expect(text).toContain('received');
    expect(text).toContain('$43.50');
    expect(text).toContain(`${WEB_ORIGIN}/account/orders/${o.number}`);
  });

  it.each([
    ['CONFIRMED', 'confirmed'],
    ['PACKED', 'packed'],
    ['SHIPPING', 'on the way'],
    ['DELIVERED', 'delivered'],
  ])('tells the customer when the order is %s', async (status, phrase) => {
    const o = await placeOrder();
    await vi.waitFor(() => expect(toCustomer(ctx)).toHaveLength(1));
    await setStatus(o.id, status);
    await vi.waitFor(() => expect(toCustomer(ctx)).toHaveLength(2));
    expect(toCustomer(ctx)[1]!.text.toLowerCase()).toContain(phrase);
    expect(toCustomer(ctx)[1]!.text).toContain(o.number);
  });

  it('tells the customer about a cancellation but keeps the internal note private', async () => {
    const o = await placeOrder();
    await vi.waitFor(() => expect(toCustomer(ctx)).toHaveLength(1));
    await admin.agent.post(`/api/v1/admin/orders/${o.id}/status`).set('Origin', WEB_ORIGIN).send({ status: 'CANCELLED', note: 'fraud suspicion' });
    await vi.waitFor(() => expect(toCustomer(ctx)).toHaveLength(2));
    expect(toCustomer(ctx)[1]!.text).toContain('cancelled');
    expect(toCustomer(ctx)[1]!.text).not.toContain('fraud');
  });

  it("doesn't fail the order or the status change when Telegram is down", async () => {
    ctx.telegram.failSends = true;
    const o = await placeOrder();
    expect((await setStatus(o.id, 'CONFIRMED')).status).toBe(200);
  });

  it('skips customers without a Telegram chat or with a disabled account', async () => {
    const plain = await signedInAgent(ctx.app, ctx.prisma, { name: 'No Telegram' });
    await plain.agent
      .post('/api/v1/orders')
      .set('Origin', WEB_ORIGIN)
      .send({ items: [{ productId: product.id, quantity: 1 }], region: 'PHNOM_PENH', deliveryService: 'VET', contactName: 'X', contactPhone: '012345679', addressLine: 'A', paymentMethod: 'COD' });
    await new Promise((r) => setTimeout(r, 150));
    expect(ctx.telegram.sent.filter((m) => typeof m.chatId === 'number')).toHaveLength(0);
  });
});

describe('bot commands', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
  });

  it('/orders lists the latest orders of the customer', async () => {
    const user = await createUser(ctx.prisma, { telegramUserId: TG_ID, name: 'Dara' });
    const product = await createProduct(ctx.prisma, { name: 'Mousepad XL', priceCents: 600 });
    for (const [i, status] of (['DELIVERED', 'SHIPPING'] as const).entries()) {
      await ctx.prisma.order.create({
        data: {
          userId: user.id, status, contactName: 'Dara', contactPhone: user.phone, region: 'PHNOM_PENH', deliveryService: 'VET', addressLine: 'A',
          subtotalCents: 600, deliveryFeeCents: 150, totalCents: 750, createdAt: new Date(Date.now() - (2 - i) * 3600_000),
          items: { create: { productId: product.id, name: product.name, priceCents: 600, quantity: 1, lineTotalCents: 600 } },
        },
      });
    }
    await send(ctx, '/orders');
    const text = toCustomer(ctx)[0]!.text;
    expect(text).toMatch(/CS-\d{6} · On the way · \$7\.50/);
    expect(text).toMatch(/CS-\d{6} · Delivered · \$7\.50/);
    expect(text.indexOf('On the way')).toBeLessThan(text.indexOf('Delivered'));
  });

  it('/orders invites a visitor without an account to sign up', async () => {
    await send(ctx, '/orders');
    expect(toCustomer(ctx)[0]!.text).toContain(`${WEB_ORIGIN}/signup`);
  });

  it('/orders says when there are no orders yet', async () => {
    await createUser(ctx.prisma, { telegramUserId: TG_ID });
    await send(ctx, '/orders');
    expect(toCustomer(ctx)[0]!.text).toContain("haven't ordered");
  });

  it('/help lists the commands and /shop links to the store', async () => {
    await send(ctx, '/help');
    expect(toCustomer(ctx)[0]!.text).toContain('/orders');
    expect(toCustomer(ctx)[0]!.text).toContain('/shop');
    await send(ctx, '/shop');
    expect(toCustomer(ctx)[1]!.text).toContain(WEB_ORIGIN);
  });

  it('/shop opens the store as a Telegram app when the site is on https', async () => {
    const https = await createTestApp({ config: { ...ctx.deps.config, webOrigin: ['https://shop.example.com'] } });
    await send(https, '/shop');
    expect(JSON.stringify(toCustomer(https)[0]!.opts)).toContain('"web_app":{"url":"https://shop.example.com"}');
  });

  it('registers the command menu with Telegram', async () => {
    const { setupBot } = await import('../src/telegram/setup');
    await setupBot(ctx.deps);
    expect(ctx.telegram.commands.map((c) => c.command)).toEqual(['shop', 'orders', 'help']);
    expect(ctx.telegram.menuButton).toBeNull(); // http origin: no web app button
    const https = await createTestApp({ config: { ...ctx.deps.config, webOrigin: ['https://shop.example.com'] } });
    await setupBot(https.deps);
    expect(https.telegram.menuButton).toEqual({ url: 'https://shop.example.com', text: 'Shop' });
  });
});
