import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCategory, createProduct, createTestApp, resetDb } from './helpers';

describe('search engines and link previews', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTestApp();
  });

  it('serves robots.txt that keeps private areas out and points to the sitemap', async () => {
    const res = await request(ctx.app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toContain('Disallow: /admin');
    expect(res.text).toContain('Disallow: /account');
    expect(res.text).toContain('Disallow: /checkout');
    expect(res.text).toContain('Sitemap: http://localhost:5173/sitemap.xml');
  });

  it('lists the home page, info pages and every active product in sitemap.xml', async () => {
    await createProduct(ctx.prisma, { name: 'Visible', slug: 'visible' });
    await createProduct(ctx.prisma, { name: 'Hidden', slug: 'hidden', isActive: false });
    const res = await request(ctx.app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    expect(res.text).toContain('<loc>http://localhost:5173/</loc>');
    expect(res.text).toContain('<loc>http://localhost:5173/products/visible</loc>');
    expect(res.text).toContain('<loc>http://localhost:5173/delivery</loc>');
    expect(res.text).not.toContain('/products/hidden');
    expect(res.text).not.toContain('/admin');
  });

  describe('crawler page for a product', () => {
    it('gives link previews a title, description, photo and price', async () => {
      const cat = await createCategory(ctx.prisma, { name: 'Keyboards', slug: 'keyboards' });
      const p = await createProduct(ctx.prisma, { categoryId: cat.id, name: 'Aula F75 "Max"', slug: 'aula-f75', priceCents: 6500, specsLine: '75% Layout • Hot-Swap', description: 'Tri-mode <b>gasket</b> keyboard.' });
      const res = await request(ctx.app).get('/seo/products/aula-f75');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      const html = res.text;
      expect(html).toContain('<title>Aula F75 &quot;Max&quot; — Cambo Supply</title>');
      expect(html).toContain('<meta property="og:title" content="Aula F75 &quot;Max&quot; — Cambo Supply">');
      expect(html).toContain('<meta property="og:type" content="product">');
      expect(html).toContain('<meta property="og:url" content="http://localhost:5173/products/aula-f75">');
      expect(html).toMatch(/<meta property="og:image" content="http:\/\/localhost:4100\/files\/og\/products\/[0-9a-f-]{36}\.jpg">/);
      expect(html).toContain('<meta property="product:price:amount" content="65.00">');
      expect(html).toContain('<meta property="product:price:currency" content="USD">');
      expect(html).toContain('<link rel="canonical" href="http://localhost:5173/products/aula-f75">');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(html).toContain('<meta name="description" content="$65 · 75% Layout • Hot-Swap');
      // Customer-controlled text is escaped everywhere.
      expect(html).not.toContain('<b>gasket</b>');
      expect(p.id).toBeTruthy();
    });

    it('gives Google price and stock through Product structured data', async () => {
      await createProduct(ctx.prisma, { name: 'In Stock', slug: 'in-stock', priceCents: 2100, stock: 5 });
      await createProduct(ctx.prisma, { name: 'Gone', slug: 'gone', stock: 0 });
      const json = (html: string) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]!);
      const a = json((await request(ctx.app).get('/seo/products/in-stock')).text);
      expect(a).toMatchObject({ '@type': 'Product', name: 'In Stock', offers: { '@type': 'Offer', price: '21.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } });
      const b = json((await request(ctx.app).get('/seo/products/gone')).text);
      expect(b.offers.availability).toBe('https://schema.org/OutOfStock');
    });

    it('cannot be broken out of the structured data by product text', async () => {
      await createProduct(ctx.prisma, { name: '</script><script>alert(1)</script>', slug: 'evil' });
      const html = (await request(ctx.app).get('/seo/products/evil')).text;
      expect(html).not.toContain('<script>alert(1)</script>');
      expect((html.match(/<script/g) ?? []).length).toBe(1);
    });

    it('404s for hidden or unknown products and carries a human link for people who land here', async () => {
      await createProduct(ctx.prisma, { name: 'Hidden', slug: 'hidden', isActive: false });
      expect((await request(ctx.app).get('/seo/products/hidden')).status).toBe(404);
      expect((await request(ctx.app).get('/seo/products/nope')).status).toBe(404);
      await createProduct(ctx.prisma, { name: 'Shown', slug: 'shown' });
      expect((await request(ctx.app).get('/seo/products/shown')).text).toContain('<a href="http://localhost:5173/products/shown">');
    });
  });
});
