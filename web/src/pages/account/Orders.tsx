import { formatUsd } from '@cambo/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { StatusBadge } from '../../components/StatusBadge';
import { api } from '../../lib/api';
import { t } from '../../lib/strings';
import type { Order, Paged } from '../../lib/types';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { AccountNav } from './AccountNav';

export default function OrdersPage() {
  useDocumentTitle(t.account.orders);
  const orders = useQuery({ queryKey: ['orders', 'mine'], queryFn: () => api<Paged<Order>>('/orders?pageSize=50') });
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 font-display text-2xl font-bold">{t.account.title}</h1>
      <AccountNav />
      {!orders.data ? (
        <p className="py-10 text-center text-muted">{t.common.loading}</p>
      ) : orders.data.items.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="text-muted">{t.account.noOrders}</p>
          <Link to="/" className="btn-primary mt-4">
            {t.cart.browse}
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {orders.data.items.map((o) => (
            <li key={o.id}>
              <Link to={`/account/orders/${o.number}`} className="panel flex items-center gap-4 p-4 transition-colors hover:border-line-strong">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-display font-bold">{o.number}</span>
                    <StatusBadge status={o.status} />
                  </div>
                  <p className="mt-1 truncate text-sm text-muted">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</p>
                  <p className="mt-0.5 text-xs text-muted">{new Date(o.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Phnom_Penh', dateStyle: 'medium' })}</p>
                </div>
                <span className="font-display text-lg font-bold tabular-nums">{formatUsd(o.totalCents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
