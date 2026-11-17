import { PAYMENT_STATUSES, type OrderStatus } from '@cambo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { FormError } from '../../shared/ui/FormCard';
import { OrderSummary } from '../orders/OrderView';
import { api, apiUrl } from '../../shared/lib/api';
import { t } from '../../shared/lib/strings';
import { Loading, PageHeader } from './components/ui';
import { StatusActions } from './components/StatusActions';
import type { AdminOrder } from './types';

export default function OrderDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const order = useQuery({ queryKey: ['admin', 'order', id], queryFn: () => api<AdminOrder>(`/admin/orders/${id}`) });
  const [note, setNote] = useState('');
  const onDone = (o: AdminOrder) => {
    qc.setQueryData(['admin', 'order', id], o);
    qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
    setNote('');
  };
  const status = useMutation({
    mutationFn: (to: OrderStatus) => api<AdminOrder>(`/admin/orders/${id}/status`, { method: 'POST', body: { status: to, note: note.trim() || undefined } }),
    onSuccess: onDone,
  });
  const check = useMutation({ mutationFn: () => api<AdminOrder>(`/admin/orders/${id}/payment/check`, { method: 'POST' }), onSuccess: onDone });
  const payment = useMutation({ mutationFn: (s: string) => api<AdminOrder>(`/admin/orders/${id}/payment`, { method: 'POST', body: { status: s } }), onSuccess: onDone });

  if (!order.data) return <Loading />;
  const o = order.data;
  return (
    <div>
      <PageHeader
        title={o.number}
        back={
          <Link to="/admin/orders" className="no-print -ml-1 mb-1 inline-flex min-h-10 items-center rounded-lg px-1 text-sm font-semibold text-muted hover:text-ink">
            ← Orders
          </Link>
        }
        actions={
          <div className="no-print flex gap-2">
            <a className="btn-ghost px-3 py-2 text-sm" href={apiUrl(`/admin/orders/${o.id}/invoice.pdf`)} target="_blank" rel="noopener">
              📄 Invoice PDF
            </a>
            <button className="btn-ghost px-3 py-2 text-sm" onClick={() => window.print()}>
              Print packing slip
            </button>
          </div>
        }
      />
      <OrderSummary
        order={o}
        actions={
          <div className="no-print space-y-4">
            <section className="panel space-y-3 p-5">
              <h2 className="font-display text-lg font-bold">Update order</h2>
              <FormError>{status.error ? (status.error as Error).message : undefined}</FormError>
              <label className="label" htmlFor="status-note">
                Note (optional, kept in history)
              </label>
              <input id="status-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              <StatusActions status={o.status} busy={status.isPending} onChange={(to) => status.mutate(to)} />
              {(o.status === 'DELIVERED' || o.status === 'CANCELLED') && <p className="text-sm text-muted">This order is closed.</p>}
            </section>
            <section className="panel p-5">
              {o.payment?.method === 'KHQR' && o.payment.status === 'PENDING' && (
                <div className="mb-4 rounded-xl border border-yellow/30 bg-yellow/5 p-3 text-sm">
                  <p className="font-semibold text-yellow">Waiting for KHQR payment</p>
                  {o.payment.payBefore && (
                    <p className="mt-0.5 text-muted">Cancelled automatically if unpaid by {new Date(o.payment.payBefore).toLocaleTimeString('en-GB', { timeZone: 'Asia/Phnom_Penh', hour: '2-digit', minute: '2-digit' })}.</p>
                  )}
                  <button className="btn-ghost mt-3 w-full px-3 py-2 text-sm" onClick={() => check.mutate()} disabled={check.isPending}>
                    {check.isPending ? 'Checking with Bakong…' : 'Check payment now'}
                  </button>
                </div>
              )}
              <label htmlFor="pay" className="label">
                Payment status
              </label>
              <select id="pay" className="field" value={o.payment?.status ?? ''} onChange={(e) => payment.mutate(e.target.value)} disabled={payment.isPending}>
                {PAYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t.paymentStatus[s]}
                  </option>
                ))}
              </select>
              <p className="mt-3 text-sm text-muted">
                Customer: <Link className="font-semibold text-yellow hover:underline" to={`/admin/customers/${o.customer.id}`}>{o.customer.name}</Link>
                {o.customer.telegramUsername && (
                  <>
                    {' '}
                    ·{' '}
                    <a className="font-semibold text-yellow hover:underline" href={`https://t.me/${o.customer.telegramUsername}`} target="_blank" rel="noopener noreferrer">
                      @{o.customer.telegramUsername}
                    </a>
                  </>
                )}
              </p>
            </section>
          </div>
        }
      />
    </div>
  );
}
