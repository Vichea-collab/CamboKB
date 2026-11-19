import { Home, Package, ShoppingBag, UserRound, type LucideIcon } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';
import { useMe } from '../features/auth/auth';
import { useCart } from '../features/cart/cart-store';
import { t } from '../shared/lib/strings';
import { useUi } from '../shared/lib/ui-store';

/**
 * Pages that already have a bottom bar of their own (product: add to cart, checkout: place order) or are a
 * focused form (log in, sign up) don't get the navigation, so two bars never stack.
 */
const NO_NAV = /^\/(products\/|checkout|orders\/|login|signup|forgot-password)/;

export const useBottomNavVisible = () => !NO_NAV.test(useLocation().pathname);

const tab = (active: boolean) =>
  `relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${active ? 'text-yellow' : 'text-muted'}`;

function Tab({ to, end, icon: Icon, label }: { to: string; end?: boolean; icon: LucideIcon; label: string }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => tab(isActive)}>
      <Icon className="size-5" strokeWidth={2.2} aria-hidden />
      <span className="max-w-full truncate px-0.5">{label}</span>
    </NavLink>
  );
}

/** The shop's app-style navigation on phones (and in the Telegram Mini App). Tablets and desktops use the header. */
export function BottomNav() {
  const visible = useBottomNavVisible();
  const me = useMe();
  const count = useCart((s) => s.count());
  const openCart = useUi((s) => s.openCart);
  if (!visible) return null;
  return (
    <nav
      aria-label={t.nav.main}
      className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-[repeat(4,minmax(0,1fr))] border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <Tab to="/" end icon={Home} label={t.nav.home} />
      <Tab to="/account/orders" icon={Package} label={t.nav.ordersTab} />
      <button type="button" onClick={openCart} aria-label={t.nav.cartLabel(count)} className={tab(false)}>
        <span className="relative">
          <ShoppingBag className="size-5" strokeWidth={2.2} aria-hidden />
          {count > 0 && (
            <span
              key={count}
              className="bump absolute -right-2.5 -top-1.5 grid min-w-4 place-items-center rounded-full bg-yellow px-1 text-[10px] font-extrabold leading-4 text-yellow-ink tabular-nums"
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </span>
        <span className="max-w-full truncate px-0.5">{t.nav.cart}</span>
      </button>
      {me.data ? <Tab to="/account" end icon={UserRound} label={t.nav.account} /> : <Tab to="/login" icon={UserRound} label={t.nav.login} />}
    </nav>
  );
}
