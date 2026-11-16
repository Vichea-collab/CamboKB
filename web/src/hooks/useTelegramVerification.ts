import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

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
      startedAt.current = Date.now();

      timer.current = setInterval(async () => {
        if (Date.now() - startedAt.current > GIVE_UP_MS) {
          stop();
          setState((s) => ({ ...s, status: 'expired' }));
          return;
        }
        try {
          const st = await api<StatusResponse>(`/auth/telegram/${res.requestId}/status`);
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
    } catch (error) {
      setState({ status: 'error', error });
    }
  }, [purpose, phone, stop]);

  const reset = useCallback(() => {
    stop();
    setState({ status: 'idle' });
  }, [stop]);

  return { ...state, start, reset };
}
