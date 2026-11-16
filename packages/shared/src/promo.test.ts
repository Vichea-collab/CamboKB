import { expect, it } from 'vitest';
import { computePromoDiscountCents } from './promo';

it.each([
  [{ type: 'FIXED', value: 100 }, 2100, 100],
  [{ type: 'FIXED', value: 5000 }, 2100, 2100],
  [{ type: 'PERCENT', value: 10 }, 2155, 215],
  [{ type: 'PERCENT', value: 100 }, 999, 999],
] as const)('discount %j on %d = %d', (promo, subtotal, expected) => {
  expect(computePromoDiscountCents(promo, subtotal)).toBe(expected);
});
