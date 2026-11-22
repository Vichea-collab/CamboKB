import { describe, expect, it } from 'vitest';
import {
  createOrderSchema,
  customerInputSchema,
  loginCompleteSchema,
  telegramStartSchema,
} from './index';

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
  it('starts a Telegram login, but no longer a password reset', () => {
    expect(telegramStartSchema.safeParse({ purpose: 'LOGIN' }).success).toBe(true);
    expect(telegramStartSchema.safeParse({ purpose: 'RESET', phone: '012345678' }).success).toBe(false);
  });
  it('completes a login with just the request id', () => {
    const requestId = '7f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b11';
    expect(loginCompleteSchema.parse({ requestId, password: 'ignored' })).toEqual({ requestId });
    expect(loginCompleteSchema.safeParse({}).success).toBe(false);
  });
  it('has no password in the admin customer form', () => {
        expect(customerInputSchema.parse({ name: 'Dara', phone: '012345678', password: 'kb-store-2026' })).toEqual({
      name: 'Dara',
      phone: '012345678',
      role: 'CUSTOMER',
    });
  });
  it.each([0, 21])('rejects quantity %d', (quantity) => {
    const bad = { ...order, items: [{ ...order.items[0], quantity }] };
    expect(createOrderSchema.safeParse(bad).success).toBe(false);
  });
  it('accepts a valid order and normalizes contact phone', () => {
    expect(createOrderSchema.parse(order).contactPhone).toBe('+85512345678');
  });
});
