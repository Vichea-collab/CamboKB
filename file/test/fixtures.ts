import sharp from 'sharp';

export const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 255, g: 183, b: 3 } } })
    .png()
    .toBuffer();

/** A 100×50 JPEG tagged with EXIF orientation 6 (rotate 90° clockwise to display). */
export const rotatedJpeg = () =>
  sharp({ create: { width: 100, height: 50, channels: 3, background: { r: 20, g: 23, b: 28 } } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();

export const SECRET = 'test-file-secret-0123456789abcdef0123';

import pg from 'pg';
import { migrate } from '@cambo/service-kit';
import { AssetRegistry } from '../src/assets';

let pool: pg.Pool | undefined;
/** The file service's own test database, migrated and empty. */
export async function testAssets() {
  pool ??= new pg.Pool({ connectionString: process.env.FILE_DATABASE_URL_TEST });
  await migrate(pool, new URL('../migrations', import.meta.url));
  await pool.query('TRUNCATE assets');
  return { pool, assets: new AssetRegistry(pool) };
}

export const testPool = () => pool!;
