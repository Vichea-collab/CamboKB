import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/lib/api', async (orig) => ({ ...(await orig<typeof import('../../shared/lib/api')>()), apiText: vi.fn() }));
import { apiText, ApiError } from '../../shared/lib/api';
import InvoiceView from './InvoiceView';

const html = '<!doctype html><p>Invoice CS-100001</p>';
const renderView = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <InvoiceView number="CS-100001" htmlPath="/orders/CS-100001/invoice.html" pdfPath="/orders/CS-100001/invoice.pdf" back={{ to: '/account/orders/CS-100001', label: 'Order' }} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Invoice preview', () => {
  beforeEach(() => vi.mocked(apiText).mockReset());

  it('shows the invoice first, in a frame that cannot run scripts', async () => {
    vi.mocked(apiText).mockResolvedValue(html);
    renderView();
    const frame = await screen.findByTitle('Invoice CS-100001');
    expect(frame).toHaveAttribute('srcdoc', html);
    expect(frame).toHaveAttribute('sandbox', ''); // no scripts, no forms, no same-origin access
    expect(apiText).toHaveBeenCalledWith('/orders/CS-100001/invoice.html');
  });

  it('then offers the PDF as a download', async () => {
    vi.mocked(apiText).mockResolvedValue(html);
    renderView();
    await screen.findByTitle('Invoice CS-100001');
    const link = screen.getByRole('link', { name: /Download PDF/ });
    expect(link.getAttribute('href')).toMatch(/\/orders\/CS-100001\/invoice\.pdf\?download=1$/);
    expect(link).toHaveAttribute('download');
  });

  it('explains a failure and lets the customer retry', async () => {
    vi.mocked(apiText).mockRejectedValueOnce(new ApiError(503, 'REPORT_SERVICE_UNAVAILABLE', 'Reports are unavailable, try again shortly'));
    vi.mocked(apiText).mockResolvedValueOnce(html);
    renderView();
    expect(await screen.findByText('Reports are unavailable, try again shortly')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.getByTitle('Invoice CS-100001')).toBeInTheDocument());
  });
});
