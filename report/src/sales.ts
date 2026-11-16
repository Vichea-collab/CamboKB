import type pg from 'pg';
import { periodsBetween, resolveRange, type DateRange } from './range';

const LOCAL = `(o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Phnom_Penh'`;

export type Bucket = { period: string; orders: number; units: number; revenueCents: number };

export async function salesSummary(db: pg.Pool, input: DateRange & { groupBy: 'day' | 'month' }) {
  const { start, endExclusive } = resolveRange(input);
  const fmt = input.groupBy === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
  const { rows } = await db.query<Bucket>(
    `WITH o AS (
       SELECT o.id, o."totalCents",
              to_char(date_trunc($3, ${LOCAL}), $4) AS period,
              (SELECT coalesce(sum(i.quantity), 0) FROM "OrderItem" i WHERE i."orderId" = o.id) AS units
       FROM "Order" o
       WHERE o."createdAt" >= $1 AND o."createdAt" < $2 AND o.status <> 'CANCELLED'
     )
     SELECT period, count(*)::int AS orders, sum(units)::int AS units, sum("totalCents")::int AS "revenueCents"
     FROM o GROUP BY period`,
    [start, endExclusive, input.groupBy, fmt],
  );
  const byPeriod = new Map(rows.map((r) => [r.period, r]));
  const buckets = periodsBetween(input, input.groupBy).map(
    (period) => byPeriod.get(period) ?? { period, orders: 0, units: 0, revenueCents: 0 },
  );
  const totals = buckets.reduce(
    (t, b) => ({ orders: t.orders + b.orders, units: t.units + b.units, revenueCents: t.revenueCents + b.revenueCents }),
    { orders: 0, units: 0, revenueCents: 0 },
  );
  return { buckets, totals: { ...totals, averageOrderCents: totals.orders ? Math.round(totals.revenueCents / totals.orders) : 0 } };
}

export async function topProducts(db: pg.Pool, input: DateRange & { limit?: number }) {
  const { start, endExclusive } = resolveRange(input);
  const { rows } = await db.query<{ productId: string; name: string; units: number; revenueCents: number }>(
    `SELECT i."productId", p.name, sum(i.quantity)::int AS units, sum(i."lineTotalCents")::int AS "revenueCents"
     FROM "OrderItem" i
     JOIN "Order" o ON o.id = i."orderId"
     JOIN "Product" p ON p.id = i."productId"
     WHERE o."createdAt" >= $1 AND o."createdAt" < $2 AND o.status <> 'CANCELLED'
     GROUP BY i."productId", p.name
     ORDER BY "revenueCents" DESC, units DESC
     LIMIT $3`,
    [start, endExclusive, Math.min(input.limit ?? 10, 100)],
  );
  return rows;
}

export async function breakdown(db: pg.Pool, input: DateRange) {
  const { start, endExclusive } = resolveRange(input);
  const where = `o."createdAt" >= $1 AND o."createdAt" < $2 AND o.status <> 'CANCELLED'`;
  const [byPaymentMethod, byRegion] = await Promise.all([
    db.query<{ method: string; orders: number; revenueCents: number }>(
      `SELECT pay.method::text AS method, count(*)::int AS orders, sum(o."totalCents")::int AS "revenueCents"
       FROM "Order" o JOIN "Payment" pay ON pay."orderId" = o.id
       WHERE ${where} GROUP BY pay.method ORDER BY pay.method`,
      [start, endExclusive],
    ),
    db.query<{ region: string; orders: number; revenueCents: number }>(
      `SELECT o.region::text AS region, count(*)::int AS orders, sum(o."totalCents")::int AS "revenueCents"
       FROM "Order" o WHERE ${where} GROUP BY o.region ORDER BY o.region`,
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
            o.status::text AS status, o."contactName" AS customer, o."contactPhone" AS phone,
            o.region::text AS region, o."deliveryService"::text AS service,
            coalesce(pay.method::text, '') AS payment, coalesce(pay.status::text, '') AS "paymentStatus",
            (SELECT string_agg(i.quantity || ' x ' || i.name, '; ' ORDER BY i."createdAt") FROM "OrderItem" i WHERE i."orderId" = o.id) AS items,
            o."subtotalCents" AS subtotal, o."deliveryFeeCents" AS delivery, o."discountCents" AS discount, o."totalCents" AS total
     FROM "Order" o LEFT JOIN "Payment" pay ON pay."orderId" = o.id
     WHERE o."createdAt" >= $1 AND o."createdAt" < $2
     ORDER BY o."createdAt"`,
    [start, endExclusive],
  );
  return rows;
}
