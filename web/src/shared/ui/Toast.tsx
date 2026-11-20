import { Check } from 'lucide-react';
import { useEffect } from 'react';
import { useUi } from '../lib/ui-store';

export function Toast() {
  const toast = useUi((s) => s.toast);
  const clear = useUi((s) => s.clearToast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(clear, 2200);
    return () => clearTimeout(id);
  }, [toast, clear]);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(var(--hdr-h,56px)+0.75rem)] z-[60] flex justify-center px-4"
    >
      {toast && (
        <div
          key={toast.id}
          className="flex items-center gap-2.5 rounded-full border border-line-strong bg-raised px-4 py-2.5 text-sm font-semibold shadow-pop motion-safe:animate-[toast_.2s_ease-out]"
        >
          <span className="grid size-5 place-items-center rounded-full bg-green text-bg">
            <Check className="size-3" strokeWidth={3.5} aria-hidden />
          </span>
          {toast.text}
          <style>{`@keyframes toast{from{opacity:0;transform:translateY(-8px)}}`}</style>
        </div>
      )}
    </div>
  );
}
