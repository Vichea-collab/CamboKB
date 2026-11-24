import { formatUsd } from '@cambo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { TimerOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useCart } from '../cart/cart-store';
import { useStore } from '../info/store-api';
import { formatTime as clock } from '../../shared/lib/format';
import { t } from '../../shared/lib/strings';
import { BackLink, EmptyState, ErrorState, LoadingState } from '../../shared/ui/Page';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';
import { KhqrCard, saveKhqrPng } from './KhqrCard';
import { usePayment, useRenewKhqr } from './usePayment';

function useCountdown(until?: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  if (!until) return null;
  const left = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  return { left, text: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` };
}

export default function PayPage() {
  const { number = '' } = useParams();
  useDocumentTitle(t.pay.title);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const clearCart = useCart((s) => s.clear);
  const payment = usePayment(number);
  const renew = useRenewKhqr(number);
  const store = useStore();
  const countdown = useCountdown(payment.data?.khqr?.expiresAt);
  const p = payment.data;

  useEffect(() => {
    if (p?.status !== 'PAID') return;
    clearCart();
    qc.invalidateQueries({ queryKey: ['orders'] });
    navigate(`/orders/${number}/success?paid=1`, { replace: true });
  }, [p?.status, number, navigate, qc, clearCart]);

  if (payment.isError)
    return (
      <div className="mx-auto max-w-md py-6">
        <ErrorState message={(payment.error as Error).message} onRetry={() => payment.refetch()} />
      </div>
    );
  if (!p) return <LoadingState shape="pay" />;

  if (p.status === 'EXPIRED' || p.status === 'FAILED') {
    return (
      <div className="mx-auto max-w-md py-6 sm:py-10">
        <EmptyState
          icon={TimerOff}
          title={number}
          action={
            <Link to="/" className="btn-primary">
              {t.pay.backToShop}
            </Link>
          }
        >
          {t.pay.expired}
        </EmptyState>
      </div>
    );
  }

  const qrExpired = !p.khqr || (countdown?.left ?? 1) === 0;
  return (
    <div className="mx-auto max-w-md py-4 sm:py-8">
      <div className="mb-2">
        <BackLink to={`/account/orders/${number}`}>{t.invoice.backToOrder}</BackLink>
      </div>
      <h1 className="title-page text-center">{t.pay.title}</h1>
      <p className="mt-1 text-center text-sm text-muted">
        {number} · {formatUsd(p.amountCents)}
      </p>
      {p.payBefore && (
        <p className="mt-1 text-center text-sm text-muted">{t.pay.payBefore(clock(p.payBefore))}</p>
      )}

      <div className="mt-6">
        {!qrExpired && p.khqr ? (
          <>
            <KhqrCard
              qr={p.khqr.qr}
              amountCents={p.amountCents}
              payee={store.data?.storeName ?? t.brand.name}
              orderNumber={number}
            />
            <p
              className="mt-3 text-center text-sm font-semibold tabular-nums text-muted"
              aria-live="polite"
            >
              {countdown && t.pay.expiresIn(countdown.text)}
            </p>
          </>
        ) : (
          <div className="panel p-6 text-center">
            <p className="font-semibold">{t.pay.qrExpired}</p>
            {p.canRenew ? (
              <button
                className="btn-primary mt-4"
                onClick={() => renew.mutate()}
                disabled={renew.isPending}
              >
                {t.pay.renew}
              </button>
            ) : (
              <p className="mt-2 text-sm text-muted">{t.pay.expired}</p>
            )}
            {renew.error && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {(renew.error as Error).message}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 space-y-3 text-center text-sm text-ink/90">
        <p>{t.pay.howTo}</p>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        {p.khqr && !qrExpired && (
          <button
            className="btn-ghost flex-1"
            onClick={() => saveKhqrPng(p.khqr!.qr, `khqr-${number}.png`)}
          >
            {t.pay.save}
          </button>
        )}
        <Link to={`/account/orders/${number}`} className="btn-ghost flex-1">
          {t.pay.viewOrder}
        </Link>
      </div>

      <p
        className="mt-6 flex items-center justify-center gap-2 text-sm text-muted"
        aria-live="polite"
      >
        <span
          className="size-2 animate-pulse rounded-full bg-yellow motion-reduce:animate-none"
          aria-hidden
        />
        {t.pay.waiting}
      </p>
    </div>
  );
}
