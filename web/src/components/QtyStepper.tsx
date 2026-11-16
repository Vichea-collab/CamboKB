import { MAX_QTY } from '../stores/cart';

export function QtyStepper({ value, onChange, max = MAX_QTY, label }: { value: number; onChange: (n: number) => void; max?: number; label: string }) {
  const btn = 'grid size-8 place-items-center rounded-lg text-lg font-bold text-ink hover:bg-raised disabled:opacity-35';
  return (
    <div className="inline-flex items-center rounded-xl border border-line bg-bg" role="group" aria-label={`Quantity for ${label}`}>
      <button type="button" className={btn} onClick={() => onChange(value - 1)} aria-label="Decrease quantity">
        −
      </button>
      <span className="w-7 text-center text-sm font-bold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Increase quantity">
        +
      </button>
    </div>
  );
}
