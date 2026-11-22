import { Clock, Phone, Send } from 'lucide-react';
import { Link } from 'react-router';
import { useMe } from '../features/auth/auth';
import { telHref, useStore } from '../features/info/store-api';
import { t } from '../shared/lib/strings';

const links = () =>
  [
    ['/contact', t.footer.contact],
    ['/delivery', t.footer.delivery],
    ['/warranty', t.footer.warranty],
    ['/privacy', t.footer.privacy],
  ] as const;

const heading = 'text-xs font-semibold uppercase tracking-wider text-ink/70';

export function Footer() {
  const store = useStore();
  const info = store.data?.info;
  const me = useMe();
  const name = store.data?.storeName ?? t.brand.name;
  const telegram = info?.telegram?.replace(/^@/, '');
  return (
    <footer className="mt-14 border-t border-line pt-8 text-sm text-muted">
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1.2fr]">
        <div className="space-y-1.5">
          <p className="font-display text-lg font-bold text-ink">{name}</p>
          <p>{t.brand.tagline}</p>
        </div>

        <nav aria-label={t.footer.info}>
          <p className={heading}>{t.footer.help}</p>
          <ul className="mt-1">
            {links().map(([to, label]) => (
              <li key={to}>
                <Link to={to} className="inline-flex min-h-11 items-center hover:text-ink sm:min-h-9">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {(info?.phone || info?.hours || telegram) && (
          <div className="space-y-3">
            <p className={heading}>{t.footer.contactUs}</p>
            {info?.phone && (
              <div className="flex items-center gap-3">
                <Phone aria-hidden className="size-4 shrink-0 text-yellow" />
                <div>
                  <p className="text-xs">{t.footer.callUs}</p>
                  <a className="font-semibold text-ink hover:text-yellow" href={telHref(info.phone)}>
                    {info.phone}
                  </a>
                </div>
              </div>
            )}
            {info?.hours && (
              <div className="flex items-start gap-3">
                <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-yellow" />
                <p className="whitespace-pre-line">{info.hours}</p>
              </div>
            )}
            {telegram && (
              <a
                href={`https://t.me/${telegram}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 font-semibold text-ink transition-colors hover:border-yellow hover:text-yellow"
              >
                <Send aria-hidden className="size-4" />
                {t.footer.telegram}
              </a>
            )}
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between gap-4 border-t border-line py-4 text-xs">
        <p>
          © {new Date().getFullYear()} {name}
        </p>
        {me.data?.role === 'ADMIN' && (
          <Link to="/admin" className="inline-flex min-h-11 items-center opacity-70 hover:opacity-100 hover:text-ink">
            {t.nav.admin}
          </Link>
        )}
      </div>
    </footer>
  );
}
