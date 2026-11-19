import { formatUsd } from '@cambo/shared';
import { Link, useNavigate } from 'react-router';
import { useCartProducts } from '../catalog/api';
import { t } from '../../shared/lib/strings';
import { useCart } from './cart-store';
import { useUi } from '../../shared/lib/ui-store';
import { ShoppingBag } from 'lucide-react';
import { Drawer } from '../../shared/ui/Drawer';
import { EmptyState, LoadingState } from '../../shared/ui/Page';
import { QtyStepper } from '../../shared/ui/QtyStepper';

export function CartDrawer() {
  const open = useUi((s) => s.cartOpen);
  const close = useUi((s) => s.closeCart);
  return open ? <CartContents onClose={close} /> : null;
}

function CartContents({ onClose }: { onClose: () => void }) {
  const { lines, subtotalCents, isLoading } = useCartProducts();
  const setQty = useCart((s) => s.setQty);
  const navigate = useNavigate();
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const blocked = lines.some((l) => l.product.isSoldOut);

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${t.cart.title}${count ? ` (${count})` : ''}`}
      footer={
        lines.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between text-base font-bold">
              <span>{t.cart.subtotal}</span>
              <span className="font-display text-xl tabular-nums">{formatUsd(subtotalCents)}</span>
            </div>
            <p className="mb-3 text-xs text-muted">{t.cart.priceNote}</p>
            <button
              className="btn-primary w-full"
              disabled={blocked}
              onClick={() => {
                onClose();
                navigate('/checkout');
              }}
            >
              {t.cart.checkout}
            </button>
          </div>
        )
      }
    >
      {isLoading ? (
        <LoadingState />
      ) : lines.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title={t.cart.empty}
          action={
            <Link to="/" onClick={onClose} className="btn-ghost">
              {t.cart.browse}
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {lines.map(({ product: p, quantity }) => (
            <li key={p.id} className="flex gap-3 py-3.5">
              <Link
                to={`/products/${p.slug}`}
                onClick={onClose}
                className="media size-[72px] shrink-0 rounded-xl"
              >
                {p.image && <img src={p.image.sm} alt="" className="size-full object-cover" />}
              </Link>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-bold leading-snug">{p.name}</p>
                {p.isSoldOut ? (
                  <p className="mt-1 text-xs font-semibold text-danger">{t.product.soldOut}</p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted tabular-nums">
                    {t.cart.each(formatUsd(p.priceCents))}
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <QtyStepper value={quantity} onChange={(n) => setQty(p.id, n)} label={p.name} />
                  <span className="font-display font-bold tabular-nums">
                    {formatUsd(p.priceCents * quantity)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
