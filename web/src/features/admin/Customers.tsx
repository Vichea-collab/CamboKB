import { formatPhone, formatUsdExact } from '@cambo/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../shared/lib/api';
import type { Paged } from '../../shared/lib/types';
import { Plus, Search, Users } from 'lucide-react';
import { Badge, EmptyState } from '../../shared/ui/Page';
import { Drawer } from '../../shared/ui/Drawer';
import { FormError } from '../../shared/ui/FormCard';
import { PhoneInput } from '../../shared/ui/PhoneInput';
import { useUi } from '../../shared/lib/ui-store';
import { Loading, PageHeader, Table, td, th } from './components/ui';
import { Pager } from './Orders';
import type { Customer } from './types';
import { Select } from '../../shared/ui/Select';

export default function Customers() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    queryKey: ['admin', 'customers', query, page],
    queryFn: () =>
      api<Paged<Customer>>(
        `/admin/customers?page=${page}${query ? `&q=${encodeURIComponent(query)}` : ''}`,
      ),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader
        title="Customers"
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" strokeWidth={3} aria-hidden /> New customer
          </button>
        }
      />
      <form
        className="relative mb-5 max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(q.trim());
        }}
      >
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          className="field pl-10"
          type="search"
          enterKeyHint="search"
          placeholder="Name, phone or Telegram username"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search customers"
        />
      </form>
      {!list.data ? (
        <Loading />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={Users}
          title={query ? 'No customers match your search' : 'No customers yet'}
        />
      ) : (
        <>
          <Table
            head={
              <>
                <th className={th}>Name</th>
                <th className={th}>Phone</th>
                <th className={th}>Telegram</th>
                <th className={`${th} text-right`}>Orders</th>
                <th className={`${th} text-right`}>Spent (delivered)</th>
              </>
            }
          >
            {list.data.items.map((c) => (
              <tr key={c.id} className="transition-colors hover:bg-raised/40">
                <td className={td}>
                  <span className="flex flex-wrap items-center gap-2">
                    <Link to={`/admin/customers/${c.id}`} className="link">
                      {c.name}
                    </Link>
                    {c.role === 'ADMIN' && <Badge tone="yellow">Admin</Badge>}
                    {c.disabled && <Badge tone="danger">Disabled</Badge>}
                  </span>
                </td>
                <td className={`${td} tabular-nums`}>{formatPhone(c.phone)}</td>
                <td className={`${td} text-muted`}>
                  {c.telegramUsername ? `@${c.telegramUsername}` : '—'}
                </td>
                <td className={`${td} text-right tabular-nums`}>{c.orderCount}</td>
                <td className={`${td} text-right font-bold tabular-nums`}>
                  {formatUsdExact(c.totalSpentCents)}
                </td>
              </tr>
            ))}
          </Table>
          <Pager
            page={page}
            total={list.data.total}
            pageSize={list.data.pageSize}
            onPage={setPage}
          />
        </>
      )}
      <NewCustomerDrawer open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function NewCustomerDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const showToast = useUi((s) => s.showToast);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'CUSTOMER' | 'ADMIN'>('CUSTOMER');
  const [error, setError] = useState<string>();

  const create = useMutation({
    mutationFn: () =>
      api<Customer>('/admin/customers', {
        method: 'POST',
        body: { name: name.trim(), phone, role },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'customers'] });
      showToast('Customer created');
      setName('');
      setPhone('');
      setError(undefined);
      onClose();
    },
    onError: (err) => setError((err as Error).message),
  });

  return (
    <Drawer open={open} onClose={onClose} title="New customer">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <FormError>{error}</FormError>
        <div>
          <label htmlFor="new-cust-name" className="label">
            Full name
          </label>
          <input
            id="new-cust-name"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
          />
        </div>
        <div>
          <label htmlFor="new-cust-phone" className="label">
            Phone number
          </label>
          <PhoneInput id="new-cust-phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="new-cust-role" className="label">
            Role
          </label>
          <Select
            id="new-cust-role"
            title="Role"
            value={role}
            onChange={(v) => setRole(v as 'CUSTOMER' | 'ADMIN')}
            options={[
              { value: 'CUSTOMER', label: 'Customer' },
              { value: 'ADMIN', label: 'Admin' },
            ]}
          />
        </div>
        <div className="flex justify-end gap-3 pt-3">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={create.isPending || !name.trim() || !phone.trim()}
          >
            {create.isPending ? 'Creating…' : 'Create customer'}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
