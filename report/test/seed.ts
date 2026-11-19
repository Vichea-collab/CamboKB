import { randomUUID } from 'node:crypto';
import { migrate } from '@cambo/service-kit';
import type { OrderSnapshot } from '@cambo/shared';
import pg from 'pg';
import { applySnapshot } from '../src/orders';

export const pool = new pg.Pool({ connectionString: process.env.REPORT_DATABASE_URL_TEST });

/** The report service's own test database, migrated and empty. */
export async function resetDb() {
  await migrate(pool, new URL('../migrations', import.meta.url));
  await pool.query('TRUNCATE orders CASCADE');
}

export type Item = { productId: string; name: string; priceCents: number; quantity: number };
const MOUSE = { id: '8d7a0b3e-3c5a-4e0b-8f6a-0d9a8f1e2b34', name: 'Attack Shark X11 White' };
const PAD = { id: '3b1c2d4e-5f60-4a71-8b92-a3c4d5e6f708', name: 'Mousepad XL' };
export const seedCatalog = async () => ({ mouse: MOUSE, pad: PAD });

let seq = 100000;
/** Store an order the way the api's snapshot would. */
export async function seedOrder(opts: {
  at: string;
  items: Item[];
  status?: OrderSnapshot['status'];
  deliveryFeeCents?: number;
  discountCents?: number;
  region?: 'PHNOM_PENH' | 'PROVINCE';
  contactName?: string;
  method?: 'COD' | 'KHQR';
  emittedAt?: string;
}) {
  seq += 1;
  const subtotal = opts.items.reduce((s, i) => s + i.priceCents * i.quantity, 0);
  const fee = opts.deliveryFeeCents ?? 200;
  const discount = opts.discountCents ?? 0;
  const order: OrderSnapshot = {
    id: randomUUID(),
    number: `CS-${seq}`,
    status: opts.status ?? 'PENDING',
    createdAt: new Date(opts.at).toISOString(),
    contactName: opts.contactName ?? 'Dara',
    contactPhone: '+85512345678',
    region: opts.region ?? 'PHNOM_PENH',
    deliveryService: 'VET',
    addressLine: 'St. 315, Toul Kork',
    lat: null,
    lng: null,
    distanceKm: null,
    note: null,
    subtotalCents: subtotal,
    deliveryFeeCents: fee,
    discountCents: discount,
    totalCents: subtotal + fee - discount,
    promoCode: null,
    payment: { method: opts.method ?? 'COD', status: 'UNPAID' },
    items: opts.items.map((i) => ({ ...i, lineTotalCents: i.priceCents * i.quantity })),
  };
  await applySnapshot(pool, order, opts.emittedAt ?? new Date().toISOString());
  return order;
}
