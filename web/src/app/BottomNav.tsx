import { Home, Package, Search, ShoppingBag, UserRound, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
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

/** On the shop page, Search keeps the category and sort already chosen; from anywhere else it starts clean. */
function useSearchLink() {
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(pathname === '/' ? search : '');
  params.set('focus', 'search');
  return `/?${params}`;
}

const cell = 'group relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold outline-none';

/** The icon sits on a pill that fills in yellow for the page you are on, like the system bars of the phone. */
function Glyph({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return (
    <span
      className={`grid h-8 w-14 place-items-center rounded-full transition-[background-color,transform] duration-200 group-active:scale-90 group-focus-visible:ring-2 group-focus-visible:ring-yellow ${active ? 'bg-yellow/15' : ''}`}
    >
      <Icon className="size-[22px]" strokeWidth={active ? 2.6 : 2.1} aria-hidden />
    </span>
  );
}

const Label = ({ children }: { children: ReactNode }) => <span className="max-w-full truncate px-0.5 leading-none">{children}</span>;

function Tab({ to, end, icon, label }: { to: string; end?: boolean; icon: LucideIcon; label: string }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `${cell} ${isActive ? 'text-yellow' : 'text-muted'}`}>
      {({ isActive }) => (
        <>
          <Glyph icon={icon} active={isActive} />
          <Label>{label}</Label>
        </>
      )}
    </NavLink>
  );
}

/**
 * The shop's app-style navigation on phones (and in the Telegram Mini App): home, search, orders and account,
 * with the cart as a raised yellow key in the middle. Tablets and desktops use the header.
 */
export function BottomNav() {
  const visible = useBottomNavVisible();
  const me = useMe();
  const count = useCart((s) => s.count());
  const openCart = useUi((s) => s.openCart);
  const searchTo = useSearchLink();
  if (!visible) return null;
  return (
    <nav
      aria-label={t.nav.main}
      className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-[repeat(5,minmax(0,1fr))] border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <Tab to="/" end icon={Home} label={t.nav.home} />
      {/* Never "current": it only takes you to the search box. */}
      <Link to={searchTo} className={`${cell} text-muted`}>
        <Glyph icon={Search} active={false} />
        <Label>{t.nav.search}</Label>
      </Link>
      <button type="button" onClick={openCart} aria-label={t.nav.cartLabel(count)} className={`${cell} text-yellow`}>
        <span className="relative -mt-6 grid size-14 place-items-center rounded-full bg-yellow text-yellow-ink shadow-[0_4px_0_0_var(--color-yellow-edge),0_8px_18px_-4px_rgb(0_0_0/0.55)] ring-4 ring-surface transition-transform duration-100 group-active:translate-y-1 group-active:shadow-[0_0_0_0_var(--color-yellow-edge)] group-focus-visible:ring-yellow">
          <ShoppingBag className="size-6" strokeWidth={2.4} aria-hidden />
          {count > 0 && (
            <span
              key={count}
              className="bump absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-bg px-1 text-[11px] font-extrabold leading-5 text-yellow tabular-nums ring-2 ring-yellow"
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </span>
        <Label>{t.nav.cart}</Label>
      </button>
      <Tab to="/account/orders" icon={Package} label={t.nav.ordersTab} />
      {/* Only a confirmed guest sees "Log in": while the session is loading, nobody gets a wrong label. */}
      {me.data === null ? <Tab to="/login" icon={UserRound} label={t.nav.login} /> : <Tab to="/account" end icon={UserRound} label={t.nav.account} />}
    </nav>
  );
}
