import type { OrderSnapshot } from '@cambo/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { publishEvent } from './outbox';

type Db = PrismaClient | Prisma.TransactionClient;

const orderForSnapshot = {
  items: { orderBy: { createdAt: 'asc' } },
  payment: true,
  promoCode: true,
  user: true,
} as const;

/** The order as the other services need to see it, plus who to tell. Read inside the same transaction as the change. */
export async function loadSnapshot(
  db: Db,
  orderId: string,
): Promise<{ order: OrderSnapshot; customerChatId: string | null }> {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: orderForSnapshot });
  return {
    order: {
      id: o.id,
      number: o.number,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      contactName: o.contactName,
      contactPhone: o.contactPhone,
      region: o.region,
      deliveryService: o.deliveryService,
      addressLine: o.addressLine,
      lat: o.lat,
      lng: o.lng,
      distanceKm: o.distanceKm,
      note: o.note,
      subtotalCents: o.subtotalCents,
      deliveryFeeCents: o.deliveryFeeCents,
      discountCents: o.discountCents,
      totalCents: o.totalCents,
      promoCode: o.promoCode?.code ?? null,
      trackingNumber: o.trackingNumber,
      payment: o.payment ? { method: o.payment.method, status: o.payment.status } : null,
      items: o.items.map((i) => ({
        productId: i.productId,
        name: i.name,
        quantity: i.quantity,
        priceCents: i.priceCents,
        lineTotalCents: i.lineTotalCents,
      })),
    },
    // Disabled customers get no messages.
    customerChatId: o.user.disabledAt ? null : (o.user.telegramChatId?.toString() ?? null),
  };
}

const adminAlertsOn = async (db: Db) =>
  (await db.storeSetting.findUnique({ where: { id: 1 } }))?.telegramNotify ?? true;

/**
 * One function per thing that happens to an order. Each queues what the report service
 * (the order as it is now) and the notification service (what to tell people) need.
 * Call them with the transaction client, before the transaction ends.
 */

/** Only the report service needs to know (e.g. a payment status fixed by hand). */
export async function announceSnapshot(db: Db, orderId: string) {
  const { order } = await loadSnapshot(db, orderId);
  await publishEvent(db, 'order.snapshot', order);
}

export async function announceOrderPlaced(db: Db, orderId: string, holdMinutes: number) {
  const { order, customerChatId } = await loadSnapshot(db, orderId);
  await publishEvent(db, 'order.snapshot', order);
  await publishEvent(
    db,
    'order.placed',
    { order, customerChatId, adminAlerts: await adminAlertsOn(db), holdMinutes },
    { dedupeKey: `order:${orderId}:placed` },
  );
}

/** The status moved (confirmed, packed, shipped, delivered or cancelled). */
export async function announceStatusChanged(db: Db, orderId: string) {
  const { order, customerChatId } = await loadSnapshot(db, orderId);
  await publishEvent(db, 'order.snapshot', order);
  await publishEvent(
    db,
    'order.status_changed',
    { order, customerChatId },
    { dedupeKey: `order:${orderId}:status:${order.status}` },
  );
}

/** The shop entered (or changed) the carrier's tracking number: tell the customer. */
export async function announceTrackingSet(db: Db, orderId: string) {
  const { order, customerChatId } = await loadSnapshot(db, orderId);
  await publishEvent(db, 'order.snapshot', order);
  await publishEvent(
    db,
    'order.tracking_set',
    { order, customerChatId },
    { dedupeKey: `order:${orderId}:tracking:${order.trackingNumber}` },
  );
}

export async function announcePaymentConfirmed(db: Db, orderId: string) {
  const { order, customerChatId } = await loadSnapshot(db, orderId);
  await publishEvent(db, 'order.snapshot', order);
  await publishEvent(
    db,
    'payment.confirmed',
    { order, customerChatId, adminAlerts: await adminAlertsOn(db) },
    { dedupeKey: `order:${orderId}:paid` },
  );
}

/** The shop marked a paid-then-cancelled order refunded: tell the customer the money is on its way. */
export async function announcePaymentRefunded(db: Db, orderId: string) {
  const { order, customerChatId } = await loadSnapshot(db, orderId);
  await publishEvent(db, 'order.snapshot', order);
  await publishEvent(
    db,
    'payment.refunded',
    { order, customerChatId },
    { dedupeKey: `order:${orderId}:refunded` },
  );
}

/** The payment window is closing: remind the customer (only when they have Telegram). */
export async function announcePaymentReminder(db: Db, orderId: string, minutesLeft: number) {
  const { order, customerChatId } = await loadSnapshot(db, orderId);
  if (!customerChatId) return;
  await publishEvent(
    db,
    'payment.reminder',
    { order, customerChatId, minutesLeft },
    { dedupeKey: `order:${orderId}:reminder` },
  );
}

export async function announcePaymentExpired(db: Db, orderId: string, holdMinutes: number) {
  const { order, customerChatId } = await loadSnapshot(db, orderId);
  await publishEvent(db, 'order.snapshot', order);
  await publishEvent(
    db,
    'payment.expired',
    { order, customerChatId, holdMinutes },
    { dedupeKey: `order:${orderId}:expired` },
  );
}

/** A product just ran low or sold out: tell the owner. Call inside the transaction that took the stock. */
export async function announceLowStock(db: Db, product: { id: string; name: string; stock: number }) {
  await publishEvent(db, 'product.low_stock', {
    productId: product.id,
    name: product.name,
    stock: product.stock,
    adminAlerts: await adminAlertsOn(db),
  });
}

/** Someone just created an account: tell the owner. */
export async function announceCustomerSignedUp(
  db: Db,
  user: { id: string; name: string; phone: string; telegramUsername: string | null },
) {
  await publishEvent(
    db,
    'customer.signed_up',
    { name: user.name, phone: user.phone, telegramUsername: user.telegramUsername, adminAlerts: await adminAlertsOn(db) },
    { dedupeKey: `customer:${user.id}:signed_up` },
  );
}

/** A plain message for the shop owner ("Bakong token rejected", "paid but cancelled"...). */
export async function alertAdmin(db: Db, text: string, dedupeKey?: string) {
  await publishEvent(
    db,
    'admin.alert',
    { text, adminAlerts: await adminAlertsOn(db) },
    dedupeKey ? { dedupeKey } : {},
  );
}
