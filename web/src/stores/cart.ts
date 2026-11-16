import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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

/** localStorage that never throws (private mode, blocked storage). */
const safeStorage = createJSONStorage(() => ({
  getItem: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable: cart lives in memory only */
    }
  },
  removeItem: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
}));

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      add: () => {},
      setQty: () => {},
      remove: () => {},
      removeMany: () => {},
      clear: () => set({ items: [] }),
      count: () => get().items.reduce((n, i) => n + i.quantity, 0),
    }),
    { name: 'cs_cart_v1', storage: safeStorage, partialize: (s) => ({ items: s.items }) },
  ),
);
