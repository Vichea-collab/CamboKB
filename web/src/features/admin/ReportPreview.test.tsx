import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/lib/api', async (orig) => ({ ...(await orig<typeof import('../../shared/lib/api')>()), apiText: vi.fn() }));
import { apiText } from '../../shared/lib/api';
import ReportPreview from './ReportPreview';

const html = '<!doctype html><p>Sales report</p>';
const renderAt = (url: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/admin/reports/preview" element={<ReportPreview />} />
          <Route path="/admin/reports" element={<p>The reports page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('sales report preview', () => {
  beforeEach(() => vi.mocked(apiText).mockReset());

  it('shows the report first, with a download button for the PDF', async () => {
    vi.mocked(apiText).mockResolvedValue(html);
    renderAt('/admin/reports/preview?from=2026-11-01&to=2026-11-22&groupBy=month');
    const frame = await screen.findByTitle('Sales report 2026-11-01 to 2026-11-22');
    expect(frame).toHaveAttribute('srcdoc', html);
    expect(apiText).toHaveBeenCalledWith('/admin/reports/report.html?from=2026-11-01&to=2026-11-22&groupBy=month');
    const link = screen.getByRole('link', { name: /Download PDF/ });
    const href = new URL(link.getAttribute('href')!, 'http://x');
    expect(href.pathname.endsWith('/admin/reports/report.pdf')).toBe(true);
    expect(href.searchParams.get('from')).toBe('2026-11-01');
    expect(href.searchParams.get('to')).toBe('2026-11-22');
    expect(href.searchParams.get('groupBy')).toBe('month');
    expect(href.searchParams.get('download')).toBe('1');
    expect(link).toHaveAttribute('download');
  });

  it('goes back to the Reports page with the same dates', async () => {
    vi.mocked(apiText).mockResolvedValue(html);
    renderAt('/admin/reports/preview?from=2026-11-01&to=2026-11-22&groupBy=day');
    await screen.findByTitle(/Sales report/);
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/admin/reports?from=2026-11-01&to=2026-11-22&groupBy=day');
  });

  it('lets a many-page report be as tall as it is: the frame shares the page origin but still runs no scripts', async () => {
    vi.mocked(apiText).mockResolvedValue(html);
    renderAt('/admin/reports/preview?from=2026-11-01&to=2026-11-22');
    const sandbox = (await screen.findByTitle(/Sales report/)).getAttribute('sandbox')!;
    expect(sandbox).toBe('allow-same-origin'); // measured to fit its content
    expect(sandbox).not.toContain('allow-scripts');
  });

  it.each(['/admin/reports/preview', '/admin/reports/preview?from=2026-11-22&to=2026-11-01', '/admin/reports/preview?from=x&to=y'])(
    'sends %s back to the Reports page instead of asking for a report that makes no sense',
    async (url) => {
      renderAt(url);
      expect(await screen.findByText('The reports page')).toBeInTheDocument();
      expect(apiText).not.toHaveBeenCalled();
    },
  );
});
