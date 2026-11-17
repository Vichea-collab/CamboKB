import { normalizePhone, type PublicUser } from '@cambo/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { AuthCard, FieldError, FormError } from '../../shared/ui/FormCard';
import { PhoneInput } from '../../shared/ui/PhoneInput';
import { TelegramStep } from './TelegramStep';
import { useTelegramVerification } from './useTelegramVerification';
import { api, isApiError } from '../../shared/lib/api';
import { useSetMe } from './auth';
import { passwordProblem } from './passwordCheck';
import { t } from '../../shared/lib/strings';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';

export default function ForgotPassword() {
  useDocumentTitle(t.auth.resetTitle);
  const [phone, setPhone] = useState('');
  const valid = Boolean(normalizePhone(phone));
  const tg = useTelegramVerification('RESET', phone);

  return (
    <AuthCard
      title={t.auth.resetTitle}
      intro={tg.status === 'verified' ? t.auth.verifiedReset : t.auth.resetIntro}
      footer={
        <Link to="/login" className="inline-block py-2 font-semibold text-yellow hover:underline">
          {t.auth.loginButton}
        </Link>
      }
    >
      {tg.status === 'verified' && tg.requestId ? (
        <NewPasswordForm requestId={tg.requestId} onRestart={tg.reset} />
      ) : (
        <div className="space-y-4">
          {tg.status !== 'waiting' && (
            <div>
              <label htmlFor="phone" className="label">
                {t.auth.phone}
              </label>
              <PhoneInput id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} invalid={phone.length > 5 && !valid} aria-describedby="phone-error" />
              <FieldError id="phone-error">{phone.length > 5 && !valid ? t.auth.invalidPhone : undefined}</FieldError>
            </div>
          )}
          <TelegramStep tg={tg} startLabel={t.auth.resetStart} disabled={!valid} />
        </div>
      )}
    </AuthCard>
  );
}

function NewPasswordForm({ requestId, onRestart }: { requestId: string; onRestart: () => void }) {
  const navigate = useNavigate();
  const setMe = useSetMe();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password) ?? (password !== confirm ? t.auth.passwordsDiffer : null);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const { user } = await api<{ user: PublicUser }>('/auth/reset/complete', { method: 'POST', body: { requestId, password } });
      setMe(user);
      navigate('/account', { replace: true });
    } catch (err) {
      setError(isApiError(err, 'TELEGRAM_NOT_VERIFIED') ? t.auth.expired : (err as Error).message);
      if (isApiError(err, 'TELEGRAM_NOT_VERIFIED')) onRestart();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError>{error}</FormError>
      <div>
        <label htmlFor="new-password" className="label">
          {t.auth.newPassword}
        </label>
        <input id="new-password" type="password" autoComplete="new-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div>
        <label htmlFor="confirm-password" className="label">
          {t.auth.confirmPassword}
        </label>
        <input id="confirm-password" type="password" autoComplete="new-password" className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {t.auth.resetSave}
      </button>
    </form>
  );
}
