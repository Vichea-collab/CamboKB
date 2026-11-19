import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/lib/api', async (orig) => ({ ...(await orig<typeof import('../../shared/lib/api')>()), api: vi.fn() }));
import { api } from '../../shared/lib/api';
import { useLang } from '../../shared/lib/i18n';
import { ShopPerks } from './ShopPerks';

const store = (khqr: boolean) => ({
  storeName: 'Cambo Supply',
  info: { phone: '', telegram: '', facebook: '', address: '', hours: '', warranty: '' },
  delivery: { provinceFeeCents: 200, phnomPenhStandardFeeCents: 150, grabTiers: [{ upToKm: 5, feeCents: 250 }], grabBeyondFeeCents: 400 },
  payments: { cod: true, khqr },
});
const show = (khqr = true) => {
  vi.mocked(api).mockResolvedValue(store(khqr));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ShopPerks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('delivery, payment and warranty reassurance', () => {
  beforeEach(() => {
    localStorage.clear();
    useLang.getState().setLang('en');
    vi.mocked(api).mockReset();
  });

  it('shows the real delivery fees and links to the details', async () => {
    show();
    expect(await screen.findByText(/Phnom Penh from \$1\.50, provinces \$2\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute('href', '/delivery');
  });

  it('describes the payment methods the shop really offers', async () => {
    show(true);
    expect(await screen.findByText(/KHQR with any bank app/)).toBeInTheDocument();
  });

  it('mentions only cash on delivery when KHQR is not set up', async () => {
    show(false);
    expect(await screen.findByText('Cash on delivery in Phnom Penh.')).toBeInTheDocument();
    expect(screen.queryByText(/KHQR/)).not.toBeInTheDocument();
  });

  it('links to the warranty and returns page', async () => {
    show();
    expect(await screen.findByRole('link', { name: 'Read more' })).toHaveAttribute('href', '/warranty');
  });
});
