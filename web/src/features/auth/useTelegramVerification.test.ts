import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/lib/api', async (orig) => ({ ...(await orig<typeof import('../../shared/lib/api')>()), api: vi.fn() }));
import { api } from '../../shared/lib/api';
import { useTelegramVerification } from './useTelegramVerification';

const mockApi = vi.mocked(api);
const START = { requestId: '7f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b11', deepLink: 'https://t.me/CamboSupplyBot?start=abc', expiresAt: '2030-01-01T00:00:00Z' };

describe('useTelegramVerification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'open').mockReturnValue(null);
    mockApi.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const statuses = (...list: object[]) => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/auth/telegram/current')) return { request: null };
      if (path === '/auth/telegram/start') return START;
      return list.length > 1 ? list.shift() : list[0];
    });
  };
  const statusCalls = () => mockApi.mock.calls.filter(([p]) => String(p).endsWith('/status')).length;

  it('starts, opens Telegram and polls until verified', async () => {
    statuses({ status: 'PENDING' }, { status: 'VERIFIED', phone: '+855 •• ••• 678', firstName: 'Dara' });
    const { result } = renderHook(() => useTelegramVerification('LOGIN'));
    await act(() => result.current.start());
    expect(mockApi).toHaveBeenCalledWith('/auth/telegram/start', { method: 'POST', body: { purpose: 'LOGIN' } });
    expect(window.open).toHaveBeenCalledWith(START.deepLink, '_blank', 'noopener');
    expect(result.current.status).toBe('waiting');
    expect(result.current.deepLink).toBe(START.deepLink);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.status).toBe('waiting');
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current).toMatchObject({ status: 'verified', maskedPhone: '+855 •• ••• 678', firstName: 'Dara', requestId: START.requestId });

    const calls = statusCalls();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(statusCalls()).toBe(calls);
  });

  it('reports an expired request', async () => {
    statuses({ status: 'EXPIRED' });
    const { result } = renderHook(() => useTelegramVerification('CHANGE_PHONE', '012345678'));
    await act(() => result.current.start());
    expect(mockApi).toHaveBeenCalledWith('/auth/telegram/start', { method: 'POST', body: { purpose: 'CHANGE_PHONE', phone: '012345678' } });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.status).toBe('expired');
  });

  it('shows the match code from the start answer', async () => {
    statuses({ status: 'PENDING' });
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/auth/telegram/current')) return { request: null };
      if (path === '/auth/telegram/start') return { ...START, matchCode: '47' };
      return { status: 'PENDING' };
    });
    const { result } = renderHook(() => useTelegramVerification('LOGIN'));
    await act(() => result.current.start());
    expect(result.current.matchCode).toBe('47');
  });

  it('tells a "Not me" tap apart from an expiry', async () => {
    statuses({ status: 'DECLINED' });
    const { result } = renderHook(() => useTelegramVerification('LOGIN'));
    await act(() => result.current.start());
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.status).toBe('declined');
  });

  it('stops polling when unmounted', async () => {
    statuses({ status: 'PENDING' });
    const { result, unmount } = renderHook(() => useTelegramVerification('LOGIN'));
    await act(() => result.current.start());
    await act(() => vi.advanceTimersByTimeAsync(2000));
    const calls = statusCalls();
    unmount();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(statusCalls()).toBe(calls);
  });

  it('picks up a verification that finished while the page was away (reload, or back from Telegram)', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/auth/telegram/current')) return { request: { requestId: START.requestId, status: 'VERIFIED', phone: '+855 •• ••• 678', firstName: 'Dara' } };
      throw new Error(`unexpected ${path}`);
    });
    const { result } = renderHook(() => useTelegramVerification('LOGIN'));
    await act(async () => {});
    expect(mockApi).toHaveBeenCalledWith('/auth/telegram/current?purpose=LOGIN');
    expect(result.current).toMatchObject({ status: 'verified', requestId: START.requestId, maskedPhone: '+855 •• ••• 678', firstName: 'Dara' });
  });

  it('keeps waiting for a request that was started before the reload', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/auth/telegram/current')) return { request: { requestId: START.requestId, status: 'PENDING', matchCode: '47' } };
      return { status: 'PENDING' };
    });
    const { result } = renderHook(() => useTelegramVerification('LOGIN'));
    await act(async () => {});
    expect(result.current.status).toBe('waiting');
    expect(result.current.requestId).toBe(START.requestId);
    expect(result.current.matchCode).toBe('47');
  });
});
