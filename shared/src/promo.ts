import type { PromoType } from './types';

/** FIXED value is cents; PERCENT value is 1–100, rounded down. Never exceeds the subtotal. */
export function computePromoDiscountCents(
  promo: { type: PromoType; value: number },
  subtotalCents: number,
): number {
  const raw = promo.type === 'FIXED' ? promo.value : Math.floor((subtotalCents * promo.value) / 100);
  return Math.max(0, Math.min(raw, subtotalCents));
}
