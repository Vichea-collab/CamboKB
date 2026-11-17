import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { OrderSummary } from '../orders/OrderView';
import { api, apiUrl } from '../../shared/lib/api';
import { t } from '../../shared/lib/strings';
import type { Order } from '../../shared/lib/types';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';

export default function OrderDetailPage() {
  const { number = '' } = useParams();
  useDocumentTitle(number);
  const order = useQuery({ queryKey: ['orders', number], queryFn: () => api<Order>(`/orders/${encodeURIComponent(number)}`) });
  if (order.isError) return <p className="py-10 text-center text-muted">{(order.error as Error).message}</p>;
  if (!order.data) return <p className="py-10 text-center text-muted">{t.common.loading}</p>;
  return (
    <div>
      <Link to="/account/orders" className="-ml-1 mb-2 inline-flex min-h-10 items-center rounded-lg px-1 text-sm font-semibold text-muted hover:text-ink">
        ← {t.account.orders}
      </Link>
      <h1 className="mb-4 font-display text-2xl font-bold">{order.data.number}</h1>
      <OrderSummary
        order={order.data}
        actions={
          <div className="space-y-3">
            {order.data.payment?.method === 'KHQR' && order.data.payment.status === 'PENDING' && order.data.status === 'PENDING' && (
              <Link to={`/orders/${encodeURIComponent(number)}/pay`} className="btn-primary w-full">
                {t.pay.payNow}
              </Link>
            )}
            <a href={apiUrl(`/orders/${encodeURIComponent(number)}/invoice.pdf`)} target="_blank" rel="noopener" className="btn-ghost w-full">
              📄 {t.account.invoice}
            </a>
          </div>
        }
      />
    </div>
  );
}
