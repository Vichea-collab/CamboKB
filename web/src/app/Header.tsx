import { Heart, Package, ShoppingBag, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../features/auth/auth';
import { useCart } from '../features/cart/cart-store';
import { useWishlist } from '../features/wishlist/wishlist-store';
import { t } from '../shared/lib/strings';
import { useUi } from '../shared/lib/ui-store';
import { useBottomNavVisible } from './BottomNav';
import { LanguageToggle } from './LanguageToggle';

/**
 * `compact`: the header also carries account, orders and cart (the pages without a bottom bar), so on a phone
 * only the logo is shown. Otherwise the buttons would be drawn over the name.
 */
export function BrandMark({ tagline = true, compact = false }: { tagline?: boolean; compact?: boolean }) {
  return (
    <Link
      to="/"
      className="flex items-center gap-2.5 rounded-xl"
      aria-label={t.nav.homeLabel(t.brand.name)}
    >
      <img
        src="/logo.png"
        alt=""
        className="size-10 rounded-xl border border-line shadow-pop sm:size-11"
      />
      <span className={`flex flex-col ${compact ? 'max-[429px]:sr-only' : 'max-[339px]:sr-only'}`}>
        <span className="font-display text-[1.35rem] font-extrabold leading-none tracking-[-0.03em] sm:text-[1.5rem]">
          Cambo<span className="text-yellow">Supply</span>
        </span>
        {tagline && (
          <span className="mt-1 hidden text-[0.72rem] font-semibold text-muted sm:block">
            {t.brand.tagline}
          </span>
        )}
      </span>
    </Link>
  );
}

/**
 * Hides when scrolling down, comes back when scrolling up: more room for products on a phone,
 * the cart is never more than a flick away. Publishes its visible height as --hdr so the
 * filter bar can sit right under it.
 */
function useHideOnScroll() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - last;
        if (Math.abs(delta) < 8) return;
        setHidden(y > 160 && delta > 0);
        last = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty('--hdr', hidden ? '0px' : 'var(--hdr-h)');
  }, [hidden]);
  return hidden;
}

export function Header() {
  const count = useCart((s) => s.count());
  const saved = useWishlist((s) => s.ids.length);
  const openCart = useUi((s) => s.openCart);
  const me = useMe();
  const hidden = useHideOnScroll();
  // On phones the bottom bar carries account and cart, so the header drops them there (not where the bar is hidden).
  const navShown = useBottomNavVisible();
  const phoneBar = navShown ? 'max-md:hidden' : '';
  return (
    <header
      className={`sticky top-0 z-40 border-b border-line/70 bg-bg/85 backdrop-blur-md transition-transform duration-200 motion-reduce:transition-none ${hidden ? '-translate-y-full' : ''}`}
    >
      <div className="mx-auto flex h-14 w-full max-w-[1240px] items-center justify-between gap-3 px-3 min-[360px]:px-4 sm:h-16 sm:px-6 lg:px-8">
        <BrandMark compact={!navShown} />
        <nav className="flex items-center gap-1 min-[360px]:gap-2">
          {me.data?.role === 'ADMIN' && (
            <Link to="/admin" className="chip hidden sm:inline-flex">
              {t.nav.admin}
            </Link>
          )}
          <LanguageToggle />
          <Link
            to="/wishlist"
            className="btn-icon relative"
            aria-label={t.nav.wishlistLabel(saved)}
            title={t.nav.wishlist}
          >
            <Heart className="size-[18px]" strokeWidth={2.2} aria-hidden />
            {saved > 0 && (
              <span
                key={saved}
                className="bump absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-extrabold leading-4 text-white tabular-nums"
              >
                {saved}
              </span>
            )}
          </Link>
          {me.data && (
            <Link
              to="/account/orders"
              className={`btn-icon ${phoneBar}`}
              aria-label={t.account.orders}
              title={t.account.orders}
            >
              <Package className="size-[18px]" strokeWidth={2.2} aria-hidden />
            </Link>
          )}
          <Link
            to={me.data ? '/account' : '/login'}
            className={`btn-icon ${phoneBar}`}
            aria-label={me.data ? t.nav.account : t.nav.login}
            title={me.data ? t.nav.account : t.nav.login}
          >
            <UserRound className="size-[18px]" strokeWidth={2.2} aria-hidden />
          </Link>
          <button
            onClick={openCart}
            className={`relative grid size-10 place-items-center rounded-full border border-yellow/40 bg-yellow/10 text-yellow transition-colors hover:bg-yellow/20 ${phoneBar}`}
            aria-label={t.nav.cartLabel(count)}
          >
            <ShoppingBag className="size-[18px]" strokeWidth={2.2} aria-hidden />
            {count > 0 && (
              <span
                key={count}
                className="bump absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-yellow px-1 text-[11px] font-extrabold leading-5 text-yellow-ink tabular-nums"
              >
                {count}
              </span>
            )}
          </button>
        </nav>
      </div>
    </header>
  );
}
