import { useEffect, useState } from 'react';
import { t } from '../../shared/lib/strings';
import { Spinner } from '../../shared/ui/Page';
import type { useTelegramVerification } from './useTelegramVerification';

/** Shared "verify with Telegram" step: start button, waiting state, retry. */
/** True once `active` has been on for `ms` without changing. */
function useAfter(active: boolean, ms: number) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!active) return;
    const id = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(id);
  }, [active, ms]);
  return late;
}

export function TelegramStep({
  tg,
  startLabel,
  disabled,
  waitingHelp = t.auth.waitingHelp,
  stuckSteps = t.auth.stuckSteps,
}: {
  tg: ReturnType<typeof useTelegramVerification>;
  startLabel: string;
  disabled?: boolean;
  /** What to do in Telegram while this page waits. */
  waitingHelp?: string;
  stuckSteps?: readonly string[];
}) {
  const stuck = useAfter(tg.status === 'waiting', 20_000);
  if (tg.status === 'waiting') {
    return (
      <div
        className="rounded-2xl border border-line bg-bg p-5 text-center"
        aria-live="polite"
        role="status"
      >
        <Spinner className="mx-auto mb-3 size-10" />
        <p className="font-bold">{t.auth.waiting}</p>
        <p className="mt-1 text-sm text-muted">{waitingHelp}</p>
        {tg.matchCode && (
          <div className="mt-4 rounded-xl bg-surface p-3 ring-1 ring-line">
            <p className="text-sm text-muted">{t.auth.matchCodeLabel}</p>
            <p className="mt-1 font-display text-4xl font-extrabold tracking-[0.2em] tabular-nums">
              {tg.matchCode}
            </p>
          </div>
        )}
        {stuck && (
          <div className="mt-4 rounded-xl bg-yellow/8 p-3 text-left text-sm ring-1 ring-yellow/25">
            <p className="font-bold text-yellow">{t.auth.stuckTitle}</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-ink/90">
              {stuckSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        )}
        {tg.deepLink && (
          <p className="mt-4 text-sm text-muted">
            {t.auth.openTelegramHint}{' '}
            <a href={tg.deepLink} target="_blank" rel="noopener noreferrer" className="link">
              {t.auth.openTelegram}
            </a>
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {tg.status === 'expired' && (
        <p role="alert" className="text-sm font-medium text-danger">
          {t.auth.expired}
        </p>
      )}
      {tg.status === 'declined' && (
        <p role="alert" className="text-sm font-medium text-danger">
          {t.auth.declined}
        </p>
      )}
      {tg.status === 'error' && (
        <p role="alert" className="text-sm font-medium text-danger">
          {(tg.error as Error)?.message ?? t.common.error}
        </p>
      )}
      <button
        type="button"
        onClick={tg.start}
        disabled={disabled || tg.status === 'starting'}
        className="btn w-full bg-[#2aabee] text-white hover:bg-[#229ed9]"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
          <path d="M9.8 15.6 9.4 20c.6 0 .8-.3 1.1-.6l2.6-2.5 5.4 4c1 .5 1.7.3 2-.9l3.6-17c.3-1.5-.5-2-1.5-1.7L1.4 9.6C0 10.2 0 11 1.2 11.4l5.4 1.7L19 5.3c.6-.4 1.1-.2.7.2" />
        </svg>
        {tg.status === 'expired' || tg.status === 'declined' ? t.auth.startAgain : startLabel}
      </button>
    </div>
  );
}
