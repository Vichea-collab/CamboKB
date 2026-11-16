import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers';

describe('health and fallbacks', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  it('reports liveness', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('reports readiness when the database is reachable', async () => {
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
  });

  it('returns a JSON 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
