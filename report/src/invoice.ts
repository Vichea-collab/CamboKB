import { formatPhone, formatUsd, phnomPenhDate } from '@cambo/shared';
import PDFDocument from 'pdfkit';
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

const COLORS = { ink: '#14171c', muted: '#5b6473', accent: '#e0a100', line: '#d9dde3' };

/** A4 printable invoice. Light background on purpose: it gets printed. */
export function renderInvoicePdf(d: InvoiceData, store: { name: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Invoice ${d.number}`, Author: store.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 50;
    const right = doc.page.width - 50;
    const width = right - left;

    // Header
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(22).text(store.name, left, 50);
    doc.fillColor(COLORS.accent).fontSize(10).text('KEYBOARDS · MICE · DESK SETUP', left, 78);
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(18).text('INVOICE', left, 50, { width, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted)
      .text(d.number, left, 74, { width, align: 'right' })
      .text(phnomPenhDate(new Date(d.createdAt)), left, 88, { width, align: 'right' });

    doc.moveTo(left, 115).lineTo(right, 115).strokeColor(COLORS.line).stroke();

    // Bill to / delivery
    const col = left + width / 2;
    doc.fillColor(COLORS.muted).fontSize(9).text('BILL TO', left, 130).text('DELIVERY', col, 130);
    doc.fillColor(COLORS.ink).fontSize(11).font('Helvetica-Bold').text(d.contactName, left, 144, { width: width / 2 - 10 });
    doc.font('Helvetica').fontSize(10).text(formatPhone(d.contactPhone), left, 160);
    doc.text(`${REGION[d.region] ?? d.region} · ${SERVICE[d.deliveryService] ?? d.deliveryService}`, col, 144, { width: width / 2 });
    doc.text(d.addressLine, col, 160, { width: width / 2 });

    // Items table
    let y = Math.max(doc.y, 190) + 15;
    const cols = { item: left, qty: left + width * 0.6, price: left + width * 0.72, total: left + width * 0.86 };
    doc.rect(left, y, width, 22).fill('#f3f4f6');
    doc.fillColor(COLORS.muted).fontSize(9).font('Helvetica-Bold');
    doc.text('ITEM', cols.item + 8, y + 7).text('QTY', cols.qty, y + 7).text('PRICE', cols.price, y + 7);
    doc.text('TOTAL', cols.total, y + 7, { width: right - cols.total - 8, align: 'right' });
    y += 30;
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink);
    for (const i of d.items) {
      const h = doc.heightOfString(i.name, { width: cols.qty - cols.item - 16 });
      if (y + h > doc.page.height - 150) {
        doc.addPage();
        y = 50;
      }
      doc.text(i.name, cols.item + 8, y, { width: cols.qty - cols.item - 16 });
      doc.text(String(i.quantity), cols.qty, y).text(formatUsd(i.priceCents), cols.price, y);
      doc.text(formatUsd(i.lineTotalCents), cols.total, y, { width: right - cols.total - 8, align: 'right' });
      y += Math.max(h, 14) + 8;
      doc.moveTo(left, y - 4).lineTo(right, y - 4).strokeColor(COLORS.line).stroke();
    }

    // Totals
    y += 10;
    const line = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor(bold ? COLORS.ink : COLORS.muted);
      doc.text(label, cols.price - 40, y, { width: 120 });
      doc.fillColor(COLORS.ink).text(value, cols.total - 20, y, { width: right - cols.total + 12, align: 'right' });
      y += bold ? 22 : 18;
    };
    line('Subtotal', formatUsd(d.subtotalCents));
    line('Delivery', formatUsd(d.deliveryFeeCents));
    if (d.discountCents) line(`Discount${d.promoCode ? ` (${d.promoCode})` : ''}`, `-${formatUsd(d.discountCents)}`);
    doc.moveTo(cols.price - 40, y - 4).lineTo(right, y - 4).strokeColor(COLORS.ink).stroke();
    y += 4;
    line('Total', formatUsd(d.totalCents), true);

    // Payment and status
    y += 10;
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text('Payment', left, y);
    doc.fillColor(COLORS.ink).text(
      `${d.paymentMethod ? (PAYMENT[d.paymentMethod] ?? d.paymentMethod) : '—'} · ${d.paymentStatus ? (PAYMENT_STATUS[d.paymentStatus] ?? d.paymentStatus) : '—'}`,
      left + 80,
      y,
    );
    doc.fillColor(COLORS.muted).text('Order status', left, y + 16);
    doc.fillColor(COLORS.ink).text(title(d.status), left + 80, y + 16);
    if (d.note) {
      doc.fillColor(COLORS.muted).text('Note', left, y + 32);
      doc.fillColor(COLORS.ink).text(d.note, left + 80, y + 32, { width: width - 80 });
    }

    doc.fontSize(9).fillColor(COLORS.muted).text(`Thank you for shopping with ${store.name}!`, left, doc.page.height - 80, {
      width,
      align: 'center',
    });
    doc.end();
  });
}
