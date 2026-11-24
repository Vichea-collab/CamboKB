import type { ReactNode } from 'react';
import { EmptyState, LoadingState } from '../../../shared/ui/Page';
import type { SkeletonShape } from '../../../shared/ui/Skeleton';
export { formatDateTime as fmtDate } from '../../../shared/lib/format';

export { PageHeader } from '../../../shared/ui/Page';

/** Admin shorthand: an empty list's message. */
export function Empty({ children }: { children: ReactNode }) {
  return <EmptyState title={children} />;
}

/** Admin shorthand: what shows while something loads. */
export function Loading({ shape }: { shape: SkeletonShape }) {
  return <LoadingState shape={shape} />;
}

/** `compact` tables are narrow enough for a phone (few short columns); others scroll sideways inside their box. */
export function Table({
  head,
  children,
  compact,
}: {
  head: ReactNode;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="panel overflow-x-auto">
      <table className={`w-full text-left text-sm ${compact ? '' : 'min-w-[640px]'}`}>
        <thead className="border-b border-line text-xs font-semibold text-muted">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const th = 'px-4 py-3 font-semibold';
export const td = 'px-4 py-3 align-middle';

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-green' : 'bg-raised'}`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[22px]' : 'left-0.5'}`}
      />
    </button>
  );
}

export const dollars = (cents: number) => (cents / 100).toFixed(2);
export const toCents = (v: string) => Math.round(Number(v || 0) * 100);
