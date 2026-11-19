import type { OrderSnapshot } from '@cambo/shared';
import type pg from 'pg';

export type ApplyResult = 'applied' | 'stale';

/**
 * Store one version of an order. Applying the same snapshot twice changes nothing, and a snapshot
 * older than the one already stored is ignored, so events may arrive late, twice or out of order.
 */
export async function applySnapshot(
  pool: pg.Pool,
  o: OrderSnapshot,
  emittedAt: string,
): Promise<ApplyResult> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const upsert = await db.query(
      `INSERT INTO orders (id, number, status, created_at, contact_name, contact_phone, region, delivery_service, address_line, note,
                           subtotal_cents, delivery_fee_cents, discount_cents, total_cents, promo_code, payment_method, payment_status, emitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET
         number = EXCLUDED.number, status = EXCLUDED.status, contact_name = EXCLUDED.contact_name, contact_phone = EXCLUDED.contact_phone,
         region = EXCLUDED.region, delivery_service = EXCLUDED.delivery_service, address_line = EXCLUDED.address_line, note = EXCLUDED.note,
         subtotal_cents = EXCLUDED.subtotal_cents, delivery_fee_cents = EXCLUDED.delivery_fee_cents, discount_cents = EXCLUDED.discount_cents,
         total_cents = EXCLUDED.total_cents, promo_code = EXCLUDED.promo_code, payment_method = EXCLUDED.payment_method,
         payment_status = EXCLUDED.payment_status, emitted_at = EXCLUDED.emitted_at, updated_at = now()
       WHERE orders.emitted_at <= EXCLUDED.emitted_at
       RETURNING id`,
      [
        o.id,
        o.number,
        o.status,
        o.createdAt,
        o.contactName,
        o.contactPhone,
        o.region,
        o.deliveryService,
        o.addressLine,
        o.note,
        o.subtotalCents,
        o.deliveryFeeCents,
        o.discountCents,
        o.totalCents,
        o.promoCode,
        o.payment?.method ?? null,
        o.payment?.status ?? null,
        emittedAt,
      ],
    );
    if (upsert.rowCount === 0) {
      await db.query('ROLLBACK');
      return 'stale';
    }
    await db.query('DELETE FROM order_items WHERE order_id = $1', [o.id]);
    if (o.items.length) {
      await db.query(
        `INSERT INTO order_items (order_id, position, product_id, name, quantity, price_cents, line_total_cents)
         SELECT $1, * FROM unnest($2::int[], $3::uuid[], $4::text[], $5::int[], $6::int[], $7::int[])`,
        [
          o.id,
          o.items.map((_, i) => i),
          o.items.map((i) => i.productId),
          o.items.map((i) => i.name),
          o.items.map((i) => i.quantity),
          o.items.map((i) => i.priceCents),
          o.items.map((i) => i.lineTotalCents),
        ],
      );
    }
    await db.query('COMMIT');
    return 'applied';
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    db.release();
  }
}

export async function orderStats(
  pool: pg.Pool,
): Promise<{ orders: number; newestEventAgeSeconds: number | null }> {
  const { rows } = await pool.query<{ orders: number; age: number | null }>(
    `SELECT count(*)::int AS orders, extract(epoch FROM now() - max(emitted_at))::float AS age FROM orders`,
  );
  return { orders: rows[0]!.orders, newestEventAgeSeconds: rows[0]!.age };
}
