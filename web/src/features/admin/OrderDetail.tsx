import { PAYMENT_STATUSES, type OrderStatus } from '@cambo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Printer, QrCode } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { FormError } from '../../shared/ui/FormCard';
import { Section } from '../../shared/ui/Page';
import { OrderSummary } from '../orders/OrderView';
import { api } from '../../shared/lib/api';
import { formatTime } from '../../shared/lib/format';
import { t } from '../../shared/lib/strings';
import { Loading, PageHeader } from './components/ui';
import { StatusActions } from './components/StatusActions';
import { RefundNotice } from './components/RefundNotice';
import { TrackingCard } from './components/TrackingCard';
import type { AdminOrder } from './types';
import { Select } from '../../shared/ui/Select';

export default function OrderDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const order = useQuery({
    queryKey: ['admin', 'order', id],
    queryFn: () => api<AdminOrder>(`/admin/orders/${id}`),
  });
  const [note, setNote] = useState('');
  const onDone = (o: AdminOrder) => {
    qc.setQueryData(['admin', 'order', id], o);
    qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
    setNote('');
  };
  const status = useMutation({
    mutationFn: (to: OrderStatus) =>
      api<AdminOrder>(`/admin/orders/${id}/status`, {
        method: 'POST',
        body: { status: to, note: note.trim() || undefined },
      }),
    onSuccess: onDone,
  });
  const check = useMutation({
    mutationFn: () => api<AdminOrder>(`/admin/orders/${id}/payment/check`, { method: 'POST' }),
    onSuccess: onDone,
  });
  const payment = useMutation({
    mutationFn: (s: string) =>
      api<AdminOrder>(`/admin/orders/${id}/payment`, { method: 'POST', body: { status: s } }),
    onSuccess: onDone,
  });

  if (!order.data) return <Loading />;
  const o = order.data;
  const closed = o.status === 'DELIVERED' || o.status === 'CANCELLED';
  return (
    <div>
      <PageHeader
        title={o.number}
        back={{ to: '/admin/orders', label: 'Orders' }}
        actions={
          <>
            <Link className="btn-ghost btn-sm" to={`/admin/orders/${o.id}/invoice`}>
              <FileText className="size-4" aria-hidden /> Invoice
            </Link>
            <button className="btn-ghost btn-sm" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden /> Packing slip
            </button>
          </>
        }
      />
      <OrderSummary
        order={o}
        actions={
          <div className="no-print space-y-4">
            <Section
              title="Update order"
              description={closed ? 'This order is closed.' : undefined}
            >
              {!closed && (
                <div className="space-y-3">
                  <FormError>
                    {status.error ? (status.error as Error).message : undefined}
                  </FormError>
                  <div>
                    <label className="label" htmlFor="status-note">
                      Note{' '}
                      <span className="font-normal text-muted">(optional, kept in history)</span>
                    </label>
                    <input
                      id="status-note"
                      className="field"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={500}
                    />
                  </div>
                  <StatusActions
                    status={o.status}
                    busy={status.isPending}
                    onChange={(to) => status.mutate(to)}
                  />
                </div>
              )}
            </Section>
            {o.deliveryService !== 'GRAB' && o.status !== 'CANCELLED' && <TrackingCard key={o.trackingNumber ?? ''} orderId={o.id} current={o.trackingNumber} carrier={t.service[o.deliveryService] ?? o.deliveryService} onSaved={onDone} />}
            <Section title="Payment">
              {o.status === 'CANCELLED' && o.payment?.status === 'PAID' && <RefundNotice amountCents={o.payment.amountCents} busy={payment.isPending} onRefunded={() => payment.mutate('REFUNDED')} />}
              {o.payment?.method === 'KHQR' && o.payment.status === 'PENDING' && (
                <div className="mb-4 rounded-xl border border-yellow/30 bg-yellow/5 p-3 text-sm">
                  <p className="flex items-center gap-2 font-semibold text-yellow">
                    <QrCode className="size-4" aria-hidden /> Waiting for KHQR payment
                  </p>
                  {o.payment.payBefore && (
                    <p className="mt-0.5 text-muted">
                      Cancelled automatically if unpaid by {formatTime(o.payment.payBefore)}.
                    </p>
                  )}
                  <button
                    className="btn-ghost btn-sm mt-3 w-full"
                    onClick={() => check.mutate()}
                    disabled={check.isPending}
                  >
                    {check.isPending ? 'Checking with Bakong…' : 'Check payment now'}
                  </button>
                </div>
              )}
              <label htmlFor="pay" className="label">
                Payment status
              </label>
              <Select
                id="pay"
                title="Payment status"
                value={o.payment?.status ?? ''}
                onChange={(v) => payment.mutate(v)}
                disabled={payment.isPending}
                options={PAYMENT_STATUSES.map((s) => ({ value: s, label: t.paymentStatus[s] }))}
              />
            </Section>
            <Section title="Customer">
              <p className="text-sm">
                <Link className="link" to={`/admin/customers/${o.customer.id}`}>
                  {o.customer.name}
                </Link>
                {o.customer.telegramUsername && (
                  <>
                    <span className="text-muted"> on Telegram </span>
                    <a
                      className="link"
                      href={`https://t.me/${o.customer.telegramUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      @{o.customer.telegramUsername}
                    </a>
                  </>
                )}
              </p>
            </Section>
          </div>
        }
      />
    </div>
  );
}
