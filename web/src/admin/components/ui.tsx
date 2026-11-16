import type { ReactNode } from 'react';

export function PageHeader({ title, actions, back }: { title: string; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5">
      {back}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">{title}</h1>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="panel p-8 text-center text-muted">{children}</div>;
}

export function Loading() {
  return <p className="py-10 text-center text-muted">Loading…</p>;
}

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-line text-xs text-muted">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const th = 'px-4 py-3 font-semibold';
export const td = 'px-4 py-3 align-middle';

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-green' : 'bg-raised'}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export const dollars = (cents: number) => (cents / 100).toFixed(2);
export const toCents = (v: string) => Math.round(Number(v || 0) * 100);
export const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Phnom_Penh', dateStyle: 'medium', timeStyle: 'short' });
