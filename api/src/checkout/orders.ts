import { Prisma, type Order, type OrderItem, type OrderStatusEvent, type Payment, type PromoCode } from '@prisma/client';
import type { CreateOrderInput } from '@cambo/shared';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import type { FileClient } from '../files/client';
import { notifyNewOrder } from '../telegram/notify';
import { getPaymentProvider } from './payments';
import { buildQuote } from './quote';

export const orderInclude = {
  items: { orderBy: { createdAt: 'asc' } },
  events: { orderBy: { at: 'asc' } },
  payment: true,
  promoCode: true,
} as const;

export type OrderWithRelations = Order & {
  items: OrderItem[];
  events: OrderStatusEvent[];
  payment: Payment | null;
  promoCode: PromoCode | null;
};

export function toOrderDto(o: OrderWithRelations, files: FileClient) {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    createdAt: o.createdAt,
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
    items: o.items.map((i) => ({
      productId: i.productId,
      name: i.name,
      priceCents: i.priceCents,
      quantity: i.quantity,
      lineTotalCents: i.lineTotalCents,
      image: i.imageKey ? files.imageUrls(i.imageKey, 400).sm : null,
    })),
    events: o.events.map((e) => ({ fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note, at: e.at })),
    payment: o.payment
      ? { method: o.payment.method, status: o.payment.status, amountCents: o.payment.amountCents, paidAt: o.payment.paidAt }
      : null,
  };
}

const findByKey = (deps: AppDeps, userId: string, key: string) =>
  deps.prisma.order.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } }, include: orderInclude });

/** Place an order: lock rows, re-price, take stock and promo use, record payment — all in one transaction. */
export async function createOrder(
  deps: AppDeps,
  userId: string,
  input: CreateOrderInput,
  idempotencyKey?: string,
): Promise<{ order: OrderWithRelations; created: boolean }> {
  if (idempotencyKey) {
    const existing = await findByKey(deps, userId, idempotencyKey);
    if (existing) return { order: existing, created: false };
  }
  const provider = getPaymentProvider(input.paymentMethod);
  if (!provider.isAvailable({ region: input.region })) {
    throw new AppError(
      422,
      'PAYMENT_METHOD_UNAVAILABLE',
      input.paymentMethod === 'KHQR' ? 'KHQR payment is coming soon' : 'Cash on delivery is only available in Phnom Penh',
    );
  }

  let order: OrderWithRelations;
  try {
    order = await deps.prisma.$transaction(
      async (tx) => {
        const q = await buildQuote(tx, input, userId, { lock: true });
        for (const item of q.items) {
          await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } });
        }
        if (q.promo) await tx.promoCode.update({ where: { id: q.promo.id }, data: { usedCount: { increment: 1 } } });
        const created = await tx.order.create({
          data: {
            userId,
            idempotencyKey: idempotencyKey ?? null,
            contactName: input.contactName,
            contactPhone: input.contactPhone,
            region: input.region,
            deliveryService: input.deliveryService,
            addressLine: input.addressLine,
            lat: input.pin?.lat ?? null,
            lng: input.pin?.lng ?? null,
            distanceKm: q.distanceKm,
            note: input.note || null,
            subtotalCents: q.subtotalCents,
            deliveryFeeCents: q.deliveryFeeCents,
            discountCents: q.discountCents,
            totalCents: q.totalCents,
            promoCodeId: q.promo?.id ?? null,
            items: {
              create: q.items.map((i) => ({
                productId: i.productId,
                name: i.name,
                priceCents: i.priceCents,
                imageKey: i.imageKey,
                quantity: i.quantity,
                lineTotalCents: i.lineTotalCents,
              })),
            },
            events: { create: { fromStatus: null, toStatus: 'PENDING', actorUserId: userId } },
          },
        });
        await provider.createPayment(tx, created);
        return tx.order.findUniqueOrThrow({ where: { id: created.id }, include: orderInclude });
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  } catch (err) {
    // Same key raced in from a double tap: the other request won, return its order.
    if (idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await findByKey(deps, userId, idempotencyKey);
      if (existing) return { order: existing, created: false };
    }
    throw err;
  }

  void notifyNewOrder(deps, order.id);
  return { order, created: true };
}

/** Cancel an order: give back stock and the promo use. Call inside a transaction. */
export async function cancelOrder(
  tx: Prisma.TransactionClient,
  order: Order & { items: OrderItem[] },
  actorUserId: string,
  note?: string,
) {
  for (const item of order.items) {
    await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
  }
  if (order.promoCodeId) {
    await tx.promoCode.updateMany({ where: { id: order.promoCodeId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
  }
  await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
  await tx.orderStatusEvent.create({
    data: { orderId: order.id, fromStatus: order.status, toStatus: 'CANCELLED', note: note ?? null, actorUserId },
  });
}
