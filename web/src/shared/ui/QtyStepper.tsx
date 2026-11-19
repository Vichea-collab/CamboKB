import { Minus, Plus } from 'lucide-react';
import { MAX_QTY } from '../../features/cart/cart-store';
import { t } from '../lib/strings';

/** − 1 + control. `compact` is the pill used on product cards. */
export function QtyStepper({ value, onChange, max = MAX_QTY, label, compact }: { value: number; onChange: (n: number) => void; max?: number; label: string; compact?: boolean }) {
  const btn = `grid place-items-center text-ink transition-colors hover:bg-white/10 active:bg-white/15 disabled:opacity-35 ${compact ? 'size-9' : 'size-10'}`;
  return (
    <div
      className={`inline-flex items-center overflow-hidden rounded-xl ${compact ? 'bg-yellow/10 ring-1 ring-yellow/50' : 'bg-surface ring-1 ring-line-strong'}`}
      role="group"
      aria-label={t.qty.forProduct(label)}
    >
      <button type="button" className={btn} onClick={() => onChange(value - 1)} aria-label={t.qty.decrease}>
        <Minus className="size-4" strokeWidth={2.5} aria-hidden />
      </button>
      <span className={`text-center text-sm font-bold tabular-nums ${compact ? 'w-7 text-yellow' : 'w-9'}`} aria-live="polite">
        {value}
      </span>
      <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={t.qty.increase}>
        <Plus className="size-4" strokeWidth={2.5} aria-hidden />
      </button>
    </div>
  );
}
