import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Ellipsis,
  Image as ImageIcon,
  LayoutDashboard,
  Package,
  Receipt,
  Settings as SettingsIcon,
  ShoppingBag,
  Tags,
  Ticket,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { api } from '../../shared/lib/api';
import { Drawer } from '../../shared/ui/Drawer';
import { Toast } from '../../shared/ui/Toast';
import { brandParts } from '../../shared/ui/Wordmark';
import { useMe } from '../auth/auth';
import { useAdminLive } from './useAdminLive';

type Item = { to: string; label: string; icon: LucideIcon };

// Daily work first, then the things you set up once.
const MAIN: Item[] = [
  { to: '', label: 'Dashboard', icon: LayoutDashboard },
  { to: 'orders', label: 'Orders', icon: Receipt },
  { to: 'products', label: 'Products', icon: Package },
  { to: 'customers', label: 'Customers', icon: Users },
  { to: 'reports', label: 'Reports', icon: BarChart3 },
];
const SETUP: Item[] = [
  { to: 'categories', label: 'Categories', icon: Tags },
  { to: 'banners', label: 'Banners', icon: ImageIcon },
  { to: 'promos', label: 'Promo codes', icon: Ticket },
  { to: 'settings', label: 'Settings', icon: SettingsIcon },
];
// Phones: four daily tabs, everything else under "More".
const TABS = MAIN.slice(0, 4);

const tabCell = 'group relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold outline-none min-[340px]:text-[11px]';
/** The icon's box: the current page is yellow (set by the tab) and bolder; it shrinks a little under the finger. */
const pill = () =>
  'relative grid h-8 w-10 place-items-center rounded-xl transition-transform duration-150 group-active:scale-90 group-focus-visible:ring-2 group-focus-visible:ring-yellow';

const href = (to: string) => `/admin${to ? `/${to}` : ''}`;

/** Orders waiting for you: shown as a badge so you notice without opening the page. */
function usePendingCount() {
  const counts = useQuery({
    queryKey: ['admin', 'orders', 'counts'],
    queryFn: () => api<Record<string, number>>('/admin/orders/counts'),
    refetchInterval: 30_000,
  });
  return counts.data?.PENDING ?? 0;
}

function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-yellow px-1.5 text-[11px] font-extrabold leading-5 text-yellow-ink tabular-nums">
      {n > 99 ? '99+' : n}
    </span>
  );
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const me = useMe();
  const [more, setMore] = useState(false);
  const pending = usePendingCount();
  const live = useAdminLive();
  const { pathname } = useLocation();
  const moreActive =
    SETUP.some((i) => pathname.startsWith(href(i.to))) || pathname.startsWith(href('reports'));

  const link = (i: Item, onNavigate?: () => void) => (
    <NavLink
      key={i.to}
      to={href(i.to)}
      end={i.to === ''}
      onClick={onNavigate}
      className={({ isActive }) =>
        `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${isActive ? 'bg-yellow/12 text-yellow ring-1 ring-yellow/30' : 'text-muted hover:bg-raised hover:text-ink'}`
      }
    >
      <i.icon className="size-[18px] shrink-0" aria-hidden />
      {i.label}
      {i.to === 'orders' && <Badge n={pending} />}
    </NavLink>
  );

  return (
    <div lang="en" className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <a
        href="#admin-main"
        className="sr-only z-50 rounded-xl bg-yellow px-4 py-2 font-semibold text-yellow-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface/60 px-3 py-5 lg:flex">
        <Brand />
        <nav className="mt-6 flex flex-col gap-1" aria-label="Admin">
          {MAIN.map((i) => link(i))}
          <p className="mb-1 mt-5 px-3 text-xs font-semibold text-muted">Set up the shop</p>
          {SETUP.map((i) => link(i))}
        </nav>
        <div className="mt-auto space-y-3">
          <Link to="/" className="btn-ghost w-full justify-start gap-2.5 px-3 text-sm">
            <ShoppingBag className="size-[18px] text-yellow" aria-hidden /> Go to shop
          </Link>
          <p
            className="flex items-center gap-2 truncate px-3 text-xs text-muted"
            title={
              live
                ? 'New orders appear here as they happen'
                : 'Reconnecting… the page still refreshes every 30 seconds'
            }
          >
            <span
              className={`size-2 shrink-0 rounded-full ${live ? 'bg-green' : 'bg-muted'}`}
              aria-hidden
            />
            <span className="sr-only">
              {live ? 'Live updates on' : 'Live updates reconnecting'}.{' '}
            </span>
            <span className="truncate">Signed in as {me.data?.name}</span>
          </p>
        </div>
      </aside>

      {/* Phone top bar */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur lg:hidden">
        <Brand />
        <Link to="/" className="btn-ghost btn-sm">
          <ShoppingBag className="size-4 text-yellow" aria-hidden /> Shop
        </Link>
      </header>

      <main
        id="admin-main"
        tabIndex={-1}
        className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-6 outline-none sm:px-6 lg:px-8 lg:pb-10"
      >
        {children}
      </main>

      {/* Phone tab bar */}
      <nav
        className="no-print bottom-bar fixed inset-x-0 bottom-0 z-30 grid grid-cols-[repeat(5,minmax(0,1fr))] border-t border-line bg-surface/95 backdrop-blur lg:hidden"
        aria-label="Admin"
      >
        {TABS.map((i) => (
          <NavLink
            key={i.to}
            to={href(i.to)}
            end={i.to === ''}
            className={({ isActive }) => `${tabCell} ${isActive ? 'text-yellow' : 'text-muted'}`}
          >
            {({ isActive }) => (
              <>
                <span className={pill()}>
                  <i.icon className="size-6" strokeWidth={isActive ? 2.4 : 1.9} aria-hidden />
                  {i.to === 'orders' && pending > 0 && (
                    <span className="absolute -right-1 -top-0.5 grid min-w-4 place-items-center rounded-full bg-yellow px-1 text-[10px] font-extrabold leading-4 text-yellow-ink tabular-nums ring-2 ring-surface">
                      {pending > 99 ? '99+' : pending}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate px-0.5 leading-[1.3]">{i.label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button onClick={() => setMore(true)} className={`${tabCell} ${moreActive ? 'text-yellow' : 'text-muted'}`} aria-haspopup="dialog">
          <span className={pill()}>
            <Ellipsis className="size-6" strokeWidth={moreActive ? 2.4 : 1.9} aria-hidden />
          </span>
          <span className="max-w-full truncate px-0.5 leading-[1.3]">More</span>
        </button>
      </nav>

      <Drawer open={more} onClose={() => setMore(false)} title="More">
        <nav className="flex flex-col gap-1 pb-2" aria-label="More admin pages">
          {[MAIN[4]!, ...SETUP].map((i) => link(i, () => setMore(false)))}
        </nav>
      </Drawer>
      <Toast />
    </div>
  );
}

function Brand() {
  const { first, last } = brandParts();
  return (
    <Link to="/admin" className="flex items-center gap-2.5 px-1">
      <img src="/logo.png" alt="" className="size-9 rounded-xl border border-line" />
      <span className="font-display text-base font-extrabold leading-[1.12] tracking-[-0.02em]">
        <span className="block">{first} </span>
        <span className="text-yellow">{last}</span>{' '}
        <span className="text-xs font-semibold tracking-normal text-muted">Admin</span>
      </span>
    </Link>
  );
}
