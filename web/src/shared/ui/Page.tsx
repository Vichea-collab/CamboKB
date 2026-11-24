import { ChevronLeft, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { t } from '../lib/strings';

export { LoadingState } from './Skeleton';

/**
 * The building blocks every page uses, in the shop and in the admin, so they look and behave
 * the same: one title style, one back link, one way to show "loading", "nothing here" and "failed".
 */

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="no-print -ml-1.5 mb-1 inline-flex min-h-10 items-center gap-0.5 rounded-xl pr-2 text-sm font-semibold text-muted transition-colors hover:text-ink"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {children}
    </Link>
  );
}

export function PageHeader({
  title,
  description,
  back,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {back && <BackLink to={back.to}>{back.label}</BackLink>}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="title-page">{title}</h1>
          {description && (
            <p className="mt-1.5 max-w-prose text-[15px] leading-relaxed text-muted">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** A titled panel: the unit pages are built from. */
export function Section({
  title,
  description,
  actions,
  children,
  className = '',
  as: As = 'section',
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div';
}) {
  return (
    <As className={`panel p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            {title && <h2 className="title-section">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </As>
  );
}

export function Spinner({ className = 'size-6' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-[3px] border-raised border-t-yellow motion-reduce:animate-none ${className}`}
      aria-hidden
    />
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center px-6 py-10 text-center">
      {Icon && (
        <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-raised text-muted">
          <Icon className="size-6" aria-hidden />
        </span>
      )}
      <p className="font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message = t.common.error,
  onRetry,
}: {
  message?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="panel flex flex-col items-center border-danger/25 px-6 py-10 text-center"
    >
      <p className="font-semibold text-danger">{message}</p>
      {onRetry && (
        <button type="button" className="btn-ghost mt-5" onClick={onRetry}>
          {t.home.retry}
        </button>
      )}
    </div>
  );
}

const TONES = {
  neutral: 'bg-raised text-muted',
  yellow: 'bg-yellow/15 text-yellow',
  green: 'bg-green/15 text-green',
  danger: 'bg-danger/15 text-danger',
  sky: 'bg-sky-400/15 text-sky-300',
  violet: 'bg-violet-400/15 text-violet-300',
  indigo: 'bg-indigo-400/15 text-indigo-300',
} as const;
export type Tone = keyof typeof TONES;

export function Badge({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={`badge ${TONES[tone]} ${className}`}>{children}</span>;
}

/** Label above a value, used in summaries (Phone / Telegram / Orders). */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="mt-1 truncate font-semibold tabular-nums">{children}</p>
    </div>
  );
}
