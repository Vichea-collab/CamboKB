import { PrismaClient, type OrderStatus } from '@prisma/client';

export const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

let seq = 0;
export async function seedCatalog() {
  const category = await prisma.category.create({ data: { name: 'Mice', slug: 'mice' } });
  const user = await prisma.user.create({ data: { phone: '+85512345678', name: 'Dara', passwordHash: 'x' } });
  const mouse = await prisma.product.create({ data: { name: 'Attack Shark X11 White', slug: 'x11', categoryId: category.id, priceCents: 2100, stock: 50 } });
  const pad = await prisma.product.create({ data: { name: 'Mousepad XL', slug: 'pad', categoryId: category.id, priceCents: 600, stock: 50 } });
  return { user, mouse, pad };
}

export async function seedOrder(opts: {
  userId: string;
  at: string;
  items: { productId: string; name: string; priceCents: number; quantity: number }[];
  status?: OrderStatus;
  deliveryFeeCents?: number;
  discountCents?: number;
  region?: 'PHNOM_PENH' | 'PROVINCE';
  contactName?: string;
  method?: 'COD' | 'KHQR';
}) {
  seq += 1;
  const subtotal = opts.items.reduce((s, i) => s + i.priceCents * i.quantity, 0);
  const fee = opts.deliveryFeeCents ?? 200;
  const discount = opts.discountCents ?? 0;
  const total = subtotal + fee - discount;
  return prisma.order.create({
    data: {
      userId: opts.userId,
      status: opts.status ?? 'PENDING',
      contactName: opts.contactName ?? 'Dara',
      contactPhone: '+85512345678',
      region: opts.region ?? 'PHNOM_PENH',
      deliveryService: 'VET',
      addressLine: 'St. 315, Toul Kork',
      subtotalCents: subtotal,
      deliveryFeeCents: fee,
      discountCents: discount,
      totalCents: total,
      createdAt: new Date(opts.at),
      idempotencyKey: `seed-${seq}`,
      items: { create: opts.items.map((i) => ({ ...i, lineTotalCents: i.priceCents * i.quantity })) },
      payment: { create: { method: opts.method ?? 'COD', status: 'UNPAID', amountCents: total } },
    },
  });
}
