import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, WEB_ORIGIN } from './helpers';

describe('origin check', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  it('rejects state-changing requests from other origins', async () => {
    const res = await request(app).post('/api/v1/auth/logout').set('Origin', 'https://evil.test');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BAD_ORIGIN');
  });

  it('rejects state-changing requests with no origin or referer', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(403);
  });

  it('allows the web origin', async () => {
    const res = await request(app).post('/api/v1/auth/logout').set('Origin', WEB_ORIGIN);
    expect(res.status).not.toBe(403);
  });

  it('allows the Telegram webhook without an origin', async () => {
    const res = await request(app).post('/api/v1/telegram/webhook').send({});
    expect(res.status).not.toBe(403);
  });
});
