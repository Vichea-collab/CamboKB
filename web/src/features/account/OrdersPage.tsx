import { formatUsdExact } from '@cambo/shared';
import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import { Link } from 'react-router';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { api } from '../../shared/lib/api';
import { formatDate } from '../../shared/lib/format';
import { t } from '../../shared/lib/strings';
import type { Order, Paged } from '../../shared/lib/types';
import { useDocumentTitle } from '../../shared/lib/useDocumentTitle';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../shared/ui/Page';

export default function OrdersPage() {
  useDocumentTitle(t.account.orders);
  const orders = useQuery({
    queryKey: ['orders', 'mine'],
    queryFn: () => api<Paged<Order>>('/orders?pageSize=50'),
  });
  return (
    <div>
      <PageHeader title={t.account.orders} back={{ to: '/', label: t.product.backToShop }} />
      {orders.isError ? (
        <ErrorState onRetry={() => orders.refetch()} />
      ) : !orders.data ? (
        <LoadingState shape="list" />
      ) : orders.data.items.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={t.account.noOrders}
          action={
            <Link to="/" className="btn-primary">
              {t.cart.browse}
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {orders.data.items.map((o) => (
            <li key={o.id}>
              <Link
                to={`/account/orders/${o.number}`}
                className="panel-link flex items-center gap-4 p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display font-extrabold tabular-nums">{o.number}</span>
                    <StatusBadge status={o.status} payment={o.payment?.status} />
                  </div>
                  <p className="mt-1 truncate text-sm text-muted">
                    {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{formatDate(o.createdAt)}</p>
                </div>
                <span className="font-display text-lg font-extrabold tabular-nums">
                  {formatUsdExact(o.totalCents)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
