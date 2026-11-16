import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { OrderSummary } from '../../components/OrderView';
import { api, apiUrl } from '../../lib/api';
import { t } from '../../lib/strings';
import type { Order } from '../../lib/types';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

export default function OrderDetailPage() {
  const { number = '' } = useParams();
  useDocumentTitle(number);
  const order = useQuery({ queryKey: ['orders', number], queryFn: () => api<Order>(`/orders/${encodeURIComponent(number)}`) });
  if (order.isError) return <p className="py-10 text-center text-muted">{(order.error as Error).message}</p>;
  if (!order.data) return <p className="py-10 text-center text-muted">{t.common.loading}</p>;
  return (
    <div>
      <Link to="/account/orders" className="mb-3 inline-flex text-sm font-semibold text-muted hover:text-ink">
        ← {t.account.orders}
      </Link>
      <h1 className="mb-4 font-display text-2xl font-bold">{order.data.number}</h1>
      <OrderSummary
        order={order.data}
        actions={
          <a href={apiUrl(`/orders/${encodeURIComponent(number)}/invoice.pdf`)} target="_blank" rel="noopener" className="btn-ghost w-full">
            📄 {t.account.invoice}
          </a>
        }
      />
    </div>
  );
}
