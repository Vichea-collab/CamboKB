import { formatUsdExact, phnomPenhDate } from '@cambo/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Banknote,
  Calculator,
  Download,
  LineChart,
  Package,
  Receipt,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';
import { api, apiUrl } from '../../shared/lib/api';
import { t } from '../../shared/lib/strings';
import { EmptyState, ErrorState, Section } from '../../shared/ui/Page';
import { RevenueChart } from './components/RevenueChart';
import { StatTile } from './components/StatTile';
import { Loading, PageHeader } from './components/ui';
import { DatePicker } from '../../shared/ui/DatePicker';

type Totals = { orders: number; units: number; revenueCents: number; averageOrderCents: number };
type Summary = {
  buckets: { period: string; orders: number; units: number; revenueCents: number }[];
  totals: Totals;
};
type Top = { items: { productId: string; name: string; units: number; revenueCents: number }[] };
type Breakdown = {
  byPaymentMethod: { method: string; orders: number; revenueCents: number }[];
  byRegion: { region: string; orders: number; revenueCents: number }[];
};

const DAY = 86_400_000;
const PRESETS: [number, 'day' | 'month', string][] = [
  [7, 'day', '7 days'],
  [30, 'day', '30 days'],
  [365, 'month', '12 months'],
];
const today = () => phnomPenhDate(new Date());
const daysAgo = (n: number) => phnomPenhDate(new Date(Date.now() - n * DAY));

// Dates are plain YYYY-MM-DD strings, so do the arithmetic in UTC and never meet a time zone.
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const shiftDays = (iso: string, n: number) =>
  new Date(utc(iso) + n * DAY).toISOString().slice(0, 10);
const spanDays = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY) + 1;
/** The stretch of the same length that ends the day before `from`. */
export function previousRange(from: string, to: string) {
  const days = spanDays(from, to);
  const end = shiftDays(from, -1);
  return { from: shiftDays(end, -(days - 1)), to: end, days };
}

const percent = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 });
const shortDay = (iso: string, groupBy: 'day' | 'month') =>
  new Date(`${iso}${groupBy === 'month' ? '-01' : ''}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    ...(groupBy === 'day'
      ? { day: 'numeric', month: 'short' }
      : { month: 'short', year: 'numeric' }),
  });

export default function Reports() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [groupBy, setGroupBy] = useState<'day' | 'month'>('day');
  const valid = Boolean(from && to && from <= to);
  const range = `from=${from}&to=${to}`;
  const prev = valid ? previousRange(from, to) : undefined;
  const opts = { placeholderData: keepPreviousData, enabled: valid };
  const summary = useQuery({
    queryKey: ['admin', 'reports', 'summary', range, groupBy],
    queryFn: () => api<Summary>(`/admin/reports/summary?${range}&groupBy=${groupBy}`),
    ...opts,
  });
  // The period just before, to show whether things are going up or down.
  const before = useQuery({
    queryKey: ['admin', 'reports', 'summary', 'previous', prev?.from, prev?.to],
    queryFn: () =>
      api<Summary>(`/admin/reports/summary?from=${prev!.from}&to=${prev!.to}&groupBy=day`),
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

  const data = summary.data;
  const best = data?.buckets.reduce((a, b) => (b.revenueCents > a.revenueCents ? b : a), {
    period: '',
    orders: 0,
    units: 0,
    revenueCents: 0,
  });
  const versus = prev ? `previous ${prev.days} ${prev.days === 1 ? 'day' : 'days'}` : '';

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Sales for the dates you pick. Cancelled orders are left out."
        actions={
          // The printed report for the dates and the grouping on screen: totals, products, payments and every order.
          valid ? (
            <a
              className="btn-ghost btn-sm"
              href={apiUrl(`/admin/reports/report.pdf?${range}&groupBy=${groupBy}&download=1`)}
            >
              <Download className="size-4" aria-hidden /> Download report (PDF)
            </a>
          ) : (
            <span className="btn-ghost btn-sm opacity-50" aria-disabled="true">
              <Download className="size-4" aria-hidden /> Download report (PDF)
            </span>
          )
        }
      />

      <div className="panel mb-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-3 p-3">
        <div className="segmented" role="group" aria-label="Period">
          {PRESETS.map(([days, g, label]) => {
            const on = from === daysAgo(days - 1) && to === today() && groupBy === g;
            return (
              <button
                key={label}
                type="button"
                className="segment min-h-10"
                aria-pressed={on}
                onClick={() => preset(days, g)}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <label>
              <span className="sr-only">From</span>
              <DatePicker
                aria-label="From"
                className="field w-auto py-2 text-sm"
                value={from}
                max={to}
                onChange={setFrom}
                allowClear={false}
              />
            </label>
            <span className="text-sm text-muted" aria-hidden>
              to
            </span>
            <label>
              <span className="sr-only">To</span>
              <DatePicker
                aria-label="To"
                className="field w-auto py-2 text-sm"
                value={to}
                min={from}
                onChange={setTo}
                allowClear={false}
              />
            </label>
          </div>
          <div className="segmented" role="group" aria-label="Group by">
            {(['day', 'month'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroupBy(g)}
                aria-pressed={groupBy === g}
                className="segment min-h-10 capitalize"
              >
                By {g}
              </button>
            ))}
          </div>
        </div>
      </div>

      {summary.error ? (
        <ErrorState message={(summary.error as Error).message} onRetry={() => summary.refetch()} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              icon={Banknote}
              label="Revenue"
              value={formatUsdExact(data.totals.revenueCents)}
              sub={
                <Change
                  now={data.totals.revenueCents}
                  before={before.data?.totals.revenueCents}
                  versus={versus}
                />
              }
              highlight
            />
            <StatTile
              icon={Receipt}
              label="Orders"
              value={String(data.totals.orders)}
              sub={
                <Change
                  now={data.totals.orders}
                  before={before.data?.totals.orders}
                  versus={versus}
                />
              }
            />
            <StatTile
              icon={Package}
              label="Items sold"
              value={String(data.totals.units)}
              sub={
                <Change
                  now={data.totals.units}
                  before={before.data?.totals.units}
                  versus={versus}
                />
              }
            />
            <StatTile
              icon={Calculator}
              label="Average order"
              value={formatUsdExact(data.totals.averageOrderCents)}
              sub={
                <Change
                  now={data.totals.averageOrderCents}
                  before={before.data?.totals.averageOrderCents}
                  versus={versus}
                />
              }
            />
          </div>

          <Section
            className="mt-5 min-w-0"
            title={`Revenue by ${groupBy}`}
            description={
              best && best.revenueCents > 0
                ? `Best ${groupBy}: ${shortDay(best.period, groupBy)}, ${formatUsdExact(best.revenueCents)} from ${best.orders} ${best.orders === 1 ? 'order' : 'orders'}. Days are Phnom Penh time.`
                : 'Days are Phnom Penh time.'
            }
          >
            {data.totals.orders === 0 ? (
              <EmptyState icon={LineChart} title="No sales in these dates">
                Try a longer period, or check that the orders were not cancelled.
              </EmptyState>
            ) : (
              <RevenueChart buckets={data.buckets} groupBy={groupBy} />
            )}
            {data.totals.orders > 0 && (
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
                      {data.buckets.map((b) => (
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
            )}
          </Section>
        </>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <Section
          title="Top products"
          description="Ranked by revenue. The bar shows each product's share of the leader."
          className="min-w-0"
        >
          {top.data && top.data.items.length === 0 ? (
            <p className="text-sm text-muted">No sales in these dates.</p>
          ) : (
            <ol className="space-y-3.5">
              {top.data?.items.map((p, i) => {
                const lead = Math.max(...top.data!.items.map((x) => x.revenueCents), 1);
                return (
                  <li
                    key={p.productId}
                    className="grid grid-cols-[1.5rem_1fr_5.5rem] items-baseline gap-x-3"
                  >
                    <span className="text-sm font-bold text-muted tabular-nums">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{p.name}</p>
                      <Bar share={p.revenueCents / lead} className="mt-1.5" />
                    </div>
                    <div className="text-right tabular-nums">
                      <p className="font-bold">{formatUsdExact(p.revenueCents)}</p>
                      <p className="text-xs text-muted">{p.units} sold</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Section>
        <div className="min-w-0 space-y-5">
          <Split
            title="How customers paid"
            rows={
              split.data?.byPaymentMethod.map((r) => ({
                key: r.method,
                label: t.payment[r.method] ?? r.method,
                ...r,
              })) ?? []
            }
          />
          <Split
            title="Where orders went"
            rows={
              split.data?.byRegion.map((r) => ({
                key: r.region,
                label: t.region[r.region] ?? r.region,
                ...r,
              })) ?? []
            }
          />
        </div>
      </div>
    </div>
  );
}

/** How much this number moved against the previous period, with an arrow and a sign (never colour alone). */
function Change({
  now,
  before,
  versus,
}: {
  now: number;
  before: number | undefined;
  versus: string;
}) {
  if (before === undefined) return <span aria-hidden>&nbsp;</span>;
  if (before === 0) return <span>No sales in the {versus}</span>;
  const delta = (now - before) / before;
  if (Math.abs(delta) < 0.0005) return <span>No change vs {versus}</span>;
  const up = delta > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span
        className={`inline-flex items-center gap-1 font-bold ${up ? 'text-green' : 'text-danger'}`}
      >
        <Icon className="size-3.5" aria-hidden />
        <span className="sr-only">{up ? 'Up' : 'Down'} </span>
        {up ? '+' : '−'}
        {percent.format(Math.abs(delta))}
      </span>
      <span>vs {versus}</span>
    </span>
  );
}

/** A thin bar: `share` is 0 to 1. */
function Bar({ share, className = '' }: { share: number; className?: string }) {
  const pct = Math.max(0, Math.min(1, share)) * 100;
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-raised ${className}`} aria-hidden>
      <div
        className="h-full rounded-full bg-yellow"
        style={{ width: `${pct === 0 ? 0 : Math.max(pct, 2)}%` }}
      />
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
  const total = rows.reduce((sum, r) => sum + r.revenueCents, 0);
  return (
    <Section title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No sales in these dates.</p>
      ) : (
        <ul className="space-y-4 text-sm">
          {rows.map((r) => {
            const share = total ? r.revenueCents / total : 0;
            return (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{r.label}</span>
                  <span className="font-bold tabular-nums">{formatUsdExact(r.revenueCents)}</span>
                </div>
                <Bar share={share} className="my-1.5" />
                <p className="text-xs text-muted tabular-nums">
                  {percent.format(share)} of revenue · {r.orders}{' '}
                  {r.orders === 1 ? 'order' : 'orders'}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
