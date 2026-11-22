import { formatUsd, formatUsdExact, phnomPenhDate } from '@cambo/shared';
import type pg from 'pg';
import type { DateRange } from './range';
import { breakdown, ordersForCsv, salesSummary, topProducts } from './sales';

/** Everything the printed sales report is made of, as plain numbers (cents). Cancelled orders are left out of every total. */
export type SalesReportData = {
  from: string;
  to: string;
  groupBy: 'day' | 'month';
  generatedAt: Date;
  buckets: { period: string; orders: number; units: number; revenueCents: number }[];
  totals: { orders: number; units: number; revenueCents: number; averageOrderCents: number };
  products: { name: string; units: number; revenueCents: number }[];
  byPaymentMethod: { method: string; orders: number; revenueCents: number }[];
  byRegion: { region: string; orders: number; revenueCents: number }[];
  orders: {
    number: string;
    date: string;
    customer: string;
    payment: string;
    paymentStatus: string;
    subtotalCents: number;
    deliveryCents: number;
    discountCents: number;
    totalCents: number;
  }[];
  paidCents: number;
  unpaidCents: number;
  cancelled: { orders: number; totalCents: number };
};

/** Reads only this service's own database, like the invoice does. */
export async function getSalesReportData(
  db: pg.Pool,
  range: DateRange,
  groupBy: 'day' | 'month',
  now = new Date(),
): Promise<SalesReportData> {
  const [summary, products, split, all] = await Promise.all([
    salesSummary(db, { ...range, groupBy }),
    topProducts(db, { ...range, limit: 100 }),
    breakdown(db, range),
    ordersForCsv(db, range),
  ]);
  const counted = all.filter((o) => o.status !== 'CANCELLED');
  const cancelled = all.filter((o) => o.status === 'CANCELLED');
  const sum = (xs: { total: number }[]) => xs.reduce((s, o) => s + o.total, 0);
  const paid = counted.filter((o) => o.paymentStatus === 'PAID');
  return {
    ...range,
    groupBy,
    generatedAt: now,
    buckets: summary.buckets,
    totals: summary.totals,
    products,
    byPaymentMethod: split.byPaymentMethod,
    byRegion: split.byRegion,
    orders: counted.map((o) => ({
      number: o.number,
      date: o.date,
      customer: o.customer,
      payment: o.payment,
      paymentStatus: o.paymentStatus,
      subtotalCents: o.subtotal,
      deliveryCents: o.delivery,
      discountCents: o.discount,
      totalCents: o.total,
    })),
    paidCents: sum(paid),
    unpaidCents: sum(counted) - sum(paid),
    cancelled: { orders: cancelled.length, totalCents: sum(cancelled) },
  };
}

const PAYMENT: Record<string, string> = { COD: 'Cash on Delivery', KHQR: 'KHQR' };
const PAYMENT_SHORT: Record<string, string> = { COD: 'COD', KHQR: 'KHQR' };
const PAYMENT_STATUS: Record<string, string> = {
  UNPAID: 'Unpaid',
  PENDING: 'Pending',
  PAID: 'Paid',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
  REFUNDED: 'Refunded',
};
const REGION: Record<string, string> = { PHNOM_PENH: 'Phnom Penh', PROVINCE: 'Province' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "2026-11-20" → "20 Nov 2026". Plain strings in, plain strings out: no time zone can move a date. */
const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]!;
const share = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '—');

/** Everything the template prints, pre-formatted: the template stays logic-free and Handlebars escapes it all. */
export function salesReportView(d: SalesReportData, store: { name: string }, logo = '') {
  const t = d.totals;
  const sumBy = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
  const active = d.buckets.filter((b) => b.orders > 0);
  const monthly = d.groupBy === 'month';
  return {
    storeName: store.name,
    logo,
    period: d.from === d.to ? longDate(d.from) : `${longDate(d.from)} – ${longDate(d.to)}`,
    groupLabel: monthly ? 'Month' : 'Day',
    generated: `${longDate(phnomPenhDate(d.generatedAt))}`,
    reportNo: `SR-${d.from.replaceAll('-', '')}-${d.to.replaceAll('-', '')}`,
    hasSales: t.orders > 0,
    kpi: {
      revenue: formatUsdExact(t.revenueCents),
      orders: String(t.orders),
      units: String(t.units),
      average: formatUsdExact(t.averageOrderCents),
      paid: formatUsdExact(d.paidCents),
      unpaid: formatUsdExact(d.unpaidCents),
    },
    cancelled: d.cancelled.orders
      ? `${d.cancelled.orders} cancelled ${d.cancelled.orders === 1 ? 'order' : 'orders'} (${formatUsdExact(d.cancelled.totalCents)}) left out of every total.`
      : null,
    periods: active.map((b) => ({
      label: monthly
        ? `${MONTHS[Number(b.period.slice(5, 7)) - 1]} ${b.period.slice(0, 4)}`
        : `${weekday(b.period)} ${longDate(b.period)}`,
      orders: b.orders,
      units: b.units,
      revenue: formatUsdExact(b.revenueCents),
      share: share(b.revenueCents, t.revenueCents),
    })),
    emptyPeriods: d.buckets.length - active.length,
    periodNote: active.length < d.buckets.length ? `${monthly ? 'Months' : 'Days'} with no sales are left out.` : null,
    products: d.products.map((p, n) => ({
      index: n + 1,
      name: p.name,
      units: p.units,
      revenue: formatUsdExact(p.revenueCents),
      share: share(p.revenueCents, sumBy(d.products, (x) => x.revenueCents)),
    })),
    // A short list stays on one page; a long one flows over pages with its header repeated.
    keepProducts: d.products.length <= 15,
    productUnits: sumBy(d.products, (p) => p.units),
    productRevenue: formatUsdExact(sumBy(d.products, (p) => p.revenueCents)),
    methods: d.byPaymentMethod.map((m) => ({
      label: PAYMENT[m.method] ?? m.method,
      orders: m.orders,
      revenue: formatUsdExact(m.revenueCents),
      share: share(m.revenueCents, t.revenueCents),
    })),
    regions: d.byRegion.map((r) => ({
      label: REGION[r.region] ?? r.region,
      orders: r.orders,
      revenue: formatUsdExact(r.revenueCents),
      share: share(r.revenueCents, t.revenueCents),
    })),
    orders: d.orders.map((o) => ({
      number: o.number,
      date: `${longDate(o.date.slice(0, 10))} ${o.date.slice(11)}`,
      customer: o.customer,
      payment: `${PAYMENT_SHORT[o.payment] ?? o.payment} · ${PAYMENT_STATUS[o.paymentStatus] ?? o.paymentStatus}`,
      paid: o.paymentStatus === 'PAID',
      subtotal: formatUsdExact(o.subtotalCents),
      delivery: formatUsdExact(o.deliveryCents),
      discount: o.discountCents ? `-${formatUsdExact(o.discountCents)}` : '—',
      total: formatUsdExact(o.totalCents),
    })),
    sums: {
      subtotal: formatUsdExact(sumBy(d.orders, (o) => o.subtotalCents)),
      delivery: formatUsdExact(sumBy(d.orders, (o) => o.deliveryCents)),
      discount: sumBy(d.orders, (o) => o.discountCents)
        ? `-${formatUsdExact(sumBy(d.orders, (o) => o.discountCents))}`
        : '—',
      total: formatUsdExact(sumBy(d.orders, (o) => o.totalCents)),
    },
    // The short form the owner reads at a glance in the headline.
    headline: formatUsd(t.revenueCents),
  };
}
