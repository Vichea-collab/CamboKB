import { formatPhone, formatUsd, phnomPenhDate } from '@cambo/shared';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import type pg from 'pg';
import { createPdfPrinter } from './pdf';
import { salesReportView, type SalesReportData } from './sales-report';

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
const PAYMENT_STATUS: Record<string, string> = {
  UNPAID: 'Unpaid',
  PENDING: 'Pending',
  PAID: 'Paid',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
  REFUNDED: 'Refunded',
};
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** Reads only this service's own database (the copy of the order kept from the api's snapshots). */
export async function getInvoiceData(db: pg.Pool, orderId: string): Promise<InvoiceData | null> {
  const { rows } = await db.query(
    `SELECT o.number, o.created_at AS "createdAt", o.status, o.contact_name AS "contactName", o.contact_phone AS "contactPhone",
            o.region, o.delivery_service AS "deliveryService", o.address_line AS "addressLine", o.note,
            o.subtotal_cents AS "subtotalCents", o.delivery_fee_cents AS "deliveryFeeCents", o.discount_cents AS "discountCents", o.total_cents AS "totalCents",
            o.promo_code AS "promoCode", o.payment_method AS "paymentMethod", o.payment_status AS "paymentStatus"
     FROM orders o
     WHERE o.id = $1`,
    [orderId],
  );
  if (!rows[0]) return null;
  const items = await db.query(
    `SELECT name, quantity, price_cents AS "priceCents", line_total_cents AS "lineTotalCents" FROM order_items WHERE order_id = $1 ORDER BY position`,
    [orderId],
  );
  return { ...(rows[0] as Omit<InvoiceData, 'items'>), items: items.rows };
}

export type InvoiceRenderer = {
  render(data: InvoiceData, store: { name: string }): Promise<Buffer>;
  /** The same invoice as a web page, for looking at it before downloading the PDF. */
  renderHtml(data: InvoiceData, store: { name: string }): Promise<string>;
  /** The sales report for a range of dates, as a PDF in the invoice's style. */
  renderSales(data: SalesReportData, store: { name: string }): Promise<Buffer>;
  /** The same report as a web page, for looking at it before downloading the PDF. */
  renderSalesHtml(data: SalesReportData, store: { name: string }): Promise<string>;
  close(): Promise<void>;
};

const TEMPLATE_PATH = fileURLToPath(new URL('../templates/invoice.html', import.meta.url));
const SALES_TEMPLATE_PATH = fileURLToPath(new URL('../templates/sales-report.html', import.meta.url));
const LOGO_PATH = fileURLToPath(new URL('../templates/logo.png', import.meta.url));

/** The printed form always shows at least this many item rows, like the paper invoice. */
const MIN_ROWS = 13;

/** Everything the template prints, pre-formatted: the template stays logic-free and Handlebars escapes it all. */
export function invoiceView(d: InvoiceData, store: { name: string }, logo = '') {
  return {
    storeName: store.name,
    logo,
    number: d.number,
    date: phnomPenhDate(new Date(d.createdAt)),
    contactName: d.contactName,
    phone: formatPhone(d.contactPhone),
    region: REGION[d.region] ?? d.region,
    service: SERVICE[d.deliveryService] ?? d.deliveryService,
    addressLine: d.addressLine,
    note: d.note,
    items: d.items.map((i, n) => ({
      index: n + 1,
      name: i.name,
      quantity: i.quantity,
      price: formatUsd(i.priceCents),
      lineTotal: formatUsd(i.lineTotalCents),
    })),
    blankRows: Array.from({ length: Math.max(0, MIN_ROWS - d.items.length) }, (_, n) => n),
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

/** The templates (Handlebars, which escapes every value) and the PDF printer. Start once per process. */
export async function createInvoiceRenderer(
  opts: { chromePath?: string; workers?: number; idleMs?: number } = {},
): Promise<InvoiceRenderer> {
  const compile = async (path: string) => Handlebars.compile(await readFile(path, 'utf8'));
  const invoice = await compile(TEMPLATE_PATH);
  const sales = await compile(SALES_TEMPLATE_PATH);
  // Inlined: the printer has no network and the template stays one self-contained document.
  const logo = `data:image/png;base64,${(await readFile(LOGO_PATH)).toString('base64')}`;
  const printer = createPdfPrinter({ chromePath: opts.chromePath, concurrency: opts.workers, idleMs: opts.idleMs });

  return {
    async renderHtml(data, store) {
      return invoice(invoiceView(data, store, logo));
    },
    async render(data, store) {
      return printer.print(invoice(invoiceView(data, store, logo)), {
        format: 'A4',
        printBackground: true,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
      });
    },
    async renderSalesHtml(data, store) {
      return sales(salesReportView(data, store, logo));
    },
    async renderSales(data, store) {
      const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const view = salesReportView(data, store, logo);
      return printer.print(sales(view), {
        format: 'A4',
        printBackground: true,
        margin: { top: '10mm', bottom: '16mm', left: '12mm', right: '12mm' },
        // Every page says what it belongs to and where it is: a report is read page by page.
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="width:100%;font-size:7pt;font-family:Arial,sans-serif;color:#4a5260;padding:0 12mm;display:flex;justify-content:space-between;border-top:0.3mm solid #e8b23f;padding-top:1.5mm"><span>${esc(store.name)} · Sales report ${esc(view.period)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      });
    },
    close: () => printer.close(),
  };
}
