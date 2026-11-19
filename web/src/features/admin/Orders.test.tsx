import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/lib/api', async (orig) => ({
  ...(await orig<typeof import('../../shared/lib/api')>()),
  api: vi.fn(),
}));
import { api } from '../../shared/lib/api';
import Orders from './Orders';

const order = (n: number, method: 'COD' | 'KHQR', status: string) => ({
  id: `o${n}`,
  number: `CS-25000${n}`,
  status: 'PENDING',
  createdAt: '2026-11-19T01:00:00.000Z',
  contactName: `Customer ${n}`,
  contactPhone: '+85512345678',
  region: 'PHNOM_PENH',
  deliveryService: 'GRAB',
  totalCents: 2500,
  payment: { method, status, amountCents: 2500, paidAt: null, payBefore: null },
});

const calls = () => vi.mocked(api).mock.calls.map(([path]) => String(path));
const lastListCall = () =>
  calls()
    .filter((p) => p.startsWith('/admin/orders?'))
    .at(-1)!;

function renderOrders(url = '/admin/orders') {
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path.startsWith('/admin/orders/counts'))
      return {
        all: 2,
        PENDING: 2,
        CONFIRMED: 0,
        PACKED: 0,
        SHIPPING: 0,
        DELIVERED: 0,
        CANCELLED: 0,
      };
    return {
      items: [order(1, 'COD', 'UNPAID'), order(2, 'KHQR', 'PAID')],
      total: 2,
      page: 1,
      pageSize: 30,
    };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Orders />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Admin orders: payment', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  it('shows how each order is paid and whether the money is in', async () => {
    renderOrders();
    expect((await screen.findAllByText('CS-250001')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unpaid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cash on delivery').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('KHQR').length).toBeGreaterThan(0);
  });

  it('asks the api for only the orders that match the payment and method filters', async () => {
    renderOrders();
    await screen.findAllByText('CS-250001');
    await userEvent.selectOptions(screen.getByLabelText('Payment'), 'UNPAID');
    await userEvent.selectOptions(screen.getByLabelText('Payment method'), 'COD');
    await waitFor(() => expect(lastListCall()).toMatch(/payment=UNPAID/));
    expect(lastListCall()).toMatch(/method=COD/);
  });

  it('clears a filter when "All payments" is chosen again', async () => {
    renderOrders('/admin/orders?payment=PAID');
    expect(await screen.findByLabelText('Payment')).toHaveValue('PAID');
    expect(lastListCall()).toMatch(/payment=PAID/);
    await userEvent.selectOptions(screen.getByLabelText('Payment'), '');
    await waitFor(() => expect(lastListCall()).not.toMatch(/payment=/));
  });
});
