import { useCart } from './cart-store';
import { useUi } from '../../shared/lib/ui-store';
import { t } from '../../shared/lib/strings';

export function useAddToCart() {
  const add = useCart((s) => s.add);
  const showToast = useUi((s) => s.showToast);
  return (p: { id: string; name: string }, qty = 1) => {
    add(p.id, qty);
    showToast(t.product.added(p.name));
  };
}
