import { formatUsdExact, phnomPenhDate } from '@cambo/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, apiUrl } from '../../shared/lib/api';
import { t } from '../../shared/lib/strings';
import { Banknote, Calculator, Download, Package, Receipt } from 'lucide-react';
import { EmptyState, ErrorState, Section } from '../../shared/ui/Page';
import { RevenueChart } from './components/RevenueChart';
import { StatTile } from './components/StatTile';
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
const PRESETS: [number, 'day' | 'month', string][] = [
  [7, 'day', 'Last 7 days'],
  [30, 'day', 'Last 30 days'],
  [365, 'month', 'Last 12 months'],
];
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
  const top = useQuery({
    queryKey: ['admin', 'reports', 'top', range],
    queryFn: () => api<Top>(`/admin/reports/top-products?${range}&limit=10`),
    ...opts,
  });
  const split = useQuery({
    queryKey: ['admin', 'reports', 'breakdown', range],
    queryFn: () => api<Breakdown>(`/admin/reports/breakdown?${range}`),
    ...opts,
  });
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
          <a className="btn-ghost btn-sm" href={apiUrl(`/admin/reports/orders.csv?${range}`)}>
            <Download className="size-4" aria-hidden /> Export orders (CSV)
          </a>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {PRESETS.map(([days, g, label]) => {
          const on = from === daysAgo(days - 1) && to === today() && groupBy === g;
          return (
            <button
              key={label}
              type="button"
              className="chip"
              aria-pressed={on}
              onClick={() => preset(days, g)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="panel mb-5 flex flex-wrap items-end gap-3 p-4">
        <label>
          <span className="label">From</span>
          <input
            type="date"
            className="field w-auto"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          <span className="label">To</span>
          <input
            type="date"
            className="field w-auto"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <div>
          <span className="label">Group by</span>
          <div className="segmented" role="group" aria-label="Group by">
            {(['day', 'month'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroupBy(g)}
                aria-pressed={groupBy === g}
                className="segment min-h-10 capitalize"
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>
      {summary.error ? (
        <ErrorState message={(summary.error as Error).message} onRetry={() => summary.refetch()} />
      ) : !summary.data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              icon={Banknote}
              label="Revenue"
              value={formatUsdExact(summary.data.totals.revenueCents)}
            />
            <StatTile icon={Receipt} label="Orders" value={String(summary.data.totals.orders)} />
            <StatTile icon={Package} label="Items sold" value={String(summary.data.totals.units)} />
            <StatTile
              icon={Calculator}
              label="Average order"
              value={formatUsdExact(summary.data.totals.averageOrderCents)}
            />
          </div>
          <Section
            className="mt-5 min-w-0"
            title={`Revenue by ${groupBy}`}
            description="Excludes cancelled orders. Days are Phnom Penh time."
          >
            <RevenueChart buckets={summary.data.buckets} groupBy={groupBy} />
            <details className="mt-3 text-sm">
              <summary className="inline-flex min-h-10 cursor-pointer items-center font-semibold text-muted hover:text-ink">
                Show as table
              </summary>
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
                        <td className="py-1.5 text-right">{formatUsdExact(b.revenueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Section>
        </>
      )}
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <section className="min-w-0">
          <h2 className="title-section mb-3">Top products</h2>
          {top.data && top.data.items.length === 0 ? (
            <EmptyState title="No sales in this period" />
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
                  <td className={`${td} text-right font-bold tabular-nums`}>
                    {formatUsdExact(p.revenueCents)}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </section>
        <section className="min-w-0 space-y-5">
          <Split
            title="By payment"
            rows={
              split.data?.byPaymentMethod.map((r) => ({
                key: r.method,
                label: t.payment[r.method] ?? r.method,
                ...r,
              })) ?? []
            }
          />
          <Split
            title="By delivery area"
            rows={
              split.data?.byRegion.map((r) => ({
                key: r.region,
                label: t.region[r.region] ?? r.region,
                ...r,
              })) ?? []
            }
          />
        </section>
      </div>
    </div>
  );
}

function Split({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; orders: number; revenueCents: number }[];
}) {
  return (
    <Section title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No sales in this period.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <span className="font-semibold">{r.label}</span>
              <span className="text-muted tabular-nums">
                {r.orders} {r.orders === 1 ? 'order' : 'orders'} ·{' '}
                <span className="font-bold text-ink">{formatUsdExact(r.revenueCents)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
