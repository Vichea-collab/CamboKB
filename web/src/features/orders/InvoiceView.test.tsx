import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  describe('on a phone', () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    beforeEach(() => {
      // A 361px wide column (a 393px phone less the page padding); the observer itself never needs to fire.
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 361 });
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          disconnect() {}
        },
      );
    });
    afterEach(() => {
      if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
      else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      vi.unstubAllGlobals();
    });

    it('fits the sheet to the screen even though the invoice loads after the page', async () => {
      vi.mocked(apiText).mockResolvedValue(html);
      renderView();
      const sheet = await screen.findByTestId('document-sheet');
      expect(sheet).toHaveStyle({ width: '361px' }); // not the 826px of a full A4 sheet
    });

    it('has no zoom buttons: the invoice looks as it always did', async () => {
      vi.mocked(apiText).mockResolvedValue(html);
      renderView();
      await screen.findByTestId('document-sheet');
      expect(screen.queryByRole('button', { name: /zoom/i })).not.toBeInTheDocument();
    });
  });

  describe('pinching', () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    beforeEach(() => {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 361 });
      vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    });
    afterEach(() => {
      if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
      else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      vi.unstubAllGlobals();
    });
    const fingers = (a: number, b: number) => ({ touches: [{ clientX: a, clientY: 100 }, { clientX: b, clientY: 100 }] });

    it('two fingers spreading zoom the sheet, and pinching back shrinks it; the page does not scroll meanwhile', async () => {
      vi.mocked(apiText).mockResolvedValue(html);
      renderView();
      const sheet = (await screen.findByTestId('document-sheet')) as HTMLElement;
      const scroller = screen.getByTestId('document-scroller');
      const width = () => parseInt(sheet.style.width, 10);
      const fitted = width();

      fireEvent.touchStart(scroller, fingers(100, 200));
      const spread = createEvent.touchMove(scroller, { ...fingers(50, 250), cancelable: true });
      fireEvent(scroller, spread);
      expect(width()).toBeGreaterThan(fitted);
      expect(spread.defaultPrevented).toBe(true); // handled here, not as a scroll
      const zoomed = width();

      fireEvent.touchMove(scroller, fingers(90, 210)); // fingers closer again
      expect(width()).toBeLessThan(zoomed);
      fireEvent.touchMove(scroller, fingers(150, 160)); // nearly together: never smaller than fitted
      expect(width()).toBe(fitted);
      fireEvent.touchMove(scroller, fingers(-1000, 1400)); // far apart: never bigger than 1.5x real size
      expect(width()).toBe(Math.round(826 * 1.5));
    });

    it('one finger is left alone, so it scrolls and pans as usual', async () => {
      vi.mocked(apiText).mockResolvedValue(html);
      renderView();
      const sheet = (await screen.findByTestId('document-sheet')) as HTMLElement;
      const scroller = screen.getByTestId('document-scroller');
      const fitted = parseInt(sheet.style.width, 10);
      fireEvent.touchStart(scroller, { touches: [{ clientX: 100, clientY: 100 }] });
      const drag = createEvent.touchMove(scroller, { touches: [{ clientX: 40, clientY: 100 }], cancelable: true });
      fireEvent(scroller, drag);
      expect(drag.defaultPrevented).toBe(false);
      expect(parseInt(sheet.style.width, 10)).toBe(fitted);
    });
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
