import { t } from '../../shared/lib/strings';
import type { useTelegramVerification } from './useTelegramVerification';

/** Shared "verify with Telegram" step: start button, waiting state, retry. */
export function TelegramStep({ tg, startLabel, disabled }: { tg: ReturnType<typeof useTelegramVerification>; startLabel: string; disabled?: boolean }) {
  if (tg.status === 'waiting') {
    return (
      <div className="rounded-2xl border border-line bg-bg p-5 text-center" aria-live="polite">
        <div className="mx-auto mb-3 size-10 animate-spin rounded-full border-[3px] border-raised border-t-yellow motion-reduce:animate-none" aria-hidden />
        <p className="font-bold">{t.auth.waiting}</p>
        <p className="mt-1 text-sm text-muted">{t.auth.waitingHelp}</p>
        {tg.deepLink && (
          <p className="mt-4 text-sm text-muted">
            {t.auth.openTelegramHint}{' '}
            <a href={tg.deepLink} target="_blank" rel="noopener noreferrer" className="font-semibold text-yellow hover:underline">
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
      {tg.status === 'error' && (
        <p role="alert" className="text-sm font-medium text-danger">
          {(tg.error as Error)?.message ?? t.common.error}
        </p>
      )}
      <button type="button" onClick={tg.start} disabled={disabled || tg.status === 'starting'} className="btn w-full bg-[#2aabee] text-white hover:bg-[#229ed9]">
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
          <path d="M9.8 15.6 9.4 20c.6 0 .8-.3 1.1-.6l2.6-2.5 5.4 4c1 .5 1.7.3 2-.9l3.6-17c.3-1.5-.5-2-1.5-1.7L1.4 9.6C0 10.2 0 11 1.2 11.4l5.4 1.7L19 5.3c.6-.4 1.1-.2.7.2" />
        </svg>
        {tg.status === 'expired' ? t.auth.startAgain : startLabel}
      </button>
    </div>
  );
}
