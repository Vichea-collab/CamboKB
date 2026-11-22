import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/lib/api', async (orig) => ({ ...(await orig<typeof import('../../shared/lib/api')>()), api: vi.fn() }));
import { api, ApiError } from '../../shared/lib/api';
import { resetMiniAppLogin } from './auth';
import Login from './LoginPage';

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

describe('Reviewer Angela — Web Login Tests', () => {
  beforeEach(() => {
    mockApi.mockReset();
    resetMiniAppLogin();
    vi.spyOn(window, 'open').mockReturnValue(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  describe('Mini App silent login & fallbacks', () => {
    it('falls back to Continue with Telegram button when initData is invalid or expired (TELEGRAM_INITDATA_INVALID)', async () => {
      window.location.hash = '#tgWebAppData=' + encodeURIComponent('user=%7B%22id%22%3A1%7D&auth_date=1&hash=abc') + '&tgWebAppVersion=8.0';
      serve({
        '/auth/telegram/webapp': () => {
          throw new ApiError(401, 'TELEGRAM_INITDATA_INVALID', 'invalid');
        },
      });
      renderAt('/login');
      expect(await screen.findByRole('button', { name: 'Continue with Telegram' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('falls back when the api returns 503 TELEGRAM_WEBAPP_NOT_CONFIGURED', async () => {
      window.location.hash = '#tgWebAppData=' + encodeURIComponent('user=%7B%22id%22%3A1%7D&auth_date=1&hash=abc') + '&tgWebAppVersion=8.0';
      serve({
        '/auth/telegram/webapp': () => {
          throw new ApiError(503, 'TELEGRAM_WEBAPP_NOT_CONFIGURED', 'not configured');
        },
      });
      renderAt('/login');
      expect(await screen.findByRole('button', { name: 'Continue with Telegram' })).toBeInTheDocument();
    });
  });
});
