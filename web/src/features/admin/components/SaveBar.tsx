import { useEffect } from 'react';

/** Warn before closing the tab with unsaved edits. */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}

/**
 * Stays in reach while a long form scrolls. On phones it floats above the tab bar; on desktop it sits
 * at the bottom of the page content. It only asks for attention when there is something to save.
 */
export function SaveBar({
  dirty,
  saving,
  label,
  disabled,
  message,
}: {
  dirty: boolean;
  saving: boolean;
  label: string;
  disabled?: boolean;
  /** Replaces the default status text, e.g. for a form that has nothing saved yet. */
  message?: string;
}) {
  return (
    <div className="no-print fixed inset-x-0 bottom-[calc(3.5rem+var(--bar-safe))] z-20 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur lg:sticky lg:bottom-0 lg:mt-6 lg:rounded-2xl lg:border lg:px-5">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3">
        <p className={`text-sm font-semibold ${dirty ? 'text-yellow' : 'text-muted'}`} aria-live="polite">
          {message ?? (dirty ? 'You have unsaved changes' : 'All changes saved')}
        </p>
        <button type="submit" className="btn-primary min-h-11 px-6 py-2.5 text-sm" disabled={saving || disabled || !dirty}>
          {saving ? 'Saving…' : label}
        </button>
      </div>
    </div>
  );
}
