import { Prisma, type PrismaClient } from '@prisma/client';
import {
  computeDeliveryFeeCents,
  computePromoDiscountCents,
  DEFAULT_DELIVERY_SETTINGS,
  type DeliverySettings,
  type QuoteInput,
} from '@cambo/shared';
import { AppError } from '../errors';

type Db = PrismaClient | Prisma.TransactionClient;

export type QuoteItem = {
  productId: string;
  name: string;
  priceCents: number;
  quantity: number;
  lineTotalCents: number;
  imageKey: string | null;
  imageWidth: number | null;
};

export type Quote = {
  items: QuoteItem[];
  subtotalCents: number;
  deliveryFeeCents: number;
  distanceKm: number | null;
  discountCents: number;
  totalCents: number;
  promo: { id: string; code: string } | null;
};

export async function getDeliverySettings(db: Db): Promise<DeliverySettings> {
  const row = await db.storeSetting.findUnique({ where: { id: 1 } });
  return { ...DEFAULT_DELIVERY_SETTINGS, ...((row?.delivery as Partial<DeliverySettings> | null) ?? {}) };
}

const promoInvalid = (reason: string, message: string) => new AppError(422, 'PROMO_INVALID', message, { reason });

/**
 * Price a cart from the database. With `lock`, product and promo rows are locked
 * (`FOR UPDATE`) so the caller's transaction can safely take stock and promo uses.
 */
export async function buildQuote(db: Db, input: QuoteInput, userId: string, opts: { lock?: boolean } = {}): Promise<Quote> {
  const wanted = new Map<string, number>();
  for (const item of input.items) wanted.set(item.productId, (wanted.get(item.productId) ?? 0) + item.quantity);
  const ids = [...wanted.keys()].sort();

  if (opts.lock) {
    await db.$queryRaw`SELECT id FROM "Product" WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  }
  const products = await db.product.findMany({
    where: { id: { in: ids } },
    include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const unavailable = ids.filter((id) => !byId.get(id)?.isActive);
  if (unavailable.length) {
    throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'Some items are no longer available', { productIds: unavailable });
  }
  const short = ids
    .map((id) => {
      const p = byId.get(id)!;
      const available = p.isSoldOut ? 0 : Math.max(0, p.stock);
      return { productId: id, available, wanted: wanted.get(id)! };
    })
    .filter((x) => x.wanted > x.available)
    .map(({ productId, available }) => ({ productId, available }));
  if (short.length) throw new AppError(409, 'OUT_OF_STOCK', 'Some items are out of stock', { items: short });

  const items: QuoteItem[] = ids.map((id) => {
    const p = byId.get(id)!;
    const quantity = wanted.get(id)!;
    return {
      productId: id,
      name: p.name,
      priceCents: p.priceCents,
      quantity,
      lineTotalCents: p.priceCents * quantity,
      imageKey: p.images[0]?.storageKey ?? null,
      imageWidth: p.images[0]?.width ?? null,
    };
  });
  const subtotalCents = items.reduce((sum, i) => sum + i.lineTotalCents, 0);

  let delivery: { feeCents: number; distanceKm: number | null };
  try {
    delivery = computeDeliveryFeeCents(await getDeliverySettings(db), {
      region: input.region,
      service: input.deliveryService,
      pin: input.pin ?? null,
    });
  } catch {
    throw new AppError(422, 'DELIVERY_NOT_AVAILABLE', 'Grab delivery is only available in Phnom Penh');
  }

  let discountCents = 0;
  let promo: Quote['promo'] = null;
  const code = input.promoCode?.trim().toUpperCase();
  if (code) {
    const found = await db.promoCode.findUnique({ where: { code } });
    if (!found || !found.isActive) throw promoInvalid('NOT_FOUND', "This promo code isn't valid");
    if (opts.lock) await db.$queryRaw`SELECT id FROM "PromoCode" WHERE id = ${found.id}::uuid FOR UPDATE`;
    const p = opts.lock ? await db.promoCode.findUniqueOrThrow({ where: { id: found.id } }) : found;
    const now = Date.now();
    if (p.startsAt && p.startsAt.getTime() > now) throw promoInvalid('NOT_STARTED', "This promo code isn't active yet");
    if (p.endsAt && p.endsAt.getTime() <= now) throw promoInvalid('EXPIRED', 'This promo code has expired');
    if (p.maxUses !== null && p.usedCount >= p.maxUses) throw promoInvalid('USED_UP', 'This promo code has been fully used');
    if (p.maxUsesPerUser !== null) {
      const mine = await db.order.count({ where: { userId, promoCodeId: p.id, status: { not: 'CANCELLED' } } });
      if (mine >= p.maxUsesPerUser) throw promoInvalid('ALREADY_USED', "You've already used this promo code");
    }
    if (subtotalCents < p.minSubtotalCents) {
      throw promoInvalid('MIN_SUBTOTAL', 'Your order is below the minimum for this promo code');
    }
    discountCents = computePromoDiscountCents({ type: p.type, value: p.value }, subtotalCents);
    promo = { id: p.id, code: p.code };
  }

  return {
    items,
    subtotalCents,
    deliveryFeeCents: delivery.feeCents,
    distanceKm: delivery.distanceKm,
    discountCents,
    totalCents: subtotalCents + delivery.feeCents - discountCents,
    promo,
  };
}

export { Prisma };
