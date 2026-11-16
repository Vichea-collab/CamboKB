import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFileApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createLogger } from '../src/logger';
import { MemoryStorage } from '../src/storage/memory';
import { png, SECRET } from './fixtures';

describe('file service HTTP API', () => {
  let storage: MemoryStorage;
  let app: ReturnType<typeof createFileApp>;
  beforeEach(() => {
    storage = new MemoryStorage();
    const config = loadConfig({ NODE_ENV: 'test', FILE_SERVICE_SECRET: SECRET });
    app = createFileApp({ config, storage, logger: createLogger('silent') });
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
    const del = await request(app).delete(`/internal/images/${body.storageKey}`).set('Authorization', `Bearer ${SECRET}`);
    expect(del.status).toBe(204);
    expect(storage.files.size).toBe(0);
    expect((await request(app).get(`/files/${body.storageKey}-400.webp`)).status).toBe(404);
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
      .attach('file', Buffer.from('%PDF-1.4\n%test\n'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(pdf.status).toBe(201);
    expect(pdf.body.storageKey).toMatch(/^misc\/[0-9a-f-]{36}\.pdf$/);
    const html = await request(app)
      .post('/internal/files')
      .set('Authorization', `Bearer ${SECRET}`)
      .field('prefix', 'misc')
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'a.html', contentType: 'text/html' });
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
    expect(() => loadConfig({ NODE_ENV: 'production', FILE_SERVICE_SECRET: 'short' })).toThrow(/FILE_SERVICE_SECRET/);
  });
});
