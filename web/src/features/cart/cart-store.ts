import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from '../../shared/lib/safe-storage';

export type CartLine = { productId: string; quantity: number };
export const MAX_QTY = 20;

type CartState = {
  items: CartLine[];
  add: (productId: string, qty?: number) => void;
  setQty: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  removeMany: (productIds: string[]) => void;
  clear: () => void;
  count: () => number;
};

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (productId, qty = 1) =>
        set((s) => {
          const existing = s.items.find((i) => i.productId === productId);
          if (existing) {
            return { items: s.items.map((i) => (i.productId === productId ? { ...i, quantity: Math.min(MAX_QTY, i.quantity + qty) } : i)) };
          }
          return { items: [...s.items, { productId, quantity: Math.min(MAX_QTY, Math.max(1, qty)) }] };
        }),
      setQty: (productId, qty) =>
        set((s) => ({
          items:
            qty <= 0
              ? s.items.filter((i) => i.productId !== productId)
              : s.items.map((i) => (i.productId === productId ? { ...i, quantity: Math.min(MAX_QTY, qty) } : i)),
        })),
      remove: (productId) => set((s) => ({ items: s.items.filter((i) => i.productId !== productId) })),
      removeMany: (ids) => set((s) => ({ items: s.items.filter((i) => !ids.includes(i.productId)) })),
      clear: () => set({ items: [] }),
      count: () => get().items.reduce((n, i) => n + i.quantity, 0),
    }),
    { name: 'cs_cart_v1', storage: safeStorage, partialize: (s) => ({ items: s.items }) },
  ),
);
