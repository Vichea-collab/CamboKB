import { formatUsd } from '@cambo/shared';

export function Price({ cents, compareAt, className = '' }: { cents: number; compareAt?: number | null; className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span className="font-display font-bold tracking-[-0.01em] tabular-nums">{formatUsd(cents)}</span>
      {compareAt && compareAt > cents ? <s className="text-[0.8em] font-medium text-muted tabular-nums">{formatUsd(compareAt)}</s> : null}
    </span>
  );
}
