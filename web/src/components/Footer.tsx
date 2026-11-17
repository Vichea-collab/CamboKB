import { Link } from 'react-router';
import { useMe } from '../lib/auth';
import { telHref, useStore } from '../lib/store';
import { t } from '../lib/strings';

const LINKS = [
  ['/contact', 'Contact'],
  ['/delivery', 'Delivery'],
  ['/warranty', 'Warranty & returns'],
  ['/privacy', 'Privacy'],
] as const;

export function Footer() {
  const store = useStore();
  const info = store.data?.info;
  const me = useMe();
  return (
    <footer className="mt-14 border-t border-line pt-8 text-sm text-muted">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <p className="font-display text-lg font-bold text-ink">{store.data?.storeName ?? t.brand.name}</p>
          <p>{t.brand.tagline}</p>
          {info?.phone && (
            <p>
              <a className="font-semibold text-yellow hover:underline" href={telHref(info.phone)}>
                {info.phone}
              </a>
            </p>
          )}
          {info?.hours && <p className="whitespace-pre-line">{info.hours}</p>}
        </div>
        <nav aria-label="Store information" className="-my-2 flex flex-wrap gap-x-6">
          {LINKS.map(([to, label]) => (
            <Link key={to} to={to} className="inline-flex min-h-11 items-center hover:text-ink">
              {label}
            </Link>
          ))}
          {me.data?.role === 'ADMIN' && (
            <Link to="/admin" className="inline-flex min-h-11 items-center font-semibold text-yellow hover:underline">
              {t.nav.admin}
            </Link>
          )}
        </nav>
      </div>
      <p className="mt-8 text-xs">© {new Date().getFullYear()} {store.data?.storeName ?? t.brand.name}</p>
    </footer>
  );
}
