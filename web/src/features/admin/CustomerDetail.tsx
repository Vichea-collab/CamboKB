import { formatPhone, formatUsdExact } from '@cambo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Pencil } from 'lucide-react';
import { Drawer } from '../../shared/ui/Drawer';
import { FormError } from '../../shared/ui/FormCard';
import { PhoneInput } from '../../shared/ui/PhoneInput';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { api } from '../../shared/lib/api';
import { useMe } from '../auth/auth';
import { useUi } from '../../shared/lib/ui-store';
import type { Order } from '../../shared/lib/types';
import { RoleControl } from './components/RoleControl';
import { Badge, Fact, Section } from '../../shared/ui/Page';
import { fmtDate, Loading, PageHeader } from './components/ui';
import type { Customer } from './types';

export default function CustomerDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const showToast = useUi((s) => s.showToast);
  const [editing, setEditing] = useState(false);
  const [delError, setDelError] = useState<string>();

  const c = useQuery({
    queryKey: ['admin', 'customer', id],
    queryFn: () => api<Customer & { orders: Order[] }>(`/admin/customers/${id}`),
  });
  const toggle = useMutation({
    mutationFn: (disable: boolean) =>
      api(`/admin/customers/${id}/${disable ? 'disable' : 'enable'}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'customer', id] }),
  });
  const del = useMutation({
    mutationFn: () => api(`/admin/customers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'customers'] });
      showToast('Customer deleted');
      navigate('/admin/customers');
    },
    onError: (err) => setDelError((err as Error).message),
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
        actions={
          <button className="btn-ghost" onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden /> Edit
          </button>
        }
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
                <StatusBadge status={o.status} payment={o.payment?.status} />
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
          <FormError>{delError}</FormError>
          <div className="flex flex-wrap items-center gap-3">
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
            {u.orderCount === 0 ? (
              <button
                className="btn-danger"
                disabled={del.isPending}
                onClick={() =>
                  confirm(`Delete customer "${u.name}" permanently? This cannot be undone.`) &&
                  del.mutate()
                }
              >
                {del.isPending ? 'Deleting…' : 'Delete customer'}
              </button>
            ) : null}
          </div>
          {u.orderCount > 0 && (
            <p className="mt-3 text-xs text-muted">
              This customer has {u.orderCount} order{u.orderCount === 1 ? '' : 's'}. Customers with orders cannot be deleted to preserve order records. Disable their account instead.
            </p>
          )}
        </Section>
      )}
      <EditCustomerDrawer
        open={editing}
        onClose={() => setEditing(false)}
        customer={u}
      />
    </div>
  );
}

function EditCustomerDrawer({
  open,
  onClose,
  customer,
}: {
  open: boolean;
  onClose: () => void;
  customer: Customer;
}) {
  const qc = useQueryClient();
  const showToast = useUi((s) => s.showToast);
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(formatPhone(customer.phone));
  const [error, setError] = useState<string>();

  const update = useMutation({
    mutationFn: () =>
      api<Customer>(`/admin/customers/${customer.id}`, {
        method: 'PATCH',
        body: { name: name.trim(), phone },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'customer', customer.id] });
      qc.invalidateQueries({ queryKey: ['admin', 'customers'] });
      showToast('Customer updated');
      setError(undefined);
      onClose();
    },
    onError: (err) => setError((err as Error).message),
  });

  return (
    <Drawer open={open} onClose={onClose} title="Edit customer">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate();
        }}
      >
        <FormError>{error}</FormError>
        <div>
          <label htmlFor="edit-cust-name" className="label">
            Full name
          </label>
          <input
            id="edit-cust-name"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
          />
        </div>
        <div>
          <label htmlFor="edit-cust-phone" className="label">
            Phone number
          </label>
          <PhoneInput id="edit-cust-phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>
        <div className="flex justify-end gap-3 pt-3">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={update.isPending || !name.trim() || !phone.trim()}
          >
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
