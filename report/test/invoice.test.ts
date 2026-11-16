import { extractText, getDocumentProxy } from 'unpdf';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db';
import { getInvoiceData, renderInvoicePdf } from '../src/invoice';
import { prisma, resetDb, seedCatalog, seedOrder } from './seed';

const pool = createPool(process.env.DATABASE_URL_TEST!);
afterAll(() => pool.end());

const pdfText = async (buf: Buffer) => {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true });
  return text;
};

describe('invoice', () => {
  beforeEach(resetDb);

  it('renders a PDF with the order, items and totals', async () => {
    const { user, mouse } = await seedCatalog();
    const order = await seedOrder({
      userId: user.id,
      at: '2026-11-10T03:00:00Z',
      items: [{ productId: mouse.id, name: mouse.name, priceCents: 2100, quantity: 2 }],
    });
    const data = await getInvoiceData(pool, order.id);
    expect(data).not.toBeNull();
    const pdf = await renderInvoicePdf(data!, { name: 'Cambo Supply' });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const text = await pdfText(pdf);
    for (const s of [order.number, 'Cambo Supply', 'Attack Shark X11 White', '$42', '$2', 'Total', '$44', 'Cash on Delivery', 'Dara', '+855 12 345 678']) {
      expect(text).toContain(s);
    }
  });

  it('returns null for an unknown order', async () => {
    expect(await getInvoiceData(pool, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});

describe('read-only database access', () => {
  it('refuses writes through the report pool', async () => {
    await expect(pool.query(`UPDATE "Category" SET name = 'x'`)).rejects.toThrow(/read-only/);
    await prisma.$disconnect();
  });
});
