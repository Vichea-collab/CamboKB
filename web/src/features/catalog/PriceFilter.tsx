import { Tag, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useIsDesktop } from '../../shared/lib/useIsDesktop';
import { t } from '../../shared/lib/strings';
import { Drawer } from '../../shared/ui/Drawer';

type Props = {
  /** Dollars as typed in the address bar, '' when not set. */
  min: string;
  max: string;
  onApply: (min: string, max: string) => void;
};

/** What the shop's prices look like (most items are under $25), so the quick picks are useful. */
const PRESETS = [
  { min: '', max: '10' },
  { min: '10', max: '25' },
  { min: '25', max: '50' },
  { min: '50', max: '' },
];
const presetLabel = (p: { min: string; max: string }) =>
  !p.min
    ? t.home.priceUnder(Number(p.max))
    : !p.max
      ? t.home.priceOver(Number(p.min))
      : t.home.priceRange(Number(p.min), Number(p.max));

/** A number of dollars with at most two decimals, or '' when what was typed is not one. */
export function cleanDollars(raw: string): string {
  const m = raw
    .trim()
    .replace(/^\$/, '')
    .match(/^(\d{1,6})(?:\.(\d{1,2}))?$/);
  return m ? (m[2] ? `${Number(m[1])}.${m[2]}` : String(Number(m[1]))) : '';
}

function PriceForm({ min, max, onApply, onClose }: Props & { onClose: () => void }) {
  const [from, setFrom] = useState(min);
  const [to, setTo] = useState(max);
  const apply = (a: string, b: string) => {
    let lo = cleanDollars(a);
    let hi = cleanDollars(b);
    if (lo && hi && Number(lo) > Number(hi)) [lo, hi] = [hi, lo];
    onApply(lo, hi);
    onClose();
  };
  const input = 'field h-11 w-full';
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        apply(from, to);
      }}
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label={t.home.price}>
        {PRESETS.map((p) => {
          const on = p.min === min && p.max === max;
          return (
            <button
              key={`${p.min}-${p.max}`}
              type="button"
              className="chip"
              aria-pressed={on}
              onClick={() => apply(p.min, p.max)}
            >
              {presetLabel(p)}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold text-muted">
          {t.home.priceFrom}
          <input
            className={`${input} mt-1`}
            inputMode="decimal"
            autoComplete="off"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="0"
          />
        </label>
        <label className="text-sm font-semibold text-muted">
          {t.home.priceTo}
          <input
            className={`${input} mt-1`}
            inputMode="decimal"
            autoComplete="off"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={t.home.priceAny}
          />
        </label>
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          className="btn-ghost flex-1"
          onClick={() => apply('', '')}
          disabled={!min && !max && !from && !to}
        >
          {t.home.priceClear}
        </button>
        <button type="submit" className="btn-primary flex-1">
          {t.home.priceApply}
        </button>
      </div>
    </form>
  );
}

/**
 * A "Price" button next to Sort. On phones it opens a bottom sheet; on desktop a small panel under the button.
 * The range lives in the address bar (?min=10&max=50), so results can be shared and back/forward works.
 */
export function PriceFilter(props: Props) {
  const { min, max } = props;
  const [open, setOpen] = useState(false);
  const desktop = useIsDesktop();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const active = Boolean(min || max);
  const showPanel = open && desktop;

  useEffect(() => {
    if (!showPanel) return;
    const r = button.current?.getBoundingClientRect();
    if (r)
      setBox({
        top: r.bottom + 6,
        left: Math.max(8, Math.min(r.right - 320, window.innerWidth - 328)),
      });
    const close = () => setOpen(false);
    const outside = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!panel.current?.contains(n) && !button.current?.contains(n)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
      setBox(null);
    };
  }, [showPanel]);

  useEffect(() => {
    if (showPanel && box) panel.current?.querySelector<HTMLElement>('input')?.focus();
  }, [showPanel, box]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={t.home.price}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-surface px-3 text-sm font-semibold text-ink ring-1 hover:ring-line-strong ${active ? 'ring-yellow/70' : 'ring-line'}`}
      >
        <Tag className="size-4 text-muted" aria-hidden />
        <span className={active ? 'max-w-[9rem] truncate' : 'hidden sm:inline'} data-price-label>
          {active ? t.home.priceActive(min, max) : t.home.price}
        </span>
      </button>
      {showPanel &&
        box &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={t.home.price}
            style={{ position: 'fixed', top: box.top, left: box.left, width: 320 }}
            className="z-[60] rounded-2xl border border-line-strong bg-surface p-4 shadow-pop"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-ink">{t.home.price}</h2>
              <button
                type="button"
                className="icon-btn rounded-full"
                aria-label={t.common.close}
                onClick={() => setOpen(false)}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <PriceForm {...props} onClose={() => setOpen(false)} />
          </div>,
          document.body,
        )}
      <Drawer open={open && !desktop} onClose={() => setOpen(false)} title={t.home.price} sheet>
        <PriceForm {...props} onClose={() => setOpen(false)} />
      </Drawer>
    </>
  );
}
