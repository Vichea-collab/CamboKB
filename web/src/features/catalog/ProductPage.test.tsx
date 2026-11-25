import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/lib/api', async (orig) => ({ ...(await orig<typeof import('../../shared/lib/api')>()), api: vi.fn() }));
import { api } from '../../shared/lib/api';
import ProductPage from './ProductPage';

const card = (id: string, name: string, cat = { slug: 'mice', name: 'Mice' }) => ({
  id, slug: id, name, specsLine: '', priceCents: 2100, compareAtCents: null, isSoldOut: false,
  category: cat, image: null, imageCount: 0, lowStock: null,
});
const keyboard = card('k', 'A keyboard', { slug: 'keyboards', name: 'Keyboards' });
const mouse = card('m', 'Attack Shark X11');
const other = card('n', 'Another mouse');

/** `mice` answers the request for the other products of the category. */
function open(mice: () => Promise<unknown>, stock = 5) {
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path === '/auth/session') return { user: null };
    if (path === '/products/m') return { ...mouse, description: '', stock, specs: [], images: [] };
    if (path.includes('category=mice')) return mice();
    if (path.startsWith('/products?')) return { items: [keyboard, mouse, other], total: 3 };
    if (path === '/store') return { storeName: 'Shop', info: {}, delivery: {}, payments: {} };
    throw new Error(`unexpected ${path}`);
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/products/m']}>
        <Routes>
          <Route path="/products/:slug" element={<ProductPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Product page: how many are left', () => {
  it.each([
    [1, 'Only 1 left'],
    [3, 'Only 3 left'],
    [4, 'In stock'],
  ])('with %i in stock says "%s"', async (stock, label) => {
    open(async () => ({ items: [mouse], total: 1 }), stock);
    expect(await screen.findByText(label)).toBeInTheDocument();
  });
});

describe('Product page: more in the category', () => {
  it('shows card skeletons while it loads, never products of another category', async () => {
    const { container } = open(() => new Promise(() => {}));
    await screen.findByRole('heading', { name: 'Attack Shark X11' });
    const section = (await screen.findByRole('heading', { name: /Mice/ })).closest('section')!;
    expect(section.querySelectorAll('.bone').length).toBeGreaterThan(4);
    expect(section).not.toHaveTextContent('A keyboard');
    expect(container).not.toHaveTextContent('A keyboard');
  });

  it('then shows the others, without this product', async () => {
    const { container } = open(async () => ({ items: [mouse, other], total: 2 }));
    expect(await screen.findByText('Another mouse')).toBeInTheDocument();
    expect(container.querySelector('.bone')).toBeNull();
  });

  it.each([
    ['there are no others', async () => ({ items: [mouse], total: 1 })],
    ['it could not load', () => Promise.reject(new Error('down'))],
  ])('leaves the section out when %s', async (_, mice) => {
    const { container } = open(mice);
    await screen.findByRole('heading', { name: 'Attack Shark X11' });
    await waitFor(() => expect(container.querySelector('.bone')).toBeNull());
    expect(screen.queryByRole('heading', { name: /Mice/ })).toBeNull();
  });
});
