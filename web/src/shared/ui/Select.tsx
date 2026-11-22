import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Drawer } from './Drawer';

export type SelectOption = { value: string; label: ReactNode };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Title of the sheet. Falls back to `aria-label`. */
  title?: string;
  id?: string;
  'aria-label'?: string;
  disabled?: boolean;
  /** Replaces the default look (a form field) when the dropdown needs its own, e.g. a pill. */
  className?: string;
  /** Shown when no option matches the value. */
  placeholder?: ReactNode;
};

/** True on screens at least 768px wide (the Tailwind `md` size). Without matchMedia (old browsers, tests) it is false. */
function useIsDesktop() {
  const query = '(min-width: 768px)';
  const [desktop, setDesktop] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return desktop;
}

/**
 * A dropdown that looks the same everywhere instead of using the browser's own list. On phones and in the Telegram
 * Mini App it opens as a bottom sheet (the same one the shop's sort uses); on desktop it opens as a small list right
 * under the button. It is a button that announces a listbox; the options are radios inside the sheet, or options in
 * the list.
 */
export function Select({
  value,
  onChange,
  options,
  title,
  id,
  'aria-label': ariaLabel,
  disabled,
  className = 'field',
  placeholder,
}: Props) {
  const [open, setOpen] = useState(false);
  const desktop = useIsDesktop();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const current = options.find((o) => o.value === value);
  const heading = title ?? ariaLabel ?? '';
  const dropdown = open && desktop;

  // Desktop list: sit under the button, close on an outside click, Escape, scroll or resize.
  useEffect(() => {
    if (!dropdown) return;
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (r) setBox({ top: r.bottom + 6, left: r.left, width: r.width });
    };
    place();
    const close = () => setOpen(false);
    const outside = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!listRef.current?.contains(n) && !buttonRef.current?.contains(n)) close();
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
  }, [dropdown]);

  // Once the list is on screen, put the keyboard on the current option.
  const listShown = dropdown && box !== null;
  useEffect(() => {
    if (!listShown) return;
    const list = listRef.current;
    (
      list?.querySelector<HTMLElement>('[aria-selected="true"]') ??
      list?.querySelector<HTMLElement>('[role="option"]')
    )?.focus();
  }, [listShown]);

  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    );
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`${className} flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-55`}
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? placeholder ?? ''}</span>
        <ChevronDown className="size-[18px] shrink-0 text-muted" aria-hidden />
      </button>
      {dropdown &&
        box &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            aria-label={heading}
            onKeyDown={move}
            style={{ position: 'fixed', top: box.top, left: box.left, minWidth: box.width }}
            className="z-[60] max-h-72 overflow-auto rounded-2xl border border-line-strong bg-surface p-1.5 shadow-pop"
          >
            {options.map((o) => {
              const on = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    buttonRef.current?.focus();
                  }}
                  className={`flex min-h-10 w-full items-center justify-between gap-6 whitespace-nowrap rounded-xl px-3 text-left text-sm font-semibold transition-colors focus-visible:outline-none ${on ? 'bg-yellow/10 text-yellow' : 'text-ink hover:bg-raised focus-visible:bg-raised'}`}
                >
                  {o.label}
                  {on && <Check className="size-4 shrink-0" aria-hidden />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
      <Drawer open={open && !desktop} onClose={() => setOpen(false)} title={heading} sheet>
        <div role="radiogroup" aria-label={heading} className="-mx-1 flex flex-col pb-2">
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`flex min-h-14 items-center justify-between gap-3 rounded-xl px-3 text-left text-base font-semibold transition-colors ${on ? 'bg-yellow/10 text-yellow' : 'text-ink hover:bg-raised'}`}
              >
                {o.label}
                {on && <Check className="size-5 shrink-0" aria-hidden />}
              </button>
            );
          })}
        </div>
      </Drawer>
    </>
  );
}
