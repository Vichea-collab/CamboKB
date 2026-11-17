import { randomUUID } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import { FileError } from './errors';
import type { StorageAdapter } from './storage/types';

export const IMAGE_WIDTHS = [400, 800, 1200] as const;
export const IMAGE_PREFIXES = ['products', 'banners'] as const;
export type ImagePrefix = (typeof IMAGE_PREFIXES)[number];
const ACCEPTED = new Set(['jpeg', 'png', 'webp']);

/**
 * Validate, auto-rotate, strip metadata and store WebP variants at each width
 * (never larger than the original; the smallest is always written).
 */
export async function processImage(
  storage: StorageAdapter,
  input: Buffer,
  prefix: ImagePrefix,
): Promise<{ storageKey: string; width: number; height: number }> {
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new FileError(400, 'UNSUPPORTED_IMAGE', 'Upload a JPEG, PNG or WebP image');
  }
  if (!meta.format || !ACCEPTED.has(meta.format) || !meta.width || !meta.height) {
    throw new FileError(400, 'UNSUPPORTED_IMAGE', 'Upload a JPEG, PNG or WebP image');
  }
  const swap = (meta.orientation ?? 1) >= 5;
  const width = swap ? meta.height : meta.width;
  const height = swap ? meta.width : meta.height;

  const storageKey = `${prefix}/${randomUUID()}`;
  const targets = IMAGE_WIDTHS.filter((w, i) => i === 0 || w <= width);
  await Promise.all(
    targets.map(async (w) => {
      const body = await sharp(input)
        .rotate()
        .resize({ width: Math.min(w, width), withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      await storage.put(`${storageKey}-${w}.webp`, body, 'image/webp');
    }),
  );
  return { storageKey, width, height };
}

export async function deleteImage(storage: StorageAdapter, storageKey: string) {
  await Promise.all(IMAGE_WIDTHS.map((w) => storage.delete(`${storageKey}-${w}.webp`)));
}

/**
 * 1200x630 JPEG for link previews. The whole product stays visible (photos are often
 * portrait), centred on a darkened, blurred copy of itself.
 */
export async function shareImage(source: Buffer): Promise<Buffer> {
  const background = await sharp(source).resize(1200, 630, { fit: 'cover' }).blur(28).modulate({ brightness: 0.45 }).toBuffer();
  const product = await sharp(source).resize(1200, 630, { fit: 'inside', withoutEnlargement: false }).toBuffer();
  return sharp(background)
    .composite([{ input: product, gravity: 'centre' }])
    .flatten({ background: '#14171c' })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
}
