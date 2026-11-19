import { formatUsdExact, phnomPenhDate } from '@cambo/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Banknote,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  PackageX,
  QrCode,
  TrendingUp,
  type LucideIcon,
  Undo2,
} from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../../shared/lib/api';
import type { Paged } from '../../shared/lib/types';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Section } from '../../shared/ui/Page';
import { StatTile as Tile } from './components/StatTile';
import { Loading, PageHeader } from './components/ui';
import type { AdminOrder } from './types';

type Stats = {
  today: { orders: number; revenueCents: number };
  week: { orders: number; revenueCents: number };
  pendingCount: number;
  khqrWaitingCount: number;
  refundsDue: { orderId: string; number: string; amountCents: number }[];
  lowStock: { id: string; name: string; stock: number }[];
};
type Summary = { buckets: { period: string; revenueCents: number }[] };

const DAY = 86_400_000;

export default function Dashboard() {
  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api<Stats>('/admin/stats'),
    refetchInterval: 30_000,
  });
  const latest = useQuery({
    queryKey: ['admin', 'orders', 'latest'],
    queryFn: () => api<Paged<AdminOrder>>('/admin/orders?pageSize=6'),
    refetchInterval: 30_000,
  });
  // The trend comes from the report service; if it is down the tile simply has no line.
  const trend = useQuery({
    queryKey: ['admin', 'reports', 'trend-7d'],
    queryFn: () =>
      api<Summary>(
        `/admin/reports/summary?from=${phnomPenhDate(new Date(Date.now() - 6 * DAY))}&to=${phnomPenhDate(new Date())}&groupBy=day`,
      ),
    retry: false,
    staleTime: 60_000,
  });
  if (!stats.data) return <Loading />;
  const s = stats.data;
  const attention = s.pendingCount > 0 || s.khqrWaitingCount > 0 || s.lowStock.length > 0 || (s.refundsDue?.length ?? 0) > 0;

  return (
    <div>
      <PageHeader title="Dashboard" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          icon={Banknote}
          label="Revenue today"
          value={formatUsdExact(s.today.revenueCents)}
          sub={`${s.today.orders} ${s.today.orders === 1 ? 'order' : 'orders'}`}
        />
        <Tile
          icon={TrendingUp}
          label="Last 7 days"
          value={formatUsdExact(s.week.revenueCents)}
          sub={`${s.week.orders} ${s.week.orders === 1 ? 'order' : 'orders'}`}
          chart={trend.data?.buckets.map((b) => b.revenueCents)}
        />
        <Tile
          icon={ClipboardList}
          label="Pending orders"
          value={String(s.pendingCount)}
          sub={s.pendingCount ? 'waiting for you' : 'nothing waiting'}
          to="/admin/orders?status=PENDING"
          highlight={s.pendingCount > 0}
        />
        <Tile
          icon={PackageX}
          label="Low stock"
          value={String(s.lowStock.length)}
          sub="3 or fewer left"
          highlight={s.lowStock.length > 0}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <Section
          className="min-w-0"
          title="Latest orders"
          actions={
            <Link
              to="/admin/orders"
              className="link -my-2 inline-flex min-h-10 items-center gap-0.5 text-sm"
            >
              All orders <ChevronRight className="size-4" aria-hidden />
            </Link>
          }
        >
          <ul className="-mt-2 divide-y divide-line">
            {latest.data?.items.map((o) => (
              <li key={o.id}>
                <Link
                  to={`/admin/orders/${o.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 py-3 transition-colors hover:text-yellow"
                >
                  <span className="flex min-w-0 items-baseline gap-3">
                    <span className="font-display font-extrabold tabular-nums">{o.number}</span>
                    <span className="min-w-0 truncate text-sm text-muted">{o.contactName}</span>
                  </span>
                  <span className="text-right font-bold tabular-nums">
                    {formatUsdExact(o.totalCents)}
                  </span>
                  <span className="col-span-2">
                    <StatusBadge status={o.status} payment={o.payment?.status} />
                  </span>
                </Link>
              </li>
            ))}
            {latest.data?.items.length === 0 && (
              <li className="py-8 text-center text-sm text-muted">
                No orders yet. They'll appear here as customers order.
              </li>
            )}
          </ul>
        </Section>

        <Section className="min-w-0" title="Needs attention">
          {!attention ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <CheckCircle2 className="size-5 text-green" aria-hidden /> You're all caught up.
            </p>
          ) : (
            <ul className="space-y-2">
              {(s.refundsDue ?? []).map((r) => (
                <Action
                  key={r.orderId}
                  to={`/admin/orders/${r.orderId}`}
                  icon={Undo2}
                  title={`Refund ${formatUsdExact(r.amountCents)} for ${r.number}`}
                  hint="Paid, then cancelled. Send the money back, then mark it refunded."
                  danger
                />
              ))}
              {s.pendingCount > 0 && (
                <Action
                  to="/admin/orders?status=PENDING"
                  icon={ClipboardList}
                  title={`${s.pendingCount} ${s.pendingCount === 1 ? 'order' : 'orders'} to confirm`}
                  hint="Call or message the customer, then confirm."
                />
              )}
              {s.khqrWaitingCount > 0 && (
                <Action
                  to="/admin/orders?status=PENDING"
                  icon={QrCode}
                  title={`${s.khqrWaitingCount} waiting for KHQR payment`}
                  hint="Confirms by itself when the money arrives."
                />
              )}
              {s.lowStock.slice(0, 4).map((p) => (
                <Action
                  key={p.id}
                  to={`/admin/products/${p.id}`}
                  icon={PackageX}
                  title={p.name}
                  hint={
                    p.stock === 0 ? 'Sold out. Restock to sell again.' : `Only ${p.stock} left.`
                  }
                  danger={p.stock === 0}
                />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Action({
  to,
  icon: Icon,
  title,
  hint,
  danger,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  hint: string;
  danger?: boolean;
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex items-center gap-3 rounded-xl bg-raised/60 p-3 ring-1 ring-line transition hover:ring-yellow/50"
      >
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-xl ${danger ? 'bg-danger/15 text-danger' : 'bg-yellow/12 text-yellow'}`}
        >
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{title}</span>
          <span className="block text-xs text-muted">{hint}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}
