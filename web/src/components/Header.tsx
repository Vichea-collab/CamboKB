import { Link } from 'react-router';
import { useMe } from '../lib/auth';
import { t } from '../lib/strings';
import { useCart } from '../stores/cart';
import { useUi } from '../stores/ui';

export function BrandMark() {
  return (
    <Link to="/" className="flex items-center gap-3 rounded-xl" aria-label={`${t.brand.name} home`}>
      <img src="/logo.svg" alt="" className="size-12 rounded-[14px] border border-line shadow-pop sm:size-[54px]" />
      <span className="flex flex-col">
        <span className="font-display text-[1.45rem] font-bold leading-none tracking-[-0.03em] sm:text-[1.6rem]">
          Cambo<span className="text-yellow">Supply</span>
        </span>
        <span className="mt-1 text-[0.72rem] font-semibold text-muted">{t.brand.tagline}</span>
      </span>
    </Link>
  );
}

export function Header() {
  const count = useCart((s) => s.count());
  const openCart = useUi((s) => s.openCart);
  const me = useMe();
  return (
    <header className="flex items-center justify-between gap-3 py-4">
      <BrandMark />
      <nav className="flex items-center gap-2">
        {me.data?.role === 'ADMIN' && (
          <Link to="/admin" className="rounded-full border border-yellow/40 px-3 py-2 text-xs font-semibold text-yellow hover:bg-yellow/10 sm:px-3.5 sm:text-sm">
            {t.nav.admin}
          </Link>
        )}
        <Link
          to={me.data ? '/account' : '/login'}
          className="grid size-10 place-items-center rounded-full border border-line bg-surface text-muted hover:text-ink"
          aria-label={me.data ? t.nav.account : t.nav.login}
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
          </svg>
        </Link>
        <button
          onClick={openCart}
          className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-bold text-yellow shadow-pop hover:bg-raised"
          aria-label={`${t.nav.cart}, ${count} items`}
        >
          <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
            <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2" />
            <circle cx="10" cy="20.5" r="1.3" />
            <circle cx="17" cy="20.5" r="1.3" />
          </svg>
          <span className="tabular-nums">{count}</span>
        </button>
      </nav>
    </header>
  );
}
