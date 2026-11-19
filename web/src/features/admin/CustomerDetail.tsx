import { formatPhone, formatUsdExact } from '@cambo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { FormError } from '../../shared/ui/FormCard';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { api } from '../../shared/lib/api';
import { useMe } from '../auth/auth';
import type { Order } from '../../shared/lib/types';
import { RoleControl } from './components/RoleControl';
import { Badge, Fact, Section } from '../../shared/ui/Page';
import { fmtDate, Loading, PageHeader } from './components/ui';
import type { Customer } from './types';

export default function CustomerDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const c = useQuery({
    queryKey: ['admin', 'customer', id],
    queryFn: () => api<Customer & { orders: Order[] }>(`/admin/customers/${id}`),
  });
  const toggle = useMutation({
    mutationFn: (disable: boolean) =>
      api(`/admin/customers/${id}/${disable ? 'disable' : 'enable'}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'customer', id] }),
  });
  const me = useMe();
  const role = useMutation({
    mutationFn: (next: 'ADMIN' | 'CUSTOMER') =>
      api(`/admin/customers/${id}/role`, { method: 'POST', body: { role: next } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'customer', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'customers'] });
    },
  });
  if (!c.data) return <Loading />;
  const u = c.data;
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {u.name}
            {u.role === 'ADMIN' && <Badge tone="yellow">Admin</Badge>}
            {u.disabled && <Badge tone="danger">Disabled</Badge>}
          </span>
        }
        back={{ to: '/admin/customers', label: 'Customers' }}
      />
      <section className="panel grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
        <Fact label="Phone">{formatPhone(u.phone)}</Fact>
        <Fact label="Telegram">{u.telegramUsername ? `@${u.telegramUsername}` : '—'}</Fact>
        <Fact label="Orders">{u.orderCount}</Fact>
        <Fact label="Spent (delivered)">{formatUsdExact(u.totalSpentCents)}</Fact>
      </section>
      <Section title="Orders">
        <ul className="-mx-5 -mb-5 divide-y divide-line border-t border-line">
          {u.orders.map((o) => (
            <li key={o.id}>
              <Link
                to={`/admin/orders/${o.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 transition-colors hover:bg-raised/40"
              >
                <span className="font-display font-extrabold text-yellow tabular-nums">
                  {o.number}
                </span>
                <span className="min-w-0 flex-1 text-sm text-muted">{fmtDate(o.createdAt)}</span>
                <StatusBadge status={o.status} />
                <span className="w-20 text-right font-bold tabular-nums">
                  {formatUsdExact(o.totalCents)}
                </span>
              </Link>
            </li>
          ))}
          {u.orders.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-muted">No orders yet.</li>
          )}
        </ul>
      </Section>
      <div className="space-y-2">
        <RoleControl
          role={u.role}
          name={u.name}
          isSelf={me.data?.id === u.id}
          busy={role.isPending}
          onChange={(next) => role.mutate(next)}
        />
        <FormError>{role.error ? (role.error as Error).message : undefined}</FormError>
      </div>
      {me.data?.id !== u.id && (
        <Section
          title="Account access"
          description={
            u.disabled
              ? "This customer can't log in."
              : 'Disabling logs them out everywhere and stops them logging in. Their orders are kept.'
          }
        >
          <FormError>{toggle.error ? (toggle.error as Error).message : undefined}</FormError>
          {u.disabled ? (
            <button className="btn-ghost" onClick={() => toggle.mutate(false)}>
              Enable account
            </button>
          ) : (
            <button
              className="btn-danger"
              onClick={() =>
                confirm(`Disable ${u.name}? They will be logged out and can't log in.`) &&
                toggle.mutate(true)
              }
            >
              Disable account
            </button>
          )}
        </Section>
      )}
    </div>
  );
}
