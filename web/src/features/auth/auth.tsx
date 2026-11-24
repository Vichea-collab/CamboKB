import type { PublicUser } from '@cambo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { api } from '../../shared/lib/api';
import { telegramInitData } from '../../shared/lib/telegram';
import { LoadingState } from '../../shared/ui/Skeleton';

export const ME_KEY = ['me'] as const;

let miniAppTried = false;

/**
 * Inside Telegram (the store opened as a Mini App), log a guest in silently with Telegram's signed
 * launch data. Tried once per page load, so logging out in the Mini App stays logged out. Any failure
 * (account not linked yet, stale data) just leaves a guest, who then gets the bot link on /login.
 */
async function miniAppLogin(): Promise<PublicUser | null> {
  if (miniAppTried) return null;
  miniAppTried = true;
  const initData = telegramInitData();
  if (!initData) return null;
  try {
    return (await api<{ user: PublicUser }>('/auth/telegram/webapp', { method: 'POST', body: { initData } })).user;
  } catch {
    return null;
  }
}

/** Test hook: let the next session check try the Mini App login again. */
export function resetMiniAppLogin() {
  miniAppTried = false;
}

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<PublicUser | null> => {
      // /auth/session answers 200 with user: null for a guest, so no 401 shows up in the console.
      const user = (await api<{ user: PublicUser | null }>('/auth/session')).user;
      return user ?? (await miniAppLogin());
    },
    staleTime: 5 * 60_000,
  });
}

export function useSetMe() {
  const qc = useQueryClient();
  return (user: PublicUser | null) => qc.setQueryData(ME_KEY, user);
}

/** Turn a request the customer confirmed in the bot into a session. */
export function useCompleteLogin() {
  const setMe = useSetMe();
  return useMutation({
    mutationFn: (requestId: string) => api<{ user: PublicUser }>('/auth/login/complete', { method: 'POST', body: { requestId } }),
    onSuccess: ({ user }) => setMe(user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (all?: boolean) => api(all ? '/auth/logout-all' : '/auth/logout', { method: 'POST' }),
    onSettled: () => {
      qc.setQueryData(ME_KEY, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'products' && q.queryKey[0] !== 'catalog' });
    },
  });
}

/** `loading` is the skeleton of the page behind the guard. */
type GuardProps = { children: ReactNode; loading?: ReactNode };

export function RequireAuth({ children, loading = <LoadingState /> }: GuardProps) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <>{loading}</>;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

export function RequireAdmin({ children, loading = <LoadingState /> }: GuardProps) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <>{loading}</>;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (me.data.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Only allow same-site relative redirects after login. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
