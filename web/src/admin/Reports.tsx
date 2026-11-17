import { formatUsd, phnomPenhDate } from '@cambo/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, apiUrl } from '../lib/api';
import { t } from '../lib/strings';
import { RevenueChart } from './components/RevenueChart';
import { Loading, PageHeader, Table, td, th } from './components/ui';

type Summary = {
  buckets: { period: string; orders: number; units: number; revenueCents: number }[];
  totals: { orders: number; units: number; revenueCents: number; averageOrderCents: number };
};
type Top = { items: { productId: string; name: string; units: number; revenueCents: number }[] };
type Breakdown = {
  byPaymentMethod: { method: string; orders: number; revenueCents: number }[];
  byRegion: { region: string; orders: number; revenueCents: number }[];
};

const DAY = 86_400_000;
const today = () => phnomPenhDate(new Date());
const daysAgo = (n: number) => phnomPenhDate(new Date(Date.now() - n * DAY));

export default function Reports() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [groupBy, setGroupBy] = useState<'day' | 'month'>('day');
  const range = `from=${from}&to=${to}`;
  const opts = { placeholderData: keepPreviousData, enabled: Boolean(from && to && from <= to) };
  const summary = useQuery({
    queryKey: ['admin', 'reports', 'summary', range, groupBy],
    queryFn: () => api<Summary>(`/admin/reports/summary?${range}&groupBy=${groupBy}`),
    ...opts,
  });
  const top = useQuery({ queryKey: ['admin', 'reports', 'top', range], queryFn: () => api<Top>(`/admin/reports/top-products?${range}&limit=10`), ...opts });
  const split = useQuery({ queryKey: ['admin', 'reports', 'breakdown', range], queryFn: () => api<Breakdown>(`/admin/reports/breakdown?${range}`), ...opts });
  const preset = (days: number, g: 'day' | 'month') => {
    setFrom(daysAgo(days - 1));
    setTo(today());
    setGroupBy(g);
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        actions={
          <a className="btn-ghost px-3 py-2 text-sm" href={apiUrl(`/admin/reports/orders.csv?${range}`)}>
            Export orders (CSV)
          </a>
        }
      />
      <div className="mb-5 flex flex-wrap items-end gap-2">
        <label>
          <span className="label">From</span>
          <input type="date" className="field w-auto" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span className="label">To</span>
          <input type="date" className="field w-auto" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="flex rounded-xl border border-line bg-surface p-1" role="group" aria-label="Group by">
          {(['day', 'month'] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroupBy(g)}
              aria-pressed={groupBy === g}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${groupBy === g ? 'bg-yellow text-bg' : 'text-muted hover:text-ink'}`}
            >
              By {g}
            </button>
          ))}
        </div>
        <button type="button" className="btn-ghost px-3 py-2 text-sm" onClick={() => preset(7, 'day')}>
          Last 7 days
        </button>
        <button type="button" className="btn-ghost px-3 py-2 text-sm" onClick={() => preset(30, 'day')}>
          Last 30 days
        </button>
        <button type="button" className="btn-ghost px-3 py-2 text-sm" onClick={() => preset(365, 'month')}>
          Last 12 months
        </button>
      </div>
      {summary.error && <p className="mb-4 text-sm text-danger">{(summary.error as Error).message}</p>}
      {!summary.data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Revenue" value={formatUsd(summary.data.totals.revenueCents)} />
            <Tile label="Orders" value={String(summary.data.totals.orders)} />
            <Tile label="Items sold" value={String(summary.data.totals.units)} />
            <Tile label="Average order" value={formatUsd(summary.data.totals.averageOrderCents)} />
          </div>
          <section className="panel mt-5 min-w-0 p-5">
            <h2 className="mb-1 font-display text-lg font-bold">Revenue by {groupBy}</h2>
            <p className="mb-3 text-xs text-muted">Excludes cancelled orders. Days are Phnom Penh time.</p>
            <RevenueChart buckets={summary.data.buckets} groupBy={groupBy} />
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-semibold text-muted hover:text-ink">Show as table</summary>
              <div className="mt-3 max-h-72 overflow-y-auto">
                <table className="w-full text-left">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1.5">Period</th>
                      <th className="py-1.5 text-right">Orders</th>
                      <th className="py-1.5 text-right">Items</th>
                      <th className="py-1.5 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line tabular-nums">
                    {summary.data.buckets.map((b) => (
                      <tr key={b.period}>
                        <td className="py-1.5">{b.period}</td>
                        <td className="py-1.5 text-right">{b.orders}</td>
                        <td className="py-1.5 text-right">{b.units}</td>
                        <td className="py-1.5 text-right">{formatUsd(b.revenueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        </>
      )}
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <section className="min-w-0">
          <h2 className="mb-3 font-display text-lg font-bold">Top products</h2>
          {top.data && top.data.items.length === 0 ? (
            <p className="panel p-6 text-center text-sm text-muted">No sales in this period.</p>
          ) : (
            <Table
              compact
              head={
                <>
                  <th className={th}>Product</th>
                  <th className={`${th} text-right`}>Sold</th>
                  <th className={`${th} text-right`}>Revenue</th>
                </>
              }
            >
              {top.data?.items.map((p) => (
                <tr key={p.productId}>
                  <td className={td}>{p.name}</td>
                  <td className={`${td} text-right tabular-nums`}>{p.units}</td>
                  <td className={`${td} text-right font-bold tabular-nums`}>{formatUsd(p.revenueCents)}</td>
                </tr>
              ))}
            </Table>
          )}
        </section>
        <section className="min-w-0 space-y-5">
          <Split title="By payment" rows={split.data?.byPaymentMethod.map((r) => ({ key: r.method, label: t.payment[r.method] ?? r.method, ...r })) ?? []} />
          <Split title="By delivery area" rows={split.data?.byRegion.map((r) => ({ key: r.region, label: t.region[r.region] ?? r.region, ...r })) ?? []} />
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums sm:text-3xl">{value}</p>
    </div>
  );
}

function Split({ title, rows }: { title: string; rows: { key: string; label: string; orders: number; revenueCents: number }[] }) {
  return (
    <div className="panel p-5">
      <h3 className="mb-2 font-display font-bold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No sales in this period.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex justify-between gap-3">
              <span>{r.label}</span>
              <span className="tabular-nums text-muted">
                {r.orders} orders · <span className="font-bold text-ink">{formatUsd(r.revenueCents)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
