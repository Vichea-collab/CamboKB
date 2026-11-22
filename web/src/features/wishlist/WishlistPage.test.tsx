import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductCardData } from '../../shared/lib/types';
import { useUi } from '../../shared/lib/ui-store';
import Wishlist from './WishlistPage';
import { useWishlist } from './wishlist-store';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../../shared/lib/api', () => ({ api: apiMock, isApiError: () => false }));

const A = '7f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b11';
const B = '8f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b12';
const card = (id: string, name: string, over: Partial<ProductCardData> = {}): ProductCardData => ({
  id,
  slug: name.toLowerCase().replace(/\W+/g, '-'),
  name,
  specsLine: '',
  priceCents: 2100,
  compareAtCents: null,
  isSoldOut: false,
  category: { slug: 'mice', name: 'Mice' },
  image: null,
  imageCount: 0,
  lowStock: null,
  ...over,
});

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <Wishlist />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Wishlist page', () => {
  beforeEach(() => {
    apiMock.mockReset();
    useWishlist.setState({ ids: [] });
    useUi.setState({ toast: null });
  });

  it('says so when nothing is saved, without asking the server', () => {
    renderPage();
    expect(screen.getByText('Nothing saved yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse products' })).toHaveAttribute('href', '/');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('lists saved products in saved order, with sold-out ones kept', async () => {
    useWishlist.setState({ ids: [B, A] });
    apiMock.mockResolvedValue({
      items: [card(A, 'Attack Shark X11'), card(B, 'Azzor AZ57', { isSoldOut: true })],
    });
    renderPage();
    const names = await screen.findAllByRole('heading', { level: 3 });
    expect(names.map((n) => n.textContent)).toEqual(['Azzor AZ57', 'Attack Shark X11']);
    expect(screen.getByText('Sold out')).toBeInTheDocument();
    expect(screen.getByText('2 saved items')).toBeInTheDocument();
  });

  it('drops a product that no longer exists and says so', async () => {
    useWishlist.setState({ ids: [B, A] });
    apiMock.mockResolvedValue({ items: [card(A, 'Attack Shark X11')] });
    renderPage();
    await screen.findByText('Attack Shark X11');
    await waitFor(() => expect(useWishlist.getState().ids).toEqual([A]));
    expect(useUi.getState().toast?.text).toMatch(/no longer available/);
  });

  it('removes an item with its heart', async () => {
    useWishlist.setState({ ids: [A] });
    apiMock.mockResolvedValue({ items: [card(A, 'Attack Shark X11')] });
    renderPage();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove Attack Shark X11 from your wishlist' }),
    );
    expect(useWishlist.getState().ids).toEqual([]);
    expect(await screen.findByText('Nothing saved yet.')).toBeInTheDocument();
  });
});
