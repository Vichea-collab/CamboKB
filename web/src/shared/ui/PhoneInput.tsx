import { forwardRef, type InputHTMLAttributes } from 'react';

/** Accepts local (012 345 678) or international (+855…) formats; the server normalizes. */
export const PhoneInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function PhoneInput(
  { invalid, className = '', ...props },
  ref,
) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[15px] font-semibold text-muted" aria-hidden>
        🇰🇭
      </span>
      <input
        ref={ref}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="012 345 678"
        aria-invalid={invalid || undefined}
        className={`field pl-11 tabular-nums ${className}`}
        {...props}
      />
    </div>
  );
});
