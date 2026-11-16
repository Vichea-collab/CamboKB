import { formatPhone, formatUsd, phnomPenhDate } from '@cambo/shared';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import jsreport from '@jsreport/jsreport-core';
import chromePdf from '@jsreport/jsreport-chrome-pdf';
import handlebars from '@jsreport/jsreport-handlebars';
import type pg from 'pg';

export type InvoiceData = {
  number: string;
  createdAt: Date;
  status: string;
  contactName: string;
  contactPhone: string;
  region: string;
  deliveryService: string;
  addressLine: string;
  note: string | null;
  subtotalCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  totalCents: number;
  promoCode: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  items: { name: string; quantity: number; priceCents: number; lineTotalCents: number }[];
};

const REGION: Record<string, string> = { PHNOM_PENH: 'Phnom Penh', PROVINCE: 'Province' };
const SERVICE: Record<string, string> = { GRAB: 'Grab', VET: 'VET Express', JNT: 'J&T Express' };
const PAYMENT: Record<string, string> = { COD: 'Cash on Delivery', KHQR: 'KHQR' };
const PAYMENT_STATUS: Record<string, string> = { UNPAID: 'Unpaid', PENDING: 'Pending', PAID: 'Paid', FAILED: 'Failed', EXPIRED: 'Expired', REFUNDED: 'Refunded' };
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export async function getInvoiceData(db: pg.Pool, orderId: string): Promise<InvoiceData | null> {
  const { rows } = await db.query(
    `SELECT o.number, o."createdAt", o.status::text AS status, o."contactName", o."contactPhone",
            o.region::text AS region, o."deliveryService"::text AS "deliveryService", o."addressLine", o.note,
            o."subtotalCents", o."deliveryFeeCents", o."discountCents", o."totalCents",
            pc.code AS "promoCode", pay.method::text AS "paymentMethod", pay.status::text AS "paymentStatus"
     FROM "Order" o
     LEFT JOIN "PromoCode" pc ON pc.id = o."promoCodeId"
     LEFT JOIN "Payment" pay ON pay."orderId" = o.id
     WHERE o.id = $1`,
    [orderId],
  );
  if (!rows[0]) return null;
  const items = await db.query(
    `SELECT name, quantity, "priceCents", "lineTotalCents" FROM "OrderItem" WHERE "orderId" = $1 ORDER BY "createdAt"`,
    [orderId],
  );
  return { ...(rows[0] as Omit<InvoiceData, 'items'>), items: items.rows };
}

export type InvoiceRenderer = {
  render(data: InvoiceData, store: { name: string }): Promise<Buffer>;
  close(): Promise<void>;
};

const TEMPLATE_PATH = fileURLToPath(new URL('../templates/invoice.html', import.meta.url));

/** Everything the template prints, pre-formatted: the template stays logic-free and Handlebars escapes it all. */
export function invoiceView(d: InvoiceData, store: { name: string }) {
  const [first = store.name, ...rest] = store.name.split(' ');
  return {
    storeName: store.name,
    storeFirst: first,
    storeRest: rest.join(' '),
    number: d.number,
    date: phnomPenhDate(new Date(d.createdAt)),
    contactName: d.contactName,
    phone: formatPhone(d.contactPhone),
    region: REGION[d.region] ?? d.region,
    service: SERVICE[d.deliveryService] ?? d.deliveryService,
    addressLine: d.addressLine,
    note: d.note,
    items: d.items.map((i) => ({ name: i.name, quantity: i.quantity, price: formatUsd(i.priceCents), lineTotal: formatUsd(i.lineTotalCents) })),
    subtotal: formatUsd(d.subtotalCents),
    delivery: formatUsd(d.deliveryFeeCents),
    discount: d.discountCents ? formatUsd(d.discountCents) : null,
    promoCode: d.promoCode,
    total: formatUsd(d.totalCents),
    paymentMethod: d.paymentMethod ? (PAYMENT[d.paymentMethod] ?? d.paymentMethod) : '—',
    paymentStatus: d.paymentStatus ? (PAYMENT_STATUS[d.paymentStatus] ?? d.paymentStatus) : '—',
    isPaid: d.paymentStatus === 'PAID',
    status: title(d.status),
  };
}

/**
 * Start an embedded jsreport (Handlebars + headless Chrome). Start once per process;
 * a small Chrome pool renders invoices concurrently.
 */
export async function createInvoiceRenderer(opts: { chromePath?: string; workers?: number } = {}): Promise<InvoiceRenderer> {
  const template = await readFile(TEMPLATE_PATH, 'utf8');
  const reporter = jsreport({
    discover: false,
    logger: { console: { transport: 'console', level: 'error' } },
    store: { provider: 'memory' },
    blobStorage: { provider: 'memory' },
    reportTimeout: 30_000,
    trustUserCode: false,
  });
  reporter.use(handlebars());
  reporter.use(
    chromePdf({
      strategy: 'chrome-pool',
      numberOfWorkers: opts.workers ?? 2,
      launchOptions: {
        executablePath: opts.chromePath || undefined,
        // Container-friendly flags; Chrome's sandbox needs privileges Docker doesn't grant by default.
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      },
    }),
  );
  await reporter.init();

  return {
    async render(data, store) {
      const res = await reporter.render({
        template: {
          content: template,
          engine: 'handlebars',
          recipe: 'chrome-pdf',
          chrome: { format: 'A4', printBackground: true, marginTop: '0', marginBottom: '0', marginLeft: '0', marginRight: '0' },
        },
        data: invoiceView(data, store),
      });
      return res.content;
    },
    close: () => reporter.close(),
  };
}
