import { describe, expect, it } from 'vitest';
import { createOrderSchema, loginSchema, passwordSchema } from './index';

const order = {
  items: [{ productId: '7f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b11', quantity: 1 }],
  region: 'PHNOM_PENH',
  deliveryService: 'VET',
  contactName: 'Dara',
  contactPhone: '012345678',
  addressLine: 'Toul Kork',
  paymentMethod: 'COD',
};

describe('schemas', () => {
  it('rejects a common password', () => {
    expect(passwordSchema.safeParse('password').success).toBe(false);
  });
  it('rejects a 7-character password', () => {
    expect(passwordSchema.safeParse('Ab3$xyz').success).toBe(false);
  });
  it('accepts a decent password', () => {
    expect(passwordSchema.safeParse('kb-store-2026').success).toBe(true);
  });
  it('normalizes the login phone', () => {
    expect(loginSchema.parse({ phone: '012 345 678', password: 'x' }).phone).toBe('+85512345678');
  });
  it.each([0, 21])('rejects quantity %d', (quantity) => {
    const bad = { ...order, items: [{ ...order.items[0], quantity }] };
    expect(createOrderSchema.safeParse(bad).success).toBe(false);
  });
  it('accepts a valid order and normalizes contact phone', () => {
    expect(createOrderSchema.parse(order).contactPhone).toBe('+85512345678');
  });
});
