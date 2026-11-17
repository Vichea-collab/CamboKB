import { formatPhone, type PublicUser } from '@cambo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { FormError } from '../../components/AuthCard';
import { TelegramStep } from '../../components/TelegramStep';
import { useTelegramVerification } from '../../hooks/useTelegramVerification';
import { api, isApiError } from '../../lib/api';
import { ME_KEY, useLogout, useMe, useSetMe } from '../../lib/auth';
import { passwordProblem } from '../../lib/passwordCheck';
import { t } from '../../lib/strings';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useUi } from '../../stores/ui';
import { AccountNav } from './AccountNav';

type Profile = { user: PublicUser; defaultAddress: { region: 'PHNOM_PENH' | 'PROVINCE'; addressLine: string; lat: number | null; lng: number | null } | null };

export default function ProfilePage() {
  useDocumentTitle(t.account.title);
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api<Profile>('/me') });
  const logout = useLogout();
  const navigate = useNavigate();
  const me = useMe();

  if (!profile.data) return <p className="py-10 text-center text-muted">{t.common.loading}</p>;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 font-display text-2xl font-bold">{t.account.title}</h1>
      <AccountNav />
      <div className="space-y-4">
        {me.data?.role === 'ADMIN' && (
          <Link to="/admin" className="panel flex items-center justify-between gap-3 border-yellow/40 p-4 font-semibold text-yellow hover:bg-yellow/5">
            <span>Open the admin dashboard</span>
            <span aria-hidden>→</span>
          </Link>
        )}
        <NameForm profile={profile.data} />
        <PhoneSection phone={profile.data.user.phone} />
        <PasswordForm />
        <section className="panel flex flex-wrap gap-3 p-5">
          <button className="btn-ghost" onClick={() => logout.mutate(false, { onSettled: () => navigate('/') })}>
            {t.nav.logout}
          </button>
          <button className="btn-danger" onClick={() => logout.mutate(true, { onSettled: () => navigate('/') })}>
            {t.account.logoutAll}
          </button>
        </section>
      </div>
    </div>
  );
}

function NameForm({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const setMe = useSetMe();
  const showToast = useUi((s) => s.showToast);
  const [name, setName] = useState(profile.user.name);
  const [addressLine, setAddressLine] = useState(profile.defaultAddress?.addressLine ?? '');
  const save = useMutation({
    mutationFn: () =>
      api<Profile>('/me', {
        method: 'PATCH',
        body: {
          name: name.trim(),
          defaultAddress: addressLine.trim() ? { region: profile.defaultAddress?.region ?? 'PHNOM_PENH', addressLine: addressLine.trim(), lat: profile.defaultAddress?.lat, lng: profile.defaultAddress?.lng } : null,
        },
      }),
    onSuccess: (p) => {
      qc.setQueryData(['profile'], p);
      setMe(p.user);
      showToast(t.account.saved);
    },
  });
  return (
    <form
      className="panel space-y-4 p-5"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2 className="font-display text-lg font-bold">{t.account.profile}</h2>
      <FormError>{save.error ? (save.error as Error).message : undefined}</FormError>
      <div>
        <label htmlFor="name" className="label">
          {t.auth.name}
        </label>
        <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </div>
      <div>
        <label htmlFor="address" className="label">
          {t.checkout.address}
        </label>
        <textarea id="address" rows={2} className="field resize-none" value={addressLine} onChange={(e) => setAddressLine(e.target.value)} placeholder={t.checkout.addressPlaceholder} maxLength={500} />
      </div>
      <button className="btn-primary" disabled={save.isPending || !name.trim()}>
        {t.account.save}
      </button>
    </form>
  );
}

function PhoneSection({ phone }: { phone: string }) {
  const [changing, setChanging] = useState(false);
  const tg = useTelegramVerification('CHANGE_PHONE');
  const qc = useQueryClient();
  const showToast = useUi((s) => s.showToast);
  const [error, setError] = useState<string>();

  const { status, requestId, reset } = tg;
  useEffect(() => {
    if (status !== 'verified' || !requestId) return;
    api<{ user: PublicUser }>('/auth/me/phone/complete', { method: 'POST', body: { requestId } })
      .then(({ user }) => {
        qc.setQueryData(ME_KEY, user);
        qc.invalidateQueries({ queryKey: ['profile'] });
        showToast(t.account.phoneChanged);
        setChanging(false);
        reset();
      })
      .catch((err) => setError(isApiError(err) ? err.message : t.common.error));
  }, [status, requestId, reset, qc, showToast]);

  return (
    <section className="panel p-5">
      <h2 className="font-display text-lg font-bold">{t.auth.phone}</h2>
      <p className="mt-1 text-lg font-semibold tabular-nums">{formatPhone(phone)}</p>
      <FormError>{error}</FormError>
      {changing ? (
        <div className="mt-4">
          <TelegramStep tg={tg} startLabel={t.account.changePhone} />
        </div>
      ) : (
        <button className="btn-ghost mt-3" onClick={() => setChanging(true)}>
          {t.account.changePhone}
        </button>
      )}
    </section>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string>();
  const showToast = useUi((s) => s.showToast);
  const change = useMutation({
    mutationFn: () => api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setError(undefined);
      showToast(t.account.passwordChanged);
    },
    onError: (err) => setError(isApiError(err, 'INVALID_CREDENTIALS') ? 'Your current password is wrong.' : (err as Error).message),
  });
  return (
    <form
      className="panel space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        const problem = passwordProblem(next);
        if (problem) return setError(problem);
        change.mutate();
      }}
    >
      <h2 className="font-display text-lg font-bold">{t.account.changePassword}</h2>
      <FormError>{error}</FormError>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="current-password" className="label">
            {t.account.currentPassword}
          </label>
          <input id="current-password" type="password" autoComplete="current-password" className="field" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <label htmlFor="new-password" className="label">
            {t.auth.newPassword}
          </label>
          <input id="new-password" type="password" autoComplete="new-password" className="field" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
      </div>
      <button className="btn-ghost" disabled={change.isPending || !current || !next}>
        {t.account.changePassword}
      </button>
    </form>
  );
}
