import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/lib/api', async (orig) => ({ ...(await orig<typeof import('../../shared/lib/api')>()), api: vi.fn() }));
import { api, ApiError } from '../../shared/lib/api';
import { resetMiniAppLogin } from './auth';
import Login from './LoginPage';

const RID = '7f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b11';
const USER = { id: 'u1', name: 'Dara Sok', phone: '+85512345678', role: 'CUSTOMER', telegramUsername: 'dara' };
const mockApi = vi.mocked(api);

type Handler = (path: string, init?: { body?: unknown }) => unknown;
const serve = (extra: Record<string, Handler> = {}) =>
  mockApi.mockImplementation(async (path: string, init?: { body?: unknown }) => {
    for (const [prefix, fn] of Object.entries(extra)) if (path.startsWith(prefix)) return fn(path, init);
    if (path === '/auth/session') return { user: null };
    if (path.startsWith('/auth/telegram/current')) return { request: null };
    throw new Error(`unexpected ${path}`);
  });

const renderAt = (url: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<p>home</p>} />
          <Route path="/checkout" element={<p>checkout</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Continue with Telegram', () => {
  beforeEach(() => {
    mockApi.mockReset();
    resetMiniAppLogin();
    vi.spyOn(window, 'open').mockReturnValue(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  it('offers one Telegram button and no password', async () => {
    serve();
    renderAt('/login');
    expect(await screen.findByRole('button', { name: 'Continue with Telegram' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the shop' })).toHaveAttribute('href', '/');
  });

  it('starts a LOGIN request and shows the match code while waiting', async () => {
    serve({
      '/auth/telegram/start': () => ({ requestId: RID, deepLink: 'https://t.me/Cambo_KB_Bot?start=abc', matchCode: '47' }),
      [`/auth/telegram/${RID}/status`]: () => ({ status: 'PENDING', matchCode: '47' }),
    });
    renderAt('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Telegram' }));
    expect(mockApi).toHaveBeenCalledWith('/auth/telegram/start', { method: 'POST', body: { purpose: 'LOGIN' } });
    expect(await screen.findByText('Waiting for Telegram…')).toBeInTheDocument();
    expect(screen.getByText('47')).toBeInTheDocument();
  });

  it('logs in once the request was confirmed in the bot, and goes to ?next=', async () => {
    serve({
      '/auth/telegram/current': () => ({ request: { requestId: RID, status: 'VERIFIED', firstName: 'Dara' } }),
      '/auth/login/complete': () => ({ user: USER }),
    });
    renderAt('/login?next=%2Fcheckout');
    expect(await screen.findByText('checkout')).toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledWith('/auth/login/complete', { method: 'POST', body: { requestId: RID } });
  });

  it('claims the bot sign-up link, then logs in', async () => {
    serve({
      '/auth/telegram/claim': () => ({ requestId: RID, status: 'VERIFIED' }),
      '/auth/login/complete': () => ({ user: USER }),
    });
    renderAt('/login?t=one-time-token-from-the-bot');
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledWith('/auth/telegram/claim', { method: 'POST', body: { token: 'one-time-token-from-the-bot' } });
    expect(mockApi).toHaveBeenCalledWith('/auth/login/complete', { method: 'POST', body: { requestId: RID } });
  });

  it('says so when the request expired before it was completed', async () => {
    serve({
      '/auth/telegram/current': () => ({ request: { requestId: RID, status: 'VERIFIED' } }),
      '/auth/login/complete': () => {
        throw new ApiError(409, 'TELEGRAM_NOT_VERIFIED', 'used');
      },
    });
    renderAt('/login');
    expect(await screen.findByText('That link expired. Start again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Telegram' })).toBeInTheDocument();
  });

  it('explains a disabled account', async () => {
    serve({
      '/auth/telegram/current': () => ({ request: { requestId: RID, status: 'VERIFIED' } }),
      '/auth/login/complete': () => {
        throw new ApiError(403, 'ACCOUNT_DISABLED', 'disabled');
      },
    });
    renderAt('/login');
    expect(await screen.findByText('This account is disabled. Contact the shop.')).toBeInTheDocument();
  });
});

describe('Inside Telegram (Mini App)', () => {
  beforeEach(() => {
    mockApi.mockReset();
    resetMiniAppLogin();
    window.location.hash = '#tgWebAppData=' + encodeURIComponent('user=%7B%22id%22%3A1%7D&auth_date=1&hash=abc') + '&tgWebAppVersion=8.0';
  });
  afterEach(() => {
    window.location.hash = '';
  });

  it('logs in silently with the launch data', async () => {
    serve({ '/auth/telegram/webapp': () => ({ user: USER }) });
    renderAt('/login?next=%2Fcheckout');
    expect(await screen.findByText('checkout')).toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledWith('/auth/telegram/webapp', {
      method: 'POST',
      body: { initData: 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=abc' },
    });
  });

  it('falls back to the bot link when the Telegram account is not linked yet', async () => {
    serve({
      '/auth/telegram/webapp': () => {
        throw new ApiError(401, 'TELEGRAM_NOT_LINKED', 'not linked');
      },
    });
    renderAt('/login');
    expect(await screen.findByRole('button', { name: 'Continue with Telegram' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
