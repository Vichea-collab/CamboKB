import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { processImage } from '../src/images';
import { MemoryStorage } from '../src/storage/memory';
import { png, rotatedJpeg } from './fixtures';

describe('processImage', () => {
  it('writes three WebP widths and reports the original size', async () => {
    const storage = new MemoryStorage();
    const out = await processImage(storage, await png(1600, 1200), 'products');
    expect(out).toMatchObject({ width: 1600, height: 1200 });
    expect(out.storageKey).toMatch(/^products\/[0-9a-f-]{36}$/);
    expect([...storage.files.keys()].sort()).toEqual(
      [`${out.storageKey}-1200.webp`, `${out.storageKey}-400.webp`, `${out.storageKey}-800.webp`],
    );
    const md = await sharp(storage.files.get(`${out.storageKey}-800.webp`)!.body).metadata();
    expect(md.format).toBe('webp');
    expect(md.width).toBe(800);
  });

  it('never upscales small images', async () => {
    const storage = new MemoryStorage();
    const out = await processImage(storage, await png(300, 300), 'banners');
    expect([...storage.files.keys()]).toEqual([`${out.storageKey}-400.webp`]);
    const md = await sharp(storage.files.get(`${out.storageKey}-400.webp`)!.body).metadata();
    expect(md.width).toBe(300);
  });

  it('rejects non-images', async () => {
    await expect(processImage(new MemoryStorage(), Buffer.from('hello'), 'products')).rejects.toMatchObject({
      code: 'UNSUPPORTED_IMAGE',
    });
  });

  it('applies EXIF orientation and strips metadata', async () => {
    const storage = new MemoryStorage();
    const out = await processImage(storage, await rotatedJpeg(), 'products');
    expect(out).toMatchObject({ width: 50, height: 100 });
    const md = await sharp(storage.files.get(`${out.storageKey}-400.webp`)!.body).metadata();
    expect(md.width).toBe(50);
    expect(md.exif).toBeUndefined();
  });
});
