import { create } from 'zustand';

type UiState = {
  cartOpen: boolean;
  toast: { id: number; text: string } | null;
  openCart: () => void;
  closeCart: () => void;
  showToast: (text: string) => void;
  clearToast: () => void;
};

export const useUi = create<UiState>((set) => ({
  cartOpen: false,
  toast: null,
  // The "Added …" toast is redundant once the cart is open, and it would sit on top of the Subtotal.
  openCart: () => set({ cartOpen: true, toast: null }),
  closeCart: () => set({ cartOpen: false }),
  showToast: (text) => set({ toast: { id: Date.now(), text } }),
  clearToast: () => set({ toast: null }),
}));
