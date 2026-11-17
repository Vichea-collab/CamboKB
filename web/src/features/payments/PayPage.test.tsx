import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/lib/api', async (orig) => ({ ...(await orig<typeof import('../../shared/lib/api')>()), api: vi.fn() }));
import { api } from '../../shared/lib/api';
import PayPage from './PayPage';

const QR = '00020101021229200016cambosupply@aclb5204599953038405405440005802KH5912Cambo Supply6010Phnom Penh62130109CS-25000199340013179488460627201131794885206271630412AB';
const soon = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const view = (over: Record<string, unknown> = {}) => ({
  method: 'KHQR',
  status: 'PENDING',
  amountCents: 4400,
  currency: 'USD',
  payBefore: soon(30),
  paidAt: null,
  canRenew: true,
  khqr: { qr: QR, expiresAt: soon(10) },
  ...over,
});

const renderPay = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/orders/CS-250001/pay']}>
        <Routes>
          <Route path="/orders/:number/pay" element={<PayPage />} />
          <Route path="/orders/:number/success" element={<p>success page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('KHQR payment page', () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it('shows the amount, the KHQR code and how to pay', async () => {
    vi.mocked(api).mockResolvedValue(view());
    renderPay();
    expect(await screen.findByRole('img', { name: 'KHQR code for order CS-250001' })).toBeInTheDocument();
    expect(screen.getAllByText('$44').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Save QR image' })).toBeInTheDocument();
    expect(screen.getAllByText(/scan/i).length).toBeGreaterThan(0);
    expect(api).toHaveBeenCalledWith('/orders/CS-250001/payment');
  });

  it('moves on to the success page once the payment is confirmed', async () => {
    vi.mocked(api).mockResolvedValue(view({ status: 'PAID', khqr: null, paidAt: new Date().toISOString() }));
    renderPay();
    expect(await screen.findByText('success page')).toBeInTheDocument();
  });

  it('offers a new QR when the current one has expired', async () => {
    vi.mocked(api).mockImplementation(async (path: string, init?: { method?: string }) =>
      init?.method === 'POST' ? view() : view({ khqr: null }),
    );
    renderPay();
    expect(await screen.findByText('This QR has expired.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Get a new QR' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/orders/CS-250001/payment/khqr', { method: 'POST' }));
    expect(await screen.findByRole('img', { name: 'KHQR code for order CS-250001' })).toBeInTheDocument();
  });

  it('explains when the order was cancelled for not being paid in time', async () => {
    vi.mocked(api).mockResolvedValue(view({ status: 'EXPIRED', khqr: null, canRenew: false }));
    renderPay();
    expect(await screen.findByText(/wasn't paid in time/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /KHQR code/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the shop' })).toHaveAttribute('href', '/');
  });
});
