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
      if (path === '/auth/telegram/start') return START;
      return list.length > 1 ? list.shift() : list[0];
    });
  };
  const statusCalls = () => mockApi.mock.calls.filter(([p]) => String(p).endsWith('/status')).length;

  it('starts, opens Telegram and polls until verified', async () => {
    statuses({ status: 'PENDING' }, { status: 'VERIFIED', phone: '+855 •• ••• 678', firstName: 'Dara' });
    const { result } = renderHook(() => useTelegramVerification('SIGNUP'));
    await act(() => result.current.start());
    expect(mockApi).toHaveBeenCalledWith('/auth/telegram/start', { method: 'POST', body: { purpose: 'SIGNUP' } });
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
    const { result } = renderHook(() => useTelegramVerification('RESET', '012345678'));
    await act(() => result.current.start());
    expect(mockApi).toHaveBeenCalledWith('/auth/telegram/start', { method: 'POST', body: { purpose: 'RESET', phone: '012345678' } });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.status).toBe('expired');
  });

  it('stops polling when unmounted', async () => {
    statuses({ status: 'PENDING' });
    const { result, unmount } = renderHook(() => useTelegramVerification('SIGNUP'));
    await act(() => result.current.start());
    await act(() => vi.advanceTimersByTimeAsync(2000));
    const calls = statusCalls();
    unmount();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(statusCalls()).toBe(calls);
  });
});
