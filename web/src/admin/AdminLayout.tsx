import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { useMe } from '../lib/auth';

const NAV = [
  ['', 'Dashboard'],
  ['orders', 'Orders'],
  ['products', 'Products'],
  ['categories', 'Categories'],
  ['banners', 'Banners'],
  ['promos', 'Promo codes'],
  ['customers', 'Customers'],
  ['reports', 'Reports'],
  ['settings', 'Settings'],
] as const;

export function AdminLayout({ children }: { children: ReactNode }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const nav = (
    <nav className="flex flex-col gap-1" aria-label="Admin">
      {NAV.map(([to, label]) => (
        <NavLink
          key={to}
          to={`/admin${to ? `/${to}` : ''}`}
          end={to === ''}
          onClick={() => setOpen(false)}
          className={({ isActive }) => `rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors ${isActive ? 'bg-yellow text-bg' : 'text-muted hover:bg-raised hover:text-ink'}`}
        >
          {label}
        </NavLink>
      ))}
      <Link to="/" className="mt-3 flex items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 text-sm font-semibold text-ink hover:bg-raised">
        <span aria-hidden>🛒</span> Go to shop
      </Link>
    </nav>
  );
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="no-print hidden border-r border-line bg-surface px-4 py-5 lg:block">
        <Brand />
        <div className="mt-6">{nav}</div>
        <p className="mt-8 px-3.5 text-xs text-muted">Signed in as {me.data?.name}</p>
      </aside>
      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <div className="flex gap-2">
          <Link to="/" className="btn-ghost px-3 py-2 text-sm">
            Shop
          </Link>
          <button className="btn-ghost px-3 py-2 text-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="admin-menu">
            Menu
          </button>
        </div>
      </header>
      {open && (
        <div id="admin-menu" className="no-print border-b border-line bg-surface px-4 py-3 lg:hidden">
          {nav}
        </div>
      )}
      <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

function Brand() {
  return (
    <Link to="/admin" className="flex items-center gap-2.5">
      <img src="/logo.svg" alt="" className="size-9 rounded-xl" />
      <span className="font-display text-lg font-bold leading-none">
        Cambo<span className="text-yellow">Supply</span>
        <span className="block text-xs font-semibold text-muted">Admin</span>
      </span>
    </Link>
  );
}
