import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { t } from '../lib/strings';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
};

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

/** Bottom sheet on phones, side panel from 768px. Traps focus, closes on Esc and backdrop. */
export function Drawer({ open, onClose, title, children, footer, wide }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px] motion-safe:animate-[fade_.15s_ease-out]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-3xl border-t border-line-strong bg-surface shadow-pop motion-safe:animate-[sheet_.22s_cubic-bezier(.2,.8,.2,1)] md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-full ${wide ? 'md:max-w-xl' : 'md:max-w-md'} md:rounded-none md:rounded-l-3xl md:border-l md:border-t-0 md:motion-safe:animate-[panel_.22s_cubic-bezier(.2,.8,.2,1)]`}
      >
        <div
          className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-raised md:hidden"
          aria-hidden
        />
        <div className="flex items-center justify-between px-5 pb-3 pt-3 md:pt-6">
          <h2 id={titleId} className="title-section text-xl">
            {title}
          </h2>
          <button onClick={onClose} className="btn-icon" aria-label={t.common.close}>
            <X className="size-[18px]" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && (
          <div className="border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
      <style>{`@keyframes fade{from{opacity:0}}@keyframes sheet{from{transform:translateY(100%)}}@keyframes panel{from{transform:translateX(100%)}}`}</style>
    </div>,
    document.body,
  );
}
