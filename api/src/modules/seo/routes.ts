import { formatUsd } from '@cambo/shared';
import { Router } from 'express';
import type { AppDeps } from '../../http/app';
import { notFound } from '../../http/errors';

/** Pages people can read without logging in. Order matters only for the sitemap. */
const INFO_PAGES = ['contact', 'delivery', 'warranty', 'privacy'] as const;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** JSON for a <script type="application/ld+json"> block: no string can close the tag. */
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const dollars = (cents: number) => (cents / 100).toFixed(2);

/**
 * Plain-HTML pages for crawlers that don't run JavaScript (Telegram, Facebook, WhatsApp
 * link previews; search engines). The web server sends these user agents here; people
 * always get the app. Also robots.txt and sitemap.xml.
 */
export function seoRouter({ prisma, config, files }: AppDeps): Router {
  const r = Router();
  const site = () => (config.webOrigin[0] ?? '').replace(/\/$/, '');
  const storeName = async () => (await prisma.storeSetting.findUnique({ where: { id: 1 } }))?.storeName ?? 'Cambo Supply';

  r.get('/robots.txt', (_req, res) => {
    res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(
      ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /account', 'Disallow: /checkout', 'Disallow: /orders/', 'Disallow: /login', 'Disallow: /signup', 'Disallow: /forgot-password', '', `Sitemap: ${site()}/sitemap.xml`, ''].join('\n'),
    );
  });

  r.get('/sitemap.xml', async (_req, res) => {
    const products = await prisma.product.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } });
    const url = (path: string, lastmod?: Date) => `  <url><loc>${esc(`${site()}${path}`)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      url('/'),
      ...INFO_PAGES.map((p) => url(`/${p}`)),
      ...products.map((p) => url(`/products/${encodeURIComponent(p.slug)}`, p.updatedAt)),
      '</urlset>',
      '',
    ].join('\n');
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(xml);
  });

  r.get('/seo/products/:slug', async (req, res) => {
    const p = await prisma.product.findFirst({
      where: { slug: String(req.params.slug), isActive: true },
      include: { category: true, images: { orderBy: { sortOrder: 'asc' } }, specs: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!p) throw notFound('Product');
    const name = await storeName();
    const pageUrl = `${site()}/products/${encodeURIComponent(p.slug)}`;
    const title = `${p.name} — ${name}`;
    const description = clip([formatUsd(p.priceCents), p.specsLine, p.description].filter(Boolean).join(' · ').replace(/\s+/g, ' '), 200);
    const cover = p.images[0];
    const image = cover ? `${files.publicBase()}/og/${cover.storageKey}.jpg` : null;
    const inStock = !p.isSoldOut && p.stock > 0;

    const structured = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      description: clip([p.specsLine, p.description].filter(Boolean).join('. '), 500) || p.name,
      category: p.category.name,
      ...(image ? { image: [image] } : {}),
      url: pageUrl,
      offers: {
        '@type': 'Offer',
        url: pageUrl,
        price: dollars(p.priceCents),
        priceCurrency: 'USD',
        availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
      },
    };

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(pageUrl)}">
<meta property="og:site_name" content="${esc(name)}">
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(pageUrl)}">
${image ? `<meta property="og:image" content="${esc(image)}">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n` : ''}<meta property="product:price:amount" content="${dollars(p.priceCents)}">
<meta property="product:price:currency" content="USD">
<meta property="product:availability" content="${inStock ? 'in stock' : 'out of stock'}">
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${image ? `<meta name="twitter:image" content="${esc(image)}">\n` : ''}<script type="application/ld+json">${jsonLd(structured)}</script>
</head>
<body>
<h1>${esc(p.name)}</h1>
<p>${esc(formatUsd(p.priceCents))} · ${inStock ? 'In stock' : 'Sold out'}</p>
${p.specsLine ? `<p>${esc(p.specsLine)}</p>\n` : ''}${p.description ? `<p>${esc(p.description)}</p>\n` : ''}${p.specs.length ? `<ul>${p.specs.map((s) => `<li>${esc(s.label)}: ${esc(s.value)}</li>`).join('')}</ul>\n` : ''}<p><a href="${esc(pageUrl)}">View ${esc(p.name)} in the ${esc(name)} shop</a></p>
</body>
</html>`;
    res.type('html').set('Cache-Control', 'public, max-age=300').send(html);
  });

  return r;
}
