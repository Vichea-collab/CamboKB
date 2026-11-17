import type { PublicUser } from '@cambo/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthCard, FieldError, FormError } from '../components/AuthCard';
import { TelegramStep } from '../components/TelegramStep';
import { useTelegramVerification } from '../hooks/useTelegramVerification';
import { api, isApiError } from '../lib/api';
import { safeNext, useSetMe } from '../lib/auth';
import { passwordProblem } from '../lib/passwordCheck';
import { t } from '../lib/strings';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export default function Signup() {
  useDocumentTitle(t.auth.signupTitle);
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const tg = useTelegramVerification('SIGNUP');

  return (
    <AuthCard
      title={t.auth.signupTitle}
      intro={tg.status === 'verified' ? undefined : t.auth.signupIntro}
      footer={
        <>
          {t.auth.haveAccount}{' '}
          <Link to={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="inline-block py-2 font-semibold text-yellow hover:underline">
            {t.auth.loginButton}
          </Link>
        </>
      }
    >
      {tg.status === 'verified' && tg.requestId ? (
        <SetPasswordForm requestId={tg.requestId} firstName={tg.firstName} maskedPhone={tg.maskedPhone} next={next} onRestart={tg.reset} />
      ) : (
        <TelegramStep tg={tg} startLabel={t.auth.signupButton} />
      )}
    </AuthCard>
  );
}

function SetPasswordForm({ requestId, firstName, maskedPhone, next, onRestart }: { requestId: string; firstName?: string; maskedPhone?: string; next: string; onRestart: () => void }) {
  const navigate = useNavigate();
  const setMe = useSetMe();
  const [name, setName] = useState(firstName ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldError, setFieldError] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const pw = passwordProblem(password);
    const errs = { password: pw ?? undefined, confirm: password !== confirm ? t.auth.passwordsDiffer : undefined };
    setFieldError(errs);
    if (errs.password || errs.confirm) return;
    setBusy(true);
    setError(undefined);
    try {
      const { user } = await api<{ user: PublicUser }>('/auth/signup/complete', { method: 'POST', body: { requestId, name: name.trim(), password } });
      setMe(user);
      navigate(next, { replace: true });
    } catch (err) {
      if (isApiError(err, 'TELEGRAM_NOT_VERIFIED')) {
        setError(t.auth.expired);
        onRestart();
      } else setError(isApiError(err, 'PHONE_TAKEN') ? t.auth.phoneTaken : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {maskedPhone && <p className="rounded-xl bg-green/10 px-3.5 py-2.5 text-sm font-semibold text-green">✓ {t.auth.verifiedAs(maskedPhone)}</p>}
      <FormError>{error}</FormError>
      <div>
        <label htmlFor="name" className="label">
          {t.auth.name}
        </label>
        <input id="name" className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
      </div>
      <div>
        <label htmlFor="new-password" className="label">
          {t.auth.newPassword}
        </label>
        <input id="new-password" type="password" autoComplete="new-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!fieldError.password || undefined} aria-describedby="pw-error" />
        <FieldError id="pw-error">{fieldError.password}</FieldError>
      </div>
      <div>
        <label htmlFor="confirm-password" className="label">
          {t.auth.confirmPassword}
        </label>
        <input id="confirm-password" type="password" autoComplete="new-password" className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!fieldError.confirm || undefined} aria-describedby="confirm-error" />
        <FieldError id="confirm-error">{fieldError.confirm}</FieldError>
      </div>
      <button type="submit" className="btn-primary w-full" disabled={busy || !name.trim()}>
        {t.auth.createAccount}
      </button>
    </form>
  );
}
