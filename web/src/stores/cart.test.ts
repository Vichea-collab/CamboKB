import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_QTY, useCart } from './cart';

const A = '7f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b11';
const B = '8f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b12';

describe('cart store', () => {
  beforeEach(() => useCart.setState({ items: [] }));

  it('adds and increments a line', () => {
    useCart.getState().add(A);
    useCart.getState().add(A);
    expect(useCart.getState().items).toEqual([{ productId: A, quantity: 2 }]);
    expect(useCart.getState().count()).toBe(2);
  });

  it('caps quantity at the per-item maximum', () => {
    useCart.getState().add(A, 25);
    expect(useCart.getState().items[0]!.quantity).toBe(MAX_QTY);
    expect(MAX_QTY).toBe(20);
  });

  it('removes a line when quantity is set to 0', () => {
    useCart.getState().add(A);
    useCart.getState().add(B);
    useCart.getState().setQty(A, 0);
    expect(useCart.getState().items.map((i) => i.productId)).toEqual([B]);
  });

  it('removes several lines at once', () => {
    useCart.getState().add(A);
    useCart.getState().add(B);
    useCart.getState().removeMany([A, B]);
    expect(useCart.getState().items).toEqual([]);
  });

  it('saves to localStorage', () => {
    useCart.getState().add(A, 3);
    expect(JSON.parse(localStorage.getItem('cs_cart_v1')!).state.items).toEqual([{ productId: A, quantity: 3 }]);
  });

  it('restores a saved cart (page reload)', async () => {
    localStorage.setItem('cs_cart_v1', JSON.stringify({ state: { items: [{ productId: B, quantity: 2 }] }, version: 0 }));
    await useCart.persist.rehydrate();
    expect(useCart.getState().items).toEqual([{ productId: B, quantity: 2 }]);
  });
});
