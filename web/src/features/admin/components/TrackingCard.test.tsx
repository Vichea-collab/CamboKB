import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/lib/api', async (orig) => ({ ...(await orig<typeof import('../../../shared/lib/api')>()), api: vi.fn() }));
import { api, ApiError } from '../../../shared/lib/api';
import { TrackingCard } from './TrackingCard';

const mockApi = vi.mocked(api);
const show = (props: Partial<React.ComponentProps<typeof TrackingCard>> = {}) => {
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TrackingCard orderId="o1" current={null} carrier="VET Express" onSaved={onSaved} {...props} />
    </QueryClientProvider>,
  );
  return { onSaved };
};

describe('parcel tracking (admin)', () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  it('saves the number the shop types and tells the customer', async () => {
    mockApi.mockResolvedValue({ id: 'o1', trackingNumber: 'VET-778899' });
    const { onSaved } = show();
    expect(screen.getByText(/customer gets it on Telegram/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Tracking number (VET Express)'), '  VET-778899 ');
    await userEvent.click(screen.getByRole('button', { name: 'Save tracking number' }));
    expect(mockApi).toHaveBeenCalledWith('/admin/orders/o1/tracking', { method: 'POST', body: { trackingNumber: 'VET-778899' } });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('does nothing until something has changed', async () => {
    show({ current: 'VET-1' });
    expect(screen.getByRole('button', { name: 'Save tracking number' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Tracking number (VET Express)'), '2');
    expect(screen.getByRole('button', { name: 'Save tracking number' })).toBeEnabled();
  });

  it('clears the number when the box is emptied', async () => {
    mockApi.mockResolvedValue({ id: 'o1', trackingNumber: null });
    show({ current: 'VET-1' });
    await userEvent.clear(screen.getByLabelText('Tracking number (VET Express)'));
    await userEvent.click(screen.getByRole('button', { name: 'Save tracking number' }));
    expect(mockApi).toHaveBeenCalledWith('/admin/orders/o1/tracking', { method: 'POST', body: { trackingNumber: null } });
  });

  it('explains a failure', async () => {
    mockApi.mockRejectedValue(new ApiError(409, 'ORDER_CLOSED', 'A cancelled order cannot be shipped'));
    show();
    await userEvent.type(screen.getByLabelText('Tracking number (VET Express)'), 'X1');
    await userEvent.click(screen.getByRole('button', { name: 'Save tracking number' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A cancelled order cannot be shipped');
  });
});
