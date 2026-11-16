import { formatUsd } from '@cambo/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { StatusBadge } from '../components/StatusBadge';
import { api } from '../lib/api';
import type { Paged } from '../lib/types';
import { Loading, PageHeader } from './components/ui';
import type { AdminOrder } from './types';

type Stats = { today: { orders: number; revenueCents: number }; week: { orders: number; revenueCents: number }; pendingCount: number; lowStock: { id: string; name: string; stock: number }[] };

export default function Dashboard() {
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api<Stats>('/admin/stats'), refetchInterval: 60_000 });
  const latest = useQuery({ queryKey: ['admin', 'orders', 'latest'], queryFn: () => api<Paged<AdminOrder>>('/admin/orders?pageSize=8') });
  if (!stats.data) return <Loading />;
  const s = stats.data;
  return (
    <div>
      <PageHeader title="Dashboard" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Revenue today" value={formatUsd(s.today.revenueCents)} sub={`${s.today.orders} orders`} />
        <Tile label="Revenue, last 7 days" value={formatUsd(s.week.revenueCents)} sub={`${s.week.orders} orders`} />
        <Tile label="Waiting for confirmation" value={String(s.pendingCount)} sub="pending orders" to="/admin/orders?status=PENDING" highlight={s.pendingCount > 0} />
        <Tile label="Low stock" value={String(s.lowStock.length)} sub="products with 3 or fewer" />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <section className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Latest orders</h2>
            <Link to="/admin/orders" className="text-sm font-semibold text-yellow hover:underline">
              All orders
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {latest.data?.items.map((o) => (
              <li key={o.id}>
                <Link to={`/admin/orders/${o.id}`} className="flex items-center gap-3 py-3 hover:text-yellow">
                  <span className="w-24 font-display font-bold">{o.number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{o.contactName}</span>
                  <StatusBadge status={o.status} />
                  <span className="w-20 text-right font-bold tabular-nums">{formatUsd(o.totalCents)}</span>
                </Link>
              </li>
            ))}
            {latest.data?.items.length === 0 && <li className="py-6 text-center text-sm text-muted">No orders yet.</li>}
          </ul>
        </section>
        <section className="panel p-5">
          <h2 className="mb-3 font-display text-lg font-bold">Low stock</h2>
          {s.lowStock.length === 0 ? (
            <p className="text-sm text-muted">Everything is well stocked.</p>
          ) : (
            <ul className="space-y-2">
              {s.lowStock.map((p) => (
                <li key={p.id}>
                  <Link to={`/admin/products/${p.id}`} className="flex justify-between gap-3 text-sm hover:text-yellow">
                    <span className="truncate">{p.name}</span>
                    <span className={`font-bold tabular-nums ${p.stock === 0 ? 'text-danger' : 'text-yellow'}`}>{p.stock} left</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, to, highlight }: { label: string; value: string; sub: string; to?: string; highlight?: boolean }) {
  const body = (
    <div className={`panel h-full p-4 ${highlight ? 'border-yellow/50' : ''}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums sm:text-3xl">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{sub}</p>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}
