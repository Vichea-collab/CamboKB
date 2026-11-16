import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), api: vi.fn() }));
import { api, ApiError } from '../lib/api';
import Login from './Login';

const renderLogin = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/login']}>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Login', () => {
  it('explains wrong credentials', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'Wrong phone number or password'));
    renderLogin();
    await userEvent.type(screen.getByLabelText('Phone number'), '012 345 678');
    await userEvent.type(screen.getByLabelText('Password'), 'not-right-1');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong phone number or password.');
  });

  it('flags an invalid phone before calling the server', async () => {
    vi.mocked(api).mockReset();
    renderLogin();
    await userEvent.type(screen.getByLabelText('Phone number'), '12');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever-1');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Enter a valid Cambodian phone number.')).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith('/auth/login', expect.anything());
  });

  it('explains rate limiting', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'Too many attempts'));
    renderLogin();
    await userEvent.type(screen.getByLabelText('Phone number'), '012345678');
    await userEvent.type(screen.getByLabelText('Password'), 'not-right-1');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in 15 minutes.');
  });
});
