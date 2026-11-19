import { normalizePhone } from '@cambo/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthCard, FieldError, FormError } from '../../shared/ui/FormCard';
import { PhoneInput } from '../../shared/ui/PhoneInput';
import { isApiError } from '../../shared/lib/api';
import { safeNext, useLogin } from './auth';
import { t } from '../../shared/lib/strings';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';

export default function Login() {
  useDocumentTitle(t.auth.loginTitle);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const login = useLogin();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [phoneError, setPhoneError] = useState<string>();
  const next = safeNext(params.get('next'));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!normalizePhone(phone)) {
      setPhoneError(t.auth.invalidPhone);
      return;
    }
    setPhoneError(undefined);
    login.mutate({ phone, password }, { onSuccess: () => navigate(next, { replace: true }) });
  };

  const error = login.error
    ? isApiError(login.error, 'INVALID_CREDENTIALS')
      ? t.auth.wrongCredentials
      : isApiError(login.error, 'RATE_LIMITED')
        ? t.auth.tooMany
        : (login.error as Error).message
    : undefined;

  return (
    <AuthCard
      title={t.auth.loginTitle}
      back={{ to: '/', label: t.product.backToShop }}
      footer={
        <>
          {t.auth.noAccount}{' '}
          <Link
            to={`/signup${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="link inline-flex min-h-10 items-center"
          >
            {t.auth.signupLink}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{error}</FormError>
        <div>
          <label htmlFor="phone" className="label">
            {t.auth.phone}
          </label>
          <PhoneInput
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            invalid={!!phoneError}
            aria-describedby="phone-error"
            required
          />
          <FieldError id="phone-error">{phoneError}</FieldError>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="label">
              {t.auth.password}
            </label>
            <Link
              to="/forgot-password"
              className="inline-flex min-h-10 items-center rounded text-sm font-semibold text-muted hover:text-ink"
            >
              {t.auth.forgot}
            </Link>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button
          type="submit"
          className="btn-primary w-full"
          disabled={login.isPending || !phone || !password}
        >
          {t.auth.loginButton}
        </button>
      </form>
    </AuthCard>
  );
}
