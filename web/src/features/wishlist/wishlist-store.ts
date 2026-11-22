import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from '../../shared/lib/safe-storage';

/** `GET /products/by-ids` takes at most 50 ids, so that is the size of the list. */
export const WISHLIST_MAX = 50;

type WishlistState = {
  /** Product ids, newest first. */
  ids: string[];
  /** Adds or removes. Returns true when the product is now saved. */
  toggle: (productId: string) => boolean;
  removeMany: (productIds: string[]) => void;
};

export const useWishlist = create<WishlistState>()(
  persist(
    (set, get) => ({
      ids: [],
      toggle: (productId) => {
        const saved = get().ids.includes(productId);
        set((s) => ({
          ids: saved
            ? s.ids.filter((id) => id !== productId)
            : [productId, ...s.ids].slice(0, WISHLIST_MAX),
        }));
        return !saved;
      },
      removeMany: (productIds) =>
        set((s) => ({ ids: s.ids.filter((id) => !productIds.includes(id)) })),
    }),
    { name: 'cs_wishlist_v1', storage: safeStorage, partialize: (s) => ({ ids: s.ids }) },
  ),
);
