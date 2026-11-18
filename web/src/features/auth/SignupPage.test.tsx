import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/lib/api', async (orig) => ({ ...(await orig<typeof import('../../shared/lib/api')>()), api: vi.fn() }));
import { api, ApiError } from '../../shared/lib/api';
import Signup from './SignupPage';

const RID = '7f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b11';
const mockApi = vi.mocked(api);
const claimed = { requestId: RID, status: 'VERIFIED', phone: '+855 •• ••• 678', firstName: 'Dara Sok' };

const renderAt = (url: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/signup" element={<Signup />} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Signup that started in the Telegram bot', () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/auth/telegram/current')) return { request: null };
      if (path === '/auth/telegram/claim') return claimed;
      if (path === '/auth/signup/complete') return { user: { id: 'u1', name: 'Dara Sok', phone: '+85512345678', role: 'CUSTOMER', telegramUsername: null } };
      throw new Error(`unexpected ${path}`);
    });
  });

  it('greets the customer by their Telegram name and asks only for a password', async () => {
    renderAt('/signup?t=one-time-token');
    expect(await screen.findByText(/Hi, Dara Sok/)).toBeInTheDocument();
    expect(screen.getByText(/Verified \+855 •• ••• 678/)).toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledWith('/auth/telegram/claim', { method: 'POST', body: { token: 'one-time-token' } });
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });

  it('creates the account with just the password', async () => {
    renderAt('/signup?t=one-time-token');
    await userEvent.type(await screen.findByLabelText('New password'), 'Sunrise-keys-42');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Sunrise-keys-42');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledWith('/auth/signup/complete', { method: 'POST', body: { requestId: RID, password: 'Sunrise-keys-42' } });
  });

  it('says so when the link was already used or has expired, and offers to start again', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/auth/telegram/current')) return { request: null };
      throw new ApiError(409, 'TELEGRAM_NOT_VERIFIED', 'used');
    });
    renderAt('/signup?t=old-token');
    expect(await screen.findByText('That link expired. Start again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start again' })).toBeInTheDocument();
  });

  it('still asks for a name when Telegram did not provide one', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/auth/telegram/current')) return { request: { requestId: RID, status: 'VERIFIED', phone: '+855 •• ••• 678' } };
      throw new Error(`unexpected ${path}`);
    });
    renderAt('/signup');
    expect(await screen.findByLabelText('Your name')).toBeInTheDocument();
  });
});
