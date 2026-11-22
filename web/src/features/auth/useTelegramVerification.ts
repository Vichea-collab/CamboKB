import type { PublicUser } from '@cambo/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../shared/lib/api';

export type TgPurpose = 'LOGIN' | 'CHANGE_PHONE' | 'SHARE_LOCATION';
type Status = 'idle' | 'starting' | 'waiting' | 'verified' | 'expired' | 'declined' | 'error';
type StatusResponse = {
  /** DECLINED: the customer tapped "Not me" in the bot (LOGIN). */
  status: 'PENDING' | 'VERIFIED' | 'COMPLETED' | 'EXPIRED' | 'DECLINED';
  /** LOGIN: the 2-digit code the bot shows too, so the customer can tell it is their own request. */
  matchCode?: string;
  phone?: string;
  firstName?: string;
  /** SHARE_LOCATION: what the customer shared in the bot. */
  lat?: number;
  lng?: number;
};
export type SharedLocation = { lat: number; lng: number };
const locationOf = (st: StatusResponse): SharedLocation | undefined =>
  st.lat !== undefined && st.lng !== undefined ? { lat: st.lat, lng: st.lng } : undefined;

const POLL_MS = 2000;
const GIVE_UP_MS = 10 * 60 * 1000;

type TelegramWebApp = { openTelegramLink?: (url: string) => void };
const telegramApp = () => (window as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;

/** Where a finished request leaves the page: a "Not me" tap is told apart from a plain expiry. */
const endOf = (st: StatusResponse): Status | undefined =>
  st.status === 'DECLINED' ? 'declined' : st.status === 'EXPIRED' || st.status === 'COMPLETED' ? 'expired' : undefined;

/**
 * Start a phone verification through the store's Telegram bot and poll until the
 * customer has shared their number (or the link expires).
 */
export function useTelegramVerification(purpose: TgPurpose, phone?: string) {
  const [state, setState] = useState<{
    status: Status;
    deepLink?: string;
    requestId?: string;
    matchCode?: string;
    firstName?: string;
    maskedPhone?: string;
    location?: SharedLocation;
    /** Set when the server already started the session (a bot link claimed for LOGIN). */
    user?: PublicUser;
    error?: unknown;
  }>({
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
            setState((s) => ({ ...s, status: 'verified', maskedPhone: st.phone, firstName: st.firstName, location: locationOf(st) }));
          } else {
            const end = endOf(st);
            if (end) {
              stop();
              setState((s) => ({ ...s, status: end }));
            } else if (st.matchCode) setState((s) => (s.matchCode ? s : { ...s, matchCode: st.matchCode }));
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
          setState({ status: 'verified', requestId: request.requestId, maskedPhone: request.phone, firstName: request.firstName, location: locationOf(request) });
        } else if (request.status === 'PENDING') {
          setState({ status: 'waiting', requestId: request.requestId, matchCode: request.matchCode });
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
      const res = await api<{ requestId: string; deepLink: string; matchCode?: string }>('/auth/telegram/start', {
        method: 'POST',
        body: phone ? { purpose, phone } : { purpose },
      });
      const tg = telegramApp();
      if (tg?.openTelegramLink) tg.openTelegramLink(res.deepLink);
      else window.open(res.deepLink, '_blank', 'noopener');
      setState({ status: 'waiting', deepLink: res.deepLink, requestId: res.requestId, matchCode: res.matchCode });
      poll(res.requestId);
    } catch (error) {
      setState({ status: 'error', error });
    }
  }, [purpose, phone, stop, poll]);

  /**
   * The website end of a sign-up that started in the bot: exchange the one-time link token for the verified
   * request. If the server started the session itself, the answer carries the user.
   */
  const claim = useCallback(
    async (token: string) => {
      stop();
      setState({ status: 'starting' });
      try {
        const res = await api<StatusResponse & { requestId: string; user?: PublicUser }>('/auth/telegram/claim', { method: 'POST', body: { token } });
        setState({ status: 'verified', requestId: res.requestId, maskedPhone: res.phone, firstName: res.firstName, user: res.user });
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
