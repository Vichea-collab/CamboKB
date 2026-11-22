import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { AuthCard, FormError } from '../../shared/ui/FormCard';
import { Spinner } from '../../shared/ui/Page';
import { isApiError } from '../../shared/lib/api';
import { isTelegramMiniApp } from '../../shared/lib/telegram';
import { t } from '../../shared/lib/strings';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';
import { safeNext, useCompleteLogin, useMe, useSetMe } from './auth';
import { TelegramStep } from './TelegramStep';
import { useTelegramVerification } from './useTelegramVerification';

/**
 * The only way in: Continue with Telegram. It logs in an existing customer and signs up a new one
 * (the bot asks a new customer for their phone). The page waits while the customer taps "Log me in"
 * in the bot, then turns the confirmed request into a session.
 */
export default function Login() {
  useDocumentTitle(t.auth.loginTitle);
  const [params, setParams] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const me = useMe();
  const setMe = useSetMe();
  const tg = useTelegramVerification('LOGIN');
  const { claim, reset } = tg;
  const complete = useCompleteLogin();
  const [error, setError] = useState<string>();

  // Arriving from the bot's sign-up button: the link carries a one-time token.
  const linkToken = params.get('t');
  const claimed = useRef<string | null>(null);
  useEffect(() => {
    if (!linkToken || claimed.current === linkToken) return;
    claimed.current = linkToken;
    void claim(linkToken);
    // Take the token out of the address bar: it has been used, and a reload must not look like a retry.
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete('t');
        return n;
      },
      { replace: true },
    );
  }, [linkToken, claim, setParams]);

  // Confirmed in Telegram: start the session once per request.
  const completed = useRef<string | undefined>(undefined);
  const { mutate } = complete;
  useEffect(() => {
    if (tg.status !== 'verified' || !tg.requestId || completed.current === tg.requestId) return;
    completed.current = tg.requestId;
    if (tg.user) {
      setMe(tg.user);
      navigate(next, { replace: true });
      return;
    }
    setError(undefined);
    mutate(tg.requestId, {
      onSuccess: () => navigate(next, { replace: true }),
      onError: (err) => {
        reset();
        setError(
          isApiError(err, 'TELEGRAM_NOT_VERIFIED')
            ? t.auth.expired
            : isApiError(err, 'ACCOUNT_DISABLED')
              ? t.auth.disabled
              : isApiError(err, 'RATE_LIMITED')
                ? t.auth.tooMany
                : (err as Error).message,
        );
      },
    });
  }, [tg.status, tg.requestId, tg.user, mutate, reset, setMe, navigate, next]);

  if (me.data) return <Navigate to={next} replace />;

  const finishing = tg.status === 'verified' || complete.isPending;
  return (
    <AuthCard
      title={t.auth.loginTitle}
      intro={finishing ? undefined : t.auth.loginIntro}
      back={{ to: '/', label: t.product.backToShop }}
      footer={
        <>
          {t.auth.lostTelegram}{' '}
          <Link to="/contact" className="link inline-flex min-h-10 items-center">
            {t.auth.contactShop}
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        <FormError>{error}</FormError>
        {finishing ? (
          <div className="rounded-2xl border border-line bg-bg p-5 text-center" role="status" aria-live="polite">
            <Spinner className="mx-auto mb-3 size-10" />
            <p className="font-bold">{tg.firstName ? t.auth.loggingInAs(tg.firstName) : t.auth.loggingIn}</p>
          </div>
        ) : (
          <TelegramStep
            tg={tg}
            startLabel={t.auth.continueTelegram}
            waitingHelp={isTelegramMiniApp() ? t.auth.loginWaitingHelpMiniApp : t.auth.loginWaitingHelp}
            stuckSteps={t.auth.loginStuckSteps}
          />
        )}
        {!finishing && tg.status !== 'waiting' && (
          <p className="text-center text-xs leading-relaxed text-muted">{t.auth.newCustomerNote}</p>
        )}
      </div>
    </AuthCard>
  );
}
