import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { Sparkline } from './Sparkline';

/** A number with its label: the dashboard and reports use the same tile. */
export function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  to,
  highlight,
  chart,
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  to?: string;
  highlight?: boolean;
  chart?: number[];
}) {
  const body = (
    <div
      className={`panel relative h-full p-4 transition-colors ${highlight ? 'border-yellow/40' : ''} ${to ? 'hover:border-yellow/60' : ''}`}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-muted">
        {Icon && <Icon className={`size-4 ${highlight ? 'text-yellow' : ''}`} aria-hidden />}
        {label}
      </p>
      <p className="mt-2 font-display text-[1.75rem] leading-none font-extrabold tracking-[-0.03em] tabular-nums sm:text-[1.9rem]">
        {value}
      </p>
      {sub && <p className="mt-1.5 text-xs text-muted">{sub}</p>}
      {chart && chart.length > 1 && <Sparkline values={chart} className="mt-3 h-9 w-full" />}
    </div>
  );
  return to ? (
    <Link to={to} className="block rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}
