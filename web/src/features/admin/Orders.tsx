import { formatPhone, formatUsd, ORDER_STATUSES } from '@cambo/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarDays, QrCode, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../shared/lib/api';
import { t } from '../../shared/lib/strings';
import type { Paged } from '../../shared/lib/types';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Empty, fmtDate, Loading, PageHeader, td, th } from './components/ui';
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
  const counts = useQuery({ queryKey: ['admin', 'orders', 'counts'], queryFn: () => api<Record<string, number>>('/admin/orders/counts'), refetchInterval: 30_000 });
  const set = (k: string, v: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (v) n.set(k, v);
      else n.delete(k);
      if (k !== 'page') n.delete('page');
      return n;
    });

  const tabs = [{ key: '', label: 'All', n: counts.data?.all }, ...ORDER_STATUSES.map((s) => ({ key: s, label: t.status[s]!, n: counts.data?.[s] }))];

  return (
    <div>
      <PageHeader title="Orders" />

      <div role="tablist" aria-label="Order status" className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {tabs.map((tab) => {
          const on = tab.key === status;
          const attention = tab.key === 'PENDING' && (tab.n ?? 0) > 0;
          return (
            <button
              key={tab.key || 'all'}
              role="tab"
              aria-selected={on}
              onClick={() => set('status', tab.key)}
              className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${on ? 'bg-ink text-bg' : 'bg-surface text-muted ring-1 ring-line hover:text-ink hover:ring-line-strong'}`}
            >
              {tab.label}
              {tab.n !== undefined && (
                <span className={`grid min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-extrabold leading-5 tabular-nums ${on ? 'bg-bg/15 text-bg' : attention ? 'bg-yellow text-yellow-ink' : 'bg-raised text-muted'}`}>{tab.n}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-[220px] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            set('q', q.trim());
          }}
        >
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input className="field pl-10" placeholder="Order number or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
        </form>
        <details className="group relative w-full sm:w-auto" open={Boolean(from || to)}>
          <summary className="btn-ghost min-h-11 w-full cursor-pointer list-none justify-start gap-2 px-3.5 sm:w-auto [&::-webkit-details-marker]:hidden">
            <CalendarDays className="size-4 text-muted" aria-hidden />
            {from || to ? `${from || '…'} → ${to || '…'}` : 'Dates'}
          </summary>
          <div className="mt-2 flex flex-wrap gap-2 rounded-2xl bg-surface p-3 ring-1 ring-line-strong sm:absolute sm:right-0 sm:z-20 sm:mt-2 sm:w-[22rem] sm:shadow-pop">
            <input type="date" className="field min-w-0 flex-1" value={from} onChange={(e) => set('from', e.target.value)} aria-label="From date" />
            <input type="date" className="field min-w-0 flex-1" value={to} onChange={(e) => set('to', e.target.value)} aria-label="To date" />
            {(from || to) && (
              <button
                className="w-full text-sm font-semibold text-yellow hover:underline"
                onClick={() => {
                  set('from', '');
                  set('to', '');
                }}
              >
                Clear dates
              </button>
            )}
          </div>
        </details>
      </div>

      {!orders.data ? (
        <Loading />
      ) : orders.data.items.length === 0 ? (
        <Empty>No orders match these filters.</Empty>
      ) : (
        <>
          {/* Phones: one card per order. */}
          <ul className="space-y-2.5 md:hidden">
            {orders.data.items.map((o) => (
              <li key={o.id}>
                <Link to={`/admin/orders/${o.id}`} className="block rounded-2xl bg-surface p-4 ring-1 ring-line transition active:scale-[0.99] hover:ring-line-strong">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-display text-lg font-extrabold">{o.number}</span>
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{o.contactName}</p>
                      <p className="text-xs text-muted tabular-nums">{formatPhone(o.contactPhone)}</p>
                      <p className="mt-1 text-xs text-muted">
                        {t.region[o.region]} · {t.service[o.deliveryService]} · {fmtDate(o.createdAt)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-display text-xl font-extrabold tabular-nums">{formatUsd(o.totalCents)}</p>
                      <Waiting o={o} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Tablet and up: table. */}
          <div className="hidden overflow-hidden rounded-2xl bg-surface ring-1 ring-line md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className={th}>Order</th>
                  <th className={th}>Date</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Delivery</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.data.items.map((o) => (
                  <tr key={o.id} className="transition-colors hover:bg-raised/50">
                    <td className={td}>
                      <Link to={`/admin/orders/${o.id}`} className="font-display font-extrabold text-yellow hover:underline">
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
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={o.status} />
                        <Waiting o={o} />
                      </div>
                    </td>
                    <td className={`${td} text-right font-bold tabular-nums`}>{formatUsd(o.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={orders.data.total} pageSize={orders.data.pageSize} onPage={(p) => set('page', String(p))} />
        </>
      )}
    </div>
  );
}

/** Marks an order that is waiting for its KHQR payment. */
function Waiting({ o }: { o: AdminOrder }) {
  if (o.payment?.method !== 'KHQR' || o.payment.status !== 'PENDING' || o.status !== 'PENDING') return null;
  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-yellow/12 px-2 py-0.5 text-[11px] font-bold text-yellow">
      <QrCode className="size-3" aria-hidden /> Awaiting KHQR
    </span>
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
