import type { Banner, Category, Product, ProductImage, ProductSpec } from '@prisma/client';
import type { FileClient } from '../../integrations/files/client';

export type ProductWithRelations = Product & { category: Category; images: ProductImage[]; specs?: ProductSpec[] };

export const productInclude = {
  category: true,
  images: { orderBy: { sortOrder: 'asc' } },
  specs: { orderBy: { sortOrder: 'asc' } },
} as const;

const soldOut = (p: Product) => p.isSoldOut || p.stock <= 0;

export function toProductCard(p: ProductWithRelations, files: FileClient) {
  const first = p.images[0];
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    specsLine: p.specsLine,
    priceCents: p.priceCents,
    compareAtCents: p.compareAtCents,
    isSoldOut: soldOut(p),
    category: { slug: p.category.slug, name: p.category.name },
    image: first ? files.imageUrls(first.storageKey, first.width) : null,
    imageCount: p.images.length,
  };
}

export function toProductDetail(p: ProductWithRelations, files: FileClient) {
  return {
    ...toProductCard(p, files),
    description: p.description,
    stock: p.stock,
    specs: (p.specs ?? []).map((s) => ({ label: s.label, value: s.value })),
    images: p.images.map((i) => ({ id: i.id, width: i.width, height: i.height, ...files.imageUrls(i.storageKey, i.width) })),
  };
}

export function toBanner(b: Banner, files: FileClient) {
  return { id: b.id, linkUrl: b.linkUrl, width: b.width, height: b.height, image: files.imageUrls(b.storageKey, b.width) };
}

export const toCategory = (c: Category) => ({ id: c.id, name: c.name, slug: c.slug, sortOrder: c.sortOrder });
