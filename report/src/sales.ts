import type pg from 'pg';
import { periodsBetween, resolveRange, type DateRange } from './range';

/** created_at is timestamptz: the local Phnom Penh clock time of the order. */
const LOCAL = `(o.created_at AT TIME ZONE 'Asia/Phnom_Penh')`;

export type Bucket = { period: string; orders: number; units: number; revenueCents: number };

export async function salesSummary(db: pg.Pool, input: DateRange & { groupBy: 'day' | 'month' }) {
  const { start, endExclusive } = resolveRange(input);
  const fmt = input.groupBy === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
  const { rows } = await db.query<Bucket>(
    `WITH o AS (
       SELECT o.id, o.total_cents,
              to_char(date_trunc($3, ${LOCAL}), $4) AS period,
              (SELECT coalesce(sum(i.quantity), 0) FROM order_items i WHERE i.order_id = o.id) AS units
       FROM orders o
       WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status <> 'CANCELLED'
     )
     SELECT period, count(*)::int AS orders, sum(units)::int AS units, sum(total_cents)::int AS "revenueCents"
     FROM o GROUP BY period`,
    [start, endExclusive, input.groupBy, fmt],
  );
  const byPeriod = new Map(rows.map((r) => [r.period, r]));
  const buckets = periodsBetween(input, input.groupBy).map(
    (period) => byPeriod.get(period) ?? { period, orders: 0, units: 0, revenueCents: 0 },
  );
  const totals = buckets.reduce(
    (t, b) => ({
      orders: t.orders + b.orders,
      units: t.units + b.units,
      revenueCents: t.revenueCents + b.revenueCents,
    }),
    { orders: 0, units: 0, revenueCents: 0 },
  );
  return {
    buckets,
    totals: {
      ...totals,
      averageOrderCents: totals.orders ? Math.round(totals.revenueCents / totals.orders) : 0,
    },
  };
}

export async function topProducts(db: pg.Pool, input: DateRange & { limit?: number }) {
  const { start, endExclusive } = resolveRange(input);
  const { rows } = await db.query<{
    productId: string;
    name: string;
    units: number;
    revenueCents: number;
  }>(
    `SELECT i.product_id AS "productId",
            (array_agg(i.name ORDER BY o.created_at DESC))[1] AS name,
            sum(i.quantity)::int AS units, sum(i.line_total_cents)::int AS "revenueCents"
     FROM order_items i
     JOIN orders o ON o.id = i.order_id
     WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status <> 'CANCELLED'
     GROUP BY i.product_id
     ORDER BY "revenueCents" DESC, units DESC
     LIMIT $3`,
    [start, endExclusive, Math.min(input.limit ?? 10, 100)],
  );
  return rows;
}

export async function breakdown(db: pg.Pool, input: DateRange) {
  const { start, endExclusive } = resolveRange(input);
  const where = `o.created_at >= $1 AND o.created_at < $2 AND o.status <> 'CANCELLED'`;
  const [byPaymentMethod, byRegion] = await Promise.all([
    db.query<{ method: string; orders: number; revenueCents: number }>(
      `SELECT o.payment_method AS method, count(*)::int AS orders, sum(o.total_cents)::int AS "revenueCents"
       FROM orders o
       WHERE ${where} AND o.payment_method IS NOT NULL GROUP BY o.payment_method ORDER BY o.payment_method`,
      [start, endExclusive],
    ),
    db.query<{ region: string; orders: number; revenueCents: number }>(
      `SELECT o.region AS region, count(*)::int AS orders, sum(o.total_cents)::int AS "revenueCents"
       FROM orders o WHERE ${where} GROUP BY o.region ORDER BY o.region`,
      [start, endExclusive],
    ),
  ]);
  return { byPaymentMethod: byPaymentMethod.rows, byRegion: byRegion.rows };
}

export type CsvOrder = {
  number: string;
  date: string;
  status: string;
  customer: string;
  phone: string;
  region: string;
  service: string;
  payment: string;
  paymentStatus: string;
  items: string;
  subtotal: number;
  delivery: number;
  discount: number;
  total: number;
};

export async function ordersForCsv(db: pg.Pool, input: DateRange): Promise<CsvOrder[]> {
  const { start, endExclusive } = resolveRange(input);
  const { rows } = await db.query<CsvOrder>(
    `SELECT o.number,
            to_char(${LOCAL}, 'YYYY-MM-DD HH24:MI') AS date,
            o.status, o.contact_name AS customer, o.contact_phone AS phone,
            o.region, o.delivery_service AS service,
            coalesce(o.payment_method, '') AS payment, coalesce(o.payment_status, '') AS "paymentStatus",
            (SELECT string_agg(i.quantity || ' x ' || i.name, '; ' ORDER BY i.position) FROM order_items i WHERE i.order_id = o.id) AS items,
            o.subtotal_cents AS subtotal, o.delivery_fee_cents AS delivery, o.discount_cents AS discount, o.total_cents AS total
     FROM orders o
     WHERE o.created_at >= $1 AND o.created_at < $2
     ORDER BY o.created_at`,
    [start, endExclusive],
  );
  return rows;
}
