import { useCart } from '../stores/cart';
import { useUi } from '../stores/ui';
import { t } from './strings';

export function useAddToCart() {
  const add = useCart((s) => s.add);
  const showToast = useUi((s) => s.showToast);
  return (p: { id: string; name: string }, qty = 1) => {
    add(p.id, qty);
    showToast(t.product.added(p.name));
  };
}
