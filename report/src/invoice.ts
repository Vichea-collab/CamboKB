import { formatPhone, formatUsd, phnomPenhDate } from '@cambo/shared';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import jsreport from '@jsreport/jsreport-core';
import chromePdf from '@jsreport/jsreport-chrome-pdf';
import handlebars from '@jsreport/jsreport-handlebars';
import type pg from 'pg';
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

/**
 * Start an embedded jsreport (Handlebars + headless Chrome). Start once per process;
 * a small Chrome pool renders invoices concurrently.
 */
export async function createInvoiceRenderer(
  opts: { chromePath?: string; workers?: number } = {},
): Promise<InvoiceRenderer> {
  const getTemplate = () => readFile(TEMPLATE_PATH, 'utf8');
  // Inlined: the renderer has no network and the template stays one self-contained document.
  const logo = `data:image/png;base64,${(await readFile(LOGO_PATH)).toString('base64')}`;
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
    async renderHtml(data, store) {
      const template = await getTemplate();
      const res = await reporter.render({
        template: { content: template, engine: 'handlebars', recipe: 'html' },
        data: invoiceView(data, store, logo),
      });
      return res.content.toString('utf8');
    },
    async render(data, store) {
      const template = await getTemplate();
      const res = await reporter.render({
        template: {
          content: template,
          engine: 'handlebars',
          recipe: 'chrome-pdf',
          chrome: {
            format: 'A4',
            printBackground: true,
            marginTop: '0',
            marginBottom: '0',
            marginLeft: '0',
            marginRight: '0',
          },
        },
        data: invoiceView(data, store, logo),
      });
      return res.content;
    },
    async renderSalesHtml(data, store) {
      const res = await reporter.render({
        template: { content: await readFile(SALES_TEMPLATE_PATH, 'utf8'), engine: 'handlebars', recipe: 'html' },
        data: salesReportView(data, store, logo),
      });
      return res.content.toString('utf8');
    },
    async renderSales(data, store) {
      const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const view = salesReportView(data, store, logo);
      const res = await reporter.render({
        template: {
          content: await readFile(SALES_TEMPLATE_PATH, 'utf8'),
          engine: 'handlebars',
          recipe: 'chrome-pdf',
          chrome: {
            format: 'A4',
            printBackground: true,
            marginTop: '10mm',
            marginBottom: '16mm',
            marginLeft: '12mm',
            marginRight: '12mm',
            // Every page says what it belongs to and where it is: a report is read page by page.
            displayHeaderFooter: true,
            headerTemplate: '<span></span>',
            footerTemplate: `<div style="width:100%;font-size:7pt;font-family:Arial,sans-serif;color:#4a5260;padding:0 12mm;display:flex;justify-content:space-between;border-top:0.3mm solid #e8b23f;padding-top:1.5mm"><span>${esc(store.name)} · Sales report ${esc(view.period)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
          },
        },
        data: view,
      });
      return res.content;
    },
    close: () => reporter.close(),
  };
}
