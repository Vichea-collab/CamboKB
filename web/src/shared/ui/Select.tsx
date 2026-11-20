import { Check, ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
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

/**
 * A dropdown that opens as a bottom sheet (the same one the shop's sort uses) instead of the browser's own
 * list, so every choice looks and feels the same on phones and in the Telegram Mini App. It is a button that
 * announces a listbox; the options are radios inside the sheet.
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
  const current = options.find((o) => o.value === value);
  const heading = title ?? ariaLabel ?? '';
  return (
    <>
      <button
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
      <Drawer open={open} onClose={() => setOpen(false)} title={heading} sheet>
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
