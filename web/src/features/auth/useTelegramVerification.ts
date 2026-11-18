import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../shared/lib/api';

export type TgPurpose = 'SIGNUP' | 'RESET' | 'CHANGE_PHONE';
type Status = 'idle' | 'starting' | 'waiting' | 'verified' | 'expired' | 'error';
type StatusResponse = { status: 'PENDING' | 'VERIFIED' | 'COMPLETED' | 'EXPIRED'; phone?: string; firstName?: string };

const POLL_MS = 2000;
const GIVE_UP_MS = 10 * 60 * 1000;

type TelegramWebApp = { openTelegramLink?: (url: string) => void };
const telegramApp = () => (window as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;

/**
 * Start a phone verification through the store's Telegram bot and poll until the
 * customer has shared their number (or the link expires).
 */
export function useTelegramVerification(purpose: TgPurpose, phone?: string) {
  const [state, setState] = useState<{ status: Status; deepLink?: string; requestId?: string; firstName?: string; maskedPhone?: string; error?: unknown }>({
    status: 'idle',
  });
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const startedAt = useRef(0);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => stop, [stop]);

  /** Ask every 2 s whether the number was shared, until verified, expired or given up. */
  const poll = useCallback(
    (requestId: string) => {
      startedAt.current = Date.now();
      timer.current = setInterval(async () => {
        if (Date.now() - startedAt.current > GIVE_UP_MS) {
          stop();
          setState((s) => ({ ...s, status: 'expired' }));
          return;
        }
        try {
          const st = await api<StatusResponse>(`/auth/telegram/${requestId}/status`);
          if (st.status === 'VERIFIED') {
            stop();
            setState((s) => ({ ...s, status: 'verified', maskedPhone: st.phone, firstName: st.firstName }));
          } else if (st.status === 'EXPIRED' || st.status === 'COMPLETED') {
            stop();
            setState((s) => ({ ...s, status: 'expired' }));
          }
        } catch {
          // Transient network error: keep polling until the give-up time.
        }
      }, POLL_MS);
    },
    [stop],
  );

  // A reload, or a phone that suspended the page while the customer was in Telegram, must not
  // lose a verification that already happened: ask the server what this browser has open.
  useEffect(() => {
    let live = true;
    api<{ request: (StatusResponse & { requestId: string }) | null }>(`/auth/telegram/current?purpose=${purpose}`)
      .then(({ request }) => {
        if (!live || !request) return;
        if (request.status === 'VERIFIED') {
          setState({ status: 'verified', requestId: request.requestId, maskedPhone: request.phone, firstName: request.firstName });
        } else if (request.status === 'PENDING') {
          setState({ status: 'waiting', requestId: request.requestId });
          poll(request.requestId);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [purpose, poll]);

  const start = useCallback(async () => {
    stop();
    setState({ status: 'starting' });
    try {
      const res = await api<{ requestId: string; deepLink: string }>('/auth/telegram/start', {
        method: 'POST',
        body: phone ? { purpose, phone } : { purpose },
      });
      const tg = telegramApp();
      if (tg?.openTelegramLink) tg.openTelegramLink(res.deepLink);
      else window.open(res.deepLink, '_blank', 'noopener');
      setState({ status: 'waiting', deepLink: res.deepLink, requestId: res.requestId });
      poll(res.requestId);
    } catch (error) {
      setState({ status: 'error', error });
    }
  }, [purpose, phone, stop, poll]);

  /** The website end of a sign-up that started in the bot: exchange the one-time link token for the verified request. */
  const claim = useCallback(
    async (token: string) => {
      stop();
      setState({ status: 'starting' });
      try {
        const res = await api<StatusResponse & { requestId: string }>('/auth/telegram/claim', { method: 'POST', body: { token } });
        setState({ status: 'verified', requestId: res.requestId, maskedPhone: res.phone, firstName: res.firstName });
      } catch {
        setState({ status: 'expired' });
      }
    },
    [stop],
  );

  const reset = useCallback(() => {
    stop();
    setState({ status: 'idle' });
  }, [stop]);

  return { ...state, start, claim, reset };
}
