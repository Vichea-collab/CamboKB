import { useQuery } from '@tanstack/react-query';
import { FileText, QrCode } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { OrderSummary } from '../orders/OrderView';
import { api } from '../../shared/lib/api';
import { t } from '../../shared/lib/strings';
import type { Order } from '../../shared/lib/types';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';
import { ErrorState, LoadingState, PageHeader } from '../../shared/ui/Page';

export default function OrderDetailPage() {
  const { number = '' } = useParams();
  useDocumentTitle(number);
  const order = useQuery({
    queryKey: ['orders', number],
    queryFn: () => api<Order>(`/orders/${encodeURIComponent(number)}`),
  });
  const back = { to: '/account/orders', label: t.account.orders };
  if (order.isError)
    return (
      <div>
        <PageHeader title={number} back={back} />
        <ErrorState message={(order.error as Error).message} onRetry={() => order.refetch()} />
      </div>
    );
  if (!order.data) return <LoadingState shape="order" />;
  const o = order.data;
  const awaitingPayment =
    o.payment?.method === 'KHQR' && o.payment.status === 'PENDING' && o.status === 'PENDING';
  return (
    <div>
      <PageHeader title={o.number} back={back} />
      <OrderSummary
        order={o}
        actions={
          <div className="space-y-3">
            {awaitingPayment && (
              <Link to={`/orders/${encodeURIComponent(number)}/pay`} className="btn-primary w-full">
                <QrCode className="size-[18px]" aria-hidden />
                {t.pay.payNow}
              </Link>
            )}
            <Link to={`/account/orders/${encodeURIComponent(number)}/invoice`} className="btn-ghost w-full">
              <FileText className="size-[18px]" aria-hidden />
              {t.account.invoice}
            </Link>
          </div>
        }
      />
    </div>
  );
}
