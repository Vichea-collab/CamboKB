import { phnomPenhDate } from '@cambo/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/lib/api', async (orig) => ({
  ...(await orig<typeof import('../../shared/lib/api')>()),
  api: vi.fn(),
}));
import { api } from '../../shared/lib/api';
import Reports, { previousRange } from './Reports';

const today = () => phnomPenhDate(new Date());
const totals = (orders: number, units: number, revenueCents: number) => ({
  orders,
  units,
  revenueCents,
  averageOrderCents: orders ? Math.round(revenueCents / orders) : 0,
});

/** Current period: $3,998.90 from 88 orders. The period before: $3,279.10 from 101 orders. */
function mockServer(opts: { empty?: boolean } = {}) {
  vi.mocked(api).mockImplementation(async (path: string) => {
    const query = new URLSearchParams(path.split('?')[1]);
    if (path.startsWith('/admin/reports/summary')) {
      if (opts.empty) return { buckets: [], totals: totals(0, 0, 0) };
      if (query.get('to') !== today()) return { buckets: [], totals: totals(101, 107, 327910) };
      return {
        buckets: [
          { period: '2026-11-15', orders: 3, units: 4, revenueCents: 12000 },
          { period: '2026-11-16', orders: 8, units: 9, revenueCents: 38810 },
        ],
        totals: totals(88, 119, 399890),
      };
    }
    if (path.startsWith('/admin/reports/top-products'))
      return {
        items: [
          { productId: 'a', name: 'Keychron K2', units: 9, revenueCents: 71910 },
          { productId: 'b', name: 'Attack Shark X11', units: 31, revenueCents: 35955 },
        ],
      };
    if (path.startsWith('/admin/reports/breakdown'))
      return {
        byPaymentMethod: [
          { method: 'COD', orders: 58, revenueCents: 160300 },
          { method: 'KHQR', orders: 31, revenueCents: 98400 },
        ],
        byRegion: [{ region: 'PHNOM_PENH', orders: 89, revenueCents: 258700 }],
      };
    throw new Error(`unexpected ${path}`);
  });
}

function renderReports() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Reports />
    </QueryClientProvider>,
  );
}

describe('previousRange', () => {
  it('is the same number of days, ending the day before', () => {
    expect(previousRange('2026-10-21', '2026-11-19')).toEqual({
      from: '2026-09-21',
      to: '2026-10-20',
      days: 30,
    });
  });
  it('works for one day and across a month and a year', () => {
    expect(previousRange('2026-11-19', '2026-11-19')).toEqual({
      from: '2026-11-18',
      to: '2026-11-18',
      days: 1,
    });
    expect(previousRange('2027-01-01', '2027-01-07')).toEqual({
      from: '2026-12-25',
      to: '2026-12-31',
      days: 7,
    });
  });
});

describe('Admin reports', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    // jsdom has no ResizeObserver; the chart only uses it to measure its width.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it('shows each number with thousands separators and how it moved against the period before', async () => {
    mockServer();
    renderReports();
    expect(await screen.findByText('$3,998.90')).toBeInTheDocument();
    // Revenue 3,998.90 vs 3,279.10 = +21.95%; orders 88 vs 101 = -12.9%.
    expect(await screen.findByText('+22%')).toBeInTheDocument();
    expect(await screen.findByText('−12.9%')).toBeInTheDocument();
    expect(screen.getAllByText(/vs previous 30 days/).length).toBe(4);
    // Words as well as colour for screen readers.
    expect(screen.getAllByText('Up', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText('Down', { exact: false })).toBeInTheDocument();
  });

  it('names the best day above the chart', async () => {
    mockServer();
    renderReports();
    expect(
      await screen.findByText(/Best day: 16 Nov, \$388\.10 from 8 orders/),
    ).toBeInTheDocument();
  });

  it('ranks the top products by revenue', async () => {
    mockServer();
    renderReports();
    const list = (await screen.findByText('Keychron K2')).closest('ol')!;
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Keychron K2')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('$719.10')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('31 sold')).toBeInTheDocument();
  });

  it('shows how revenue splits by payment and by delivery area, with shares', async () => {
    mockServer();
    renderReports();
    expect(await screen.findByText(/62% of revenue · 58 orders/)).toBeInTheDocument();
    expect(screen.getByText(/38% of revenue · 31 orders/)).toBeInTheDocument();
    expect(screen.getByText(/100% of revenue · 89 orders/)).toBeInTheDocument();
  });

  it('says so, instead of drawing an empty chart, when there were no sales', async () => {
    mockServer({ empty: true });
    renderReports();
    expect(await screen.findByText('No sales in these dates')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Revenue by day/ })).not.toBeInTheDocument();
  });
});
