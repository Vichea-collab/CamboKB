import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: vi.fn() }));
import { api } from '../../lib/api';
import { Footer } from '../../components/Footer';
import Contact from './Contact';
import Delivery from './Delivery';
import Privacy from './Privacy';
import Warranty from './Warranty';

const store = (info: Partial<Record<string, string>> = {}) => ({
  storeName: 'Cambo Supply',
  info: { phone: '', telegram: '', facebook: '', address: '', hours: '', warranty: '', ...info },
  delivery: {
    provinceFeeCents: 200,
    phnomPenhStandardFeeCents: 150,
    grabTiers: [
      { maxKm: 3, feeCents: 150 },
      { maxKm: 5, feeCents: 200 },
    ],
    grabBeyondFeeCents: 250,
  },
});

const renderPage = (node: React.ReactNode, data = store()) => {
  vi.mocked(api).mockResolvedValue(data);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('info pages', () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it('Contact shows only the details the owner has filled in', async () => {
    renderPage(<Contact />, store({ phone: '087 522 210', telegram: 'Cambo_KB_Bot', hours: 'Daily 8:00–20:00' }));
    expect(await screen.findByRole('link', { name: /087 522 210/ })).toHaveAttribute('href', 'tel:+85587522210');
    expect(screen.getByRole('link', { name: /@Cambo_KB_Bot/ })).toHaveAttribute('href', 'https://t.me/Cambo_KB_Bot');
    expect(screen.getByText('Daily 8:00–20:00')).toBeInTheDocument();
    expect(screen.queryByText(/Facebook/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Address/)).not.toBeInTheDocument();
  });

  it('Contact says so when nothing is configured yet', async () => {
    renderPage(<Contact />);
    expect(await screen.findByText(/contact details are coming soon/i)).toBeInTheDocument();
  });

  it('Delivery quotes the live fees from the store settings', async () => {
    renderPage(<Delivery />);
    expect(await screen.findByText(/Up to 3 km/)).toBeInTheDocument();
    expect(screen.getByText(/Up to 5 km/)).toBeInTheDocument();
    expect(screen.getAllByText('$1.50').length).toBeGreaterThan(0);
    expect(screen.getByText('$2.50')).toBeInTheDocument();
    expect(screen.getAllByText('$2').length).toBeGreaterThan(0);
  });

  it("Warranty shows the owner's text, or a safe default that promises nothing specific", async () => {
    renderPage(<Warranty />, store({ warranty: 'Keyboards: 7 days for defects.\n\nMice: 3 days.' }));
    expect(await screen.findByText('Keyboards: 7 days for defects.')).toBeInTheDocument();
    expect(screen.getByText('Mice: 3 days.')).toBeInTheDocument();
  });

  it('Warranty falls back to a default when the owner has not written one', async () => {
    renderPage(<Warranty />);
    expect(await screen.findByText(/ask us before you buy/i)).toBeInTheDocument();
  });

  it('Privacy explains what is collected and why', async () => {
    renderPage(<Privacy />);
    expect(await screen.findByRole('heading', { name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getAllByText(/phone number/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/never sell/i)).toBeInTheDocument();
  });
});

describe('footer', () => {
  it('links to every info page and shows the phone when set', async () => {
    renderPage(<Footer />, store({ phone: '087 522 210' }));
    for (const name of ['Contact', 'Delivery', 'Warranty & returns', 'Privacy']) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: '087 522 210' })).toHaveAttribute('href', 'tel:+85587522210');
  });
});
