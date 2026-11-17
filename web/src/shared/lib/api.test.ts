import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

describe('api', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends JSON with credentials to /api/v1', async () => {
    const spy = respond(200, { ok: true });
    await api('/auth/login', { method: 'POST', body: { phone: '012' } });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/v1/auth/login');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', body: JSON.stringify({ phone: '012' }) });
    expect(new Headers(init!.headers).get('content-type')).toBe('application/json');
  });

  it('throws ApiError with the server error code', async () => {
    respond(400, { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: [{ path: 'x' }] } });
    await expect(api('/x')).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'Invalid request' });
    await expect(api('/x')).rejects.toBeInstanceOf(ApiError);
  });

  it('returns undefined for 204', async () => {
    respond(204, undefined);
    await expect(api('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('turns network failures into a readable error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
