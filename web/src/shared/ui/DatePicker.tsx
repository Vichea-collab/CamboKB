import { phnomPenhDate } from '@cambo/shared';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useIsDesktop } from '../lib/useIsDesktop';
import { Drawer } from './Drawer';

type Props = {
  /** `YYYY-MM-DD`, or empty for no date. */
  value: string;
  onChange: (value: string) => void;
  /** Earliest and latest pickable day, `YYYY-MM-DD`. */
  min?: string;
  max?: string;
  id?: string;
  'aria-label'?: string;
  /** Title of the sheet. Falls back to `aria-label`. */
  title?: string;
  className?: string;
  placeholder?: string;
  /** Show a Clear button. Turn off where a date is always needed. */
  allowClear?: boolean;
};

const LOCALE = 'en-GB';
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (v: string): { y: number; m: number } | undefined => {
  const hit = /^(\d{4})-(\d{2})-\d{2}$/.exec(v);
  return hit ? { y: Number(hit[1]), m: Number(hit[2]) - 1 } : undefined;
};
const format = (y: number, m: number, d: number | undefined, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', ...opts }).format(Date.UTC(y, m, d ?? 1));

/**
 * A date field that opens a calendar instead of the browser's own date popup: a bottom sheet on phones and in the
 * Telegram Mini App (the same one the dropdowns use), a small calendar under the field on desktop. Works on plain `YYYY-MM-DD` strings, so no time zone can shift a day.
 */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  id,
  'aria-label': ariaLabel,
  title,
  className = 'field',
  placeholder = 'Select date',
  allowClear = true,
}: Props) {
  const today = phnomPenhDate(new Date());
  const [open, setOpen] = useState(false);
  const desktop = useIsDesktop();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const [view, setView] = useState(() => parse(value) ?? parse(today)!);
  const heading = title ?? ariaLabel ?? '';
  const selected = parse(value);

  const openSheet = () => {
    setView(parse(value) ?? parse(today)!);
    setOpen(true);
  };
  const shift = (by: number) =>
    setView(({ y, m }) => {
      const n = y * 12 + m + by;
      return { y: Math.floor(n / 12), m: n % 12 };
    });
  const allowed = (day: string) => (!min || day >= min) && (!max || day <= max);
  const pick = (day: string) => {
    onChange(day);
    setOpen(false);
  };

  const popover = open && desktop;
  // Desktop calendar: sit under the field (above it when there is no room), close on an outside click,
  // Escape, scroll or resize.
  useEffect(() => {
    if (!popover) return;
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const height = popRef.current?.offsetHeight ?? 400;
      const below = r.bottom + 6;
      const top = below + height > window.innerHeight ? Math.max(8, r.top - 6 - height) : below;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 296 - 8));
      setBox({ top, left });
    };
    place();
    const close = () => setOpen(false);
    const outside = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!popRef.current?.contains(n) && !buttonRef.current?.contains(n)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      setBox(null);
    };
  }, [popover]);

  const lead = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const count = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: count }, (_, i) => i + 1),
  ];

  const sizeCls = desktop ? 'size-9 text-sm' : 'size-11 text-[15px]';
  const footer = (
    <div className="flex items-center justify-between gap-3">
      {allowClear && value ? (
        <button type="button" className="link min-h-11 px-2 text-sm" onClick={() => pick('')}>
          Clear
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        className="link min-h-11 px-2 text-sm disabled:opacity-40"
        disabled={!allowed(today)}
        onClick={() => pick(today)}
      >
        Today
      </button>
    </div>
  );
  const calendar = (
    <>
      <div className="flex items-center justify-between pb-3">
        <button
          type="button"
          className="btn-icon"
          aria-label="Previous month"
          onClick={() => shift(-1)}
        >
          <ChevronLeft className="size-[18px]" aria-hidden />
        </button>
        <p className="font-display text-base font-extrabold" aria-live="polite">
          {format(view.y, view.m, 1, { month: 'long', year: 'numeric' })}
        </p>
        <button type="button" className="btn-icon" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight className="size-[18px]" aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center" role="grid" aria-label={heading}>
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="pb-1 text-xs font-semibold text-muted" aria-hidden>
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`blank-${i}`} />;
          const day = iso(view.y, view.m, d);
          const on = day === value;
          const ok = allowed(day);
          return (
            <button
              key={day}
              type="button"
              disabled={!ok}
              aria-pressed={on}
              aria-label={format(view.y, view.m, d, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              aria-current={day === today ? 'date' : undefined}
              onClick={() => pick(day)}
              className={`mx-auto grid ${sizeCls} place-items-center rounded-full font-semibold tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                on
                  ? 'bg-yellow text-yellow-ink'
                  : `hover:bg-raised ${day === today ? 'text-yellow ring-1 ring-yellow/60' : 'text-ink'}`
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openSheet}
        className={`${className} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`min-w-0 flex-1 truncate ${value ? '' : 'text-muted/70'}`}>
          {selected && value
            ? format(selected.y, selected.m, Number(value.slice(8)), {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            : placeholder}
        </span>
        <CalendarDays className="size-[18px] shrink-0 text-muted" aria-hidden />
      </button>
      {popover &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label={heading}
            style={{
              position: 'fixed',
              top: box?.top ?? 0,
              left: box?.left ?? 0,
              visibility: box ? 'visible' : 'hidden',
            }}
            className="z-[60] w-[296px] rounded-2xl border border-line-strong bg-surface p-3 shadow-pop"
          >
            {calendar}
            <div className="mt-2 border-t border-line pt-1">{footer}</div>
          </div>,
          document.body,
        )}
      <Drawer
        open={open && !desktop}
        onClose={() => setOpen(false)}
        title={heading}
        sheet
        footer={footer}
      >
        {calendar}
      </Drawer>
    </>
  );
}
