import { formatPhone, formatUsd } from '@cambo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { FormError } from '../../shared/ui/FormCard';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { api } from '../../shared/lib/api';
import { useMe } from '../auth/auth';
import type { Order } from '../../shared/lib/types';
import { RoleControl } from './components/RoleControl';
import { fmtDate, Loading, PageHeader } from './components/ui';
import type { Customer } from './types';

export default function CustomerDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ['admin', 'customer', id], queryFn: () => api<Customer & { orders: Order[] }>(`/admin/customers/${id}`) });
  const toggle = useMutation({
    mutationFn: (disable: boolean) => api(`/admin/customers/${id}/${disable ? 'disable' : 'enable'}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'customer', id] }),
  });
  const me = useMe();
  const role = useMutation({
    mutationFn: (next: 'ADMIN' | 'CUSTOMER') => api(`/admin/customers/${id}/role`, { method: 'POST', body: { role: next } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'customer', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'customers'] });
    },
  });
  if (!c.data) return <Loading />;
  const u = c.data;
  return (
    <div className="max-w-3xl">
      <PageHeader title={u.name} back={<Link to="/admin/customers" className="-ml-1 mb-1 inline-flex min-h-10 items-center rounded-lg px-1 text-sm font-semibold text-muted hover:text-ink">← Customers</Link>} />
      <section className="panel mb-5 grid gap-4 p-5 sm:grid-cols-4">
        <Info label="Phone" value={formatPhone(u.phone)} />
        <Info label="Telegram" value={u.telegramUsername ? `@${u.telegramUsername}` : '—'} />
        <Info label="Orders" value={String(u.orderCount)} />
        <Info label="Spent (delivered)" value={formatUsd(u.totalSpentCents)} />
      </section>
      <div className="mb-5">
        <RoleControl role={u.role} name={u.name} isSelf={me.data?.id === u.id} busy={role.isPending} onChange={(next) => role.mutate(next)} />
        <FormError>{role.error ? (role.error as Error).message : undefined}</FormError>
      </div>
      <FormError>{toggle.error ? (toggle.error as Error).message : undefined}</FormError>
      <div className={`mb-5 ${me.data?.id === u.id ? 'hidden' : ''}`}>
        {u.disabled ? (
          <button className="btn-ghost" onClick={() => toggle.mutate(false)}>Enable account</button>
        ) : (
          <button className="btn-danger" onClick={() => confirm(`Disable ${u.name}? They will be logged out and can't log in.`) && toggle.mutate(true)}>Disable account</button>
        )}
      </div>
      <h2 className="mb-3 font-display text-lg font-bold">Orders</h2>
      <ul className="panel divide-y divide-line">
        {u.orders.map((o) => (
          <li key={o.id}>
            <Link to={`/admin/orders/${o.id}`} className="flex items-center gap-3 p-3 hover:bg-raised/40">
              <span className="w-24 font-display font-bold text-yellow">{o.number}</span>
              <span className="flex-1 text-sm text-muted">{fmtDate(o.createdAt)}</span>
              <StatusBadge status={o.status} />
              <span className="w-20 text-right font-bold tabular-nums">{formatUsd(o.totalCents)}</span>
            </Link>
          </li>
        ))}
        {u.orders.length === 0 && <li className="p-6 text-center text-sm text-muted">No orders yet.</li>}
      </ul>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 font-semibold tabular-nums">{value}</p>
    </div>
  );
}
