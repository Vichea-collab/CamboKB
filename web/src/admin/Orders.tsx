import { formatPhone, formatUsd, ORDER_STATUSES } from '@cambo/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { StatusBadge } from '../components/StatusBadge';
import { api } from '../lib/api';
import { t } from '../lib/strings';
import type { Paged } from '../lib/types';
import { Empty, fmtDate, Loading, PageHeader, Table, td, th } from './components/ui';
import type { AdminOrder } from './types';

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const status = params.get('status') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page') ?? 1);
  const qs = new URLSearchParams(Object.entries({ status, q: params.get('q') ?? '', from, to, page: String(page) }).filter(([, v]) => v));
  const orders = useQuery({ queryKey: ['admin', 'orders', qs.toString()], queryFn: () => api<Paged<AdminOrder>>(`/admin/orders?${qs}`), placeholderData: keepPreviousData });
  const set = (k: string, v: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (v) n.set(k, v);
      else n.delete(k);
      if (k !== 'page') n.delete('page');
      return n;
    });

  return (
    <div>
      <PageHeader title="Orders" />
      <div className="mb-4 flex flex-wrap gap-2">
        <form
          className="flex min-w-[220px] flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            set('q', q.trim());
          }}
        >
          <input className="field" placeholder="Order number or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
          <button className="btn-ghost shrink-0">Search</button>
        </form>
        <select className="field w-auto" value={status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.status[s]}
            </option>
          ))}
        </select>
        <input type="date" className="field w-auto" value={from} onChange={(e) => set('from', e.target.value)} aria-label="From date" />
        <input type="date" className="field w-auto" value={to} onChange={(e) => set('to', e.target.value)} aria-label="To date" />
      </div>
      {!orders.data ? (
        <Loading />
      ) : orders.data.items.length === 0 ? (
        <Empty>No orders match these filters.</Empty>
      ) : (
        <>
          <Table
            head={
              <>
                <th className={th}>Order</th>
                <th className={th}>Date</th>
                <th className={th}>Customer</th>
                <th className={th}>Delivery</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Total</th>
              </>
            }
          >
            {orders.data.items.map((o) => (
              <tr key={o.id} className="hover:bg-raised/40">
                <td className={td}>
                  <Link to={`/admin/orders/${o.id}`} className="font-display font-bold text-yellow hover:underline">
                    {o.number}
                  </Link>
                </td>
                <td className={`${td} whitespace-nowrap text-muted`}>{fmtDate(o.createdAt)}</td>
                <td className={td}>
                  <div className="font-semibold">{o.contactName}</div>
                  <div className="text-xs text-muted tabular-nums">{formatPhone(o.contactPhone)}</div>
                </td>
                <td className={`${td} text-muted`}>
                  {t.region[o.region]} · {t.service[o.deliveryService]}
                </td>
                <td className={td}>
                  <StatusBadge status={o.status} />
                </td>
                <td className={`${td} text-right font-bold tabular-nums`}>{formatUsd(o.totalCents)}</td>
              </tr>
            ))}
          </Table>
          <Pager page={page} total={orders.data.total} pageSize={orders.data.pageSize} onPage={(p) => set('page', String(p))} />
        </>
      )}
    </div>
  );
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted">
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <button className="btn-ghost px-3 py-2" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="btn-ghost px-3 py-2" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
