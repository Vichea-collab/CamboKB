import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFileApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createLogger } from '../src/logger';
import { MemoryStorage } from '../src/storage/memory';
import { png, SECRET, testAssets } from './fixtures';
import type { AssetRegistry } from '../src/assets';

describe('file service HTTP API', () => {
  let storage: MemoryStorage;
  let assets: AssetRegistry;
  let app: ReturnType<typeof createFileApp>;
  beforeEach(async () => {
    storage = new MemoryStorage();
    ({ assets } = await testAssets());
    const config = loadConfig({
      NODE_ENV: 'test',
      FILE_SERVICE_SECRET: SECRET,
      FILE_DATABASE_URL: process.env.FILE_DATABASE_URL_TEST,
    });
    app = createFileApp({ config, storage, assets, logger: createLogger('silent') });
  });

  const upload = async (auth = `Bearer ${SECRET}`) =>
    request(app)
      .post('/internal/images')
      .set('Authorization', auth)
      .field('prefix', 'products')
      .attach('file', await png(900, 1200), 'photo.png');

  it('requires the shared secret', async () => {
    expect((await upload('Bearer nope')).status).toBe(401);
    const res = await request(app).post('/internal/images');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('stores an image and serves it publicly with long cache headers', async () => {
    const res = await upload();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ width: 900, height: 1200 });
    const file = await request(app).get(`/files/${res.body.storageKey}-400.webp`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/webp');
    expect(file.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('deletes every variant of an image', async () => {
    const { body } = await upload();
    const del = await request(app)
      .delete(`/internal/images/${body.storageKey}`)
      .set('Authorization', `Bearer ${SECRET}`);
    expect(del.status).toBe(204);
    expect(storage.files.size).toBe(0);
    expect((await request(app).get(`/files/${body.storageKey}-400.webp`)).status).toBe(404);
  });

  it('records every stored image and file in its own database, and forgets them on delete', async () => {
    const { body } = await upload();
    const rows = (await assets.stats()).find((r) => r.kind === 'image');
    expect(rows?.count).toBe(1);
    expect(rows?.bytes).toBeGreaterThan(0);
    const row = (
      await (
        await import('./fixtures')
      )
        .testPool()
        .query('SELECT * FROM assets WHERE storage_key = $1', [body.storageKey])
    ).rows[0];
    expect(row).toMatchObject({
      kind: 'image',
      content_type: 'image/webp',
      width: 900,
      height: 1200,
    });
    await request(app)
      .delete(`/internal/images/${body.storageKey}`)
      .set('Authorization', `Bearer ${SECRET}`);
    expect(await assets.stats()).toEqual([]);

    await request(app)
      .post('/internal/files')
      .set('Authorization', `Bearer ${SECRET}`)
      .field('prefix', 'misc')
      .attach('file', Buffer.from('%PDF-1.4\n%test\n'), {
        filename: 'a.pdf',
        contentType: 'application/pdf',
      });
    expect((await assets.stats())[0]).toMatchObject({ kind: 'file', count: 1 });
  });

  it('undoes the upload when the database is unavailable, so no image is kept that it does not know about', async () => {
    const broken = {
      ...assets,
      record: () => Promise.reject(new Error('db down')),
    } as unknown as AssetRegistry;
    const config = loadConfig({
      NODE_ENV: 'test',
      FILE_SERVICE_SECRET: SECRET,
      FILE_DATABASE_URL: process.env.FILE_DATABASE_URL_TEST,
    });
    const app2 = createFileApp({ config, storage, assets: broken, logger: createLogger('silent') });
    const res = await request(app2)
      .post('/internal/images')
      .set('Authorization', `Bearer ${SECRET}`)
      .field('prefix', 'products')
      .attach('file', await png(900, 1200), 'photo.png');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
    expect(storage.files.size).toBe(0);
  });

  it('reports readiness from its database and exposes metrics (not routed publicly)', async () => {
    await upload();
    expect((await request(app).get('/readyz')).status).toBe(200);
    const metrics = (await request(app).get('/metrics')).text;
    expect(metrics).toContain('file_uploads_total{kind="image",result="ok",service="file"} 1');
    expect(metrics).toContain('file_assets{kind="image",service="file"} 1');
    expect(metrics).toContain('http_requests_total');
  });

  it('shows asset statistics to the api only', async () => {
    await upload();
    expect((await request(app).get('/internal/assets/stats')).status).toBe(401);
    const res = await request(app)
      .get('/internal/assets/stats')
      .set('Authorization', `Bearer ${SECRET}`);
    expect(res.body.assets[0]).toMatchObject({ kind: 'image', count: 1 });
  });

  it('never serves paths outside the store', async () => {
    const res = await request(app).get('/files/..%2F..%2Fetc%2Fpasswd');
    expect([400, 404]).toContain(res.status);
    expect(res.text).not.toMatch(/root:/);
  });

  it('rejects unknown prefixes', async () => {
    const res = await request(app)
      .post('/internal/images')
      .set('Authorization', `Bearer ${SECRET}`)
      .field('prefix', '../evil')
      .attach('file', await png(10, 10), 'x.png');
    expect(res.status).toBe(400);
  });

  it('stores allowed generic files and rejects others', async () => {
    const pdf = await request(app)
      .post('/internal/files')
      .set('Authorization', `Bearer ${SECRET}`)
      .field('prefix', 'misc')
      .attach('file', Buffer.from('%PDF-1.4\n%test\n'), {
        filename: 'a.pdf',
        contentType: 'application/pdf',
      });
    expect(pdf.status).toBe(201);
    expect(pdf.body.storageKey).toMatch(/^misc\/[0-9a-f-]{36}\.pdf$/);
    const html = await request(app)
      .post('/internal/files')
      .set('Authorization', `Bearer ${SECRET}`)
      .field('prefix', 'misc')
      .attach('file', Buffer.from('<script>alert(1)</script>'), {
        filename: 'a.html',
        contentType: 'text/html',
      });
    expect(html.status).toBe(400);
    expect(html.body.error.code).toBe('UNSUPPORTED_FILE');
  });

  it('rejects files over 8 MB', async () => {
    const res = await request(app)
      .post('/internal/images')
      .set('Authorization', `Bearer ${SECRET}`)
      .field('prefix', 'products')
      .attach('file', Buffer.alloc(8 * 1024 * 1024 + 1), 'big.png');
    expect(res.status).toBe(413);
  });

  it('requires a long secret in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        FILE_SERVICE_SECRET: 'short',
        FILE_DATABASE_URL: 'postgres://x',
      }),
    ).toThrow(/FILE_SERVICE_SECRET/);
  });

  it('refuses the placeholder secret in production even when it is long enough', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        FILE_SERVICE_SECRET: 'dev-file-secret-change-me-0123456789',
        FILE_DATABASE_URL: 'postgres://x',
      }),
    ).toThrow(/FILE_SERVICE_SECRET/);
  });
});

describe('share-preview images (/files/og)', () => {
  let storage: MemoryStorage;
  let app: ReturnType<typeof createFileApp>;
  beforeEach(async () => {
    storage = new MemoryStorage();
    const { assets } = await testAssets();
    app = createFileApp({
      config: loadConfig({
        NODE_ENV: 'test',
        FILE_SERVICE_SECRET: SECRET,
        FILE_DATABASE_URL: process.env.FILE_DATABASE_URL_TEST,
      }),
      storage,
      assets,
      logger: createLogger('silent'),
    });
  });

  const upload = async () =>
    (
      await request(app)
        .post('/internal/images')
        .set('Authorization', `Bearer ${SECRET}`)
        .field('prefix', 'products')
        .attach('file', await png(1600, 1200), 'photo.png')
    ).body.storageKey as string;

  it('serves a 1200x630 JPEG that Telegram, Facebook and WhatsApp can preview', async () => {
    const key = await upload();
    const res = await request(app)
      .get(`/files/og/${key}.jpg`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const sharp = (await import('sharp')).default;
    const meta = await sharp(res.body as Buffer).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 1200, height: 630 });
  });

  it('404s for images that do not exist or paths that are not images', async () => {
    expect(
      (await request(app).get('/files/og/products/00000000-0000-4000-8000-000000000000.jpg'))
        .status,
    ).toBe(404);
    expect((await request(app).get('/files/og/..%2F..%2Fetc%2Fpasswd.jpg')).status).toBe(404);
    expect(
      (await request(app).get('/files/og/misc/00000000-0000-4000-8000-000000000000.jpg')).status,
    ).toBe(404);
  });
});
