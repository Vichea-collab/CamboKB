import type { PublicUser } from '@cambo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { api } from '../../shared/lib/api';
import { t } from '../../shared/lib/strings';

export const ME_KEY = ['me'] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<PublicUser | null> => {
      // /auth/session answers 200 with user: null for a guest, so no 401 shows up in the console.
      return (await api<{ user: PublicUser | null }>('/auth/session')).user;
    },
    staleTime: 5 * 60_000,
  });
}

export function useSetMe() {
  const qc = useQueryClient();
  return (user: PublicUser | null) => qc.setQueryData(ME_KEY, user);
}

export function useLogin() {
  const setMe = useSetMe();
  return useMutation({
    mutationFn: (input: { phone: string; password: string }) => api<{ user: PublicUser }>('/auth/login', { method: 'POST', body: input }),
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

function FullPageLoading() {
  return <div className="grid min-h-[50dvh] place-items-center text-muted">{t.common.loading}</div>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <FullPageLoading />;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <FullPageLoading />;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (me.data.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Only allow same-site relative redirects after login. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
