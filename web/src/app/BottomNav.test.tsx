import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shared/lib/api', async (orig) => ({ ...(await orig<typeof import('../shared/lib/api')>()), api: vi.fn() }));
import { api } from '../shared/lib/api';
import { useCart } from '../features/cart/cart-store';
import { useLang } from '../shared/lib/i18n';
import { useUi } from '../shared/lib/ui-store';
import { BottomNav } from './BottomNav';

const USER = { id: 'u1', name: 'Dara', phone: '+85512345678', role: 'CUSTOMER', telegramUsername: null };
const show = (path: string, user: object | null = USER) => {
  vi.mocked(api).mockResolvedValue({ user });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <BottomNav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('shop bottom navigation (phones)', () => {
  beforeEach(() => {
    localStorage.clear();
    useLang.getState().setLang('en');
    useCart.setState({ items: [] });
    useUi.setState({ cartOpen: false });
  });

  it('puts home, contact, cart, orders and account one tap away, with the cart in the middle', async () => {
    show('/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav).toBeInTheDocument();
    const items = [...nav.querySelectorAll('a, button')].map((el) => el.getAttribute('aria-label') ?? el.textContent ?? '');
    expect(items).toEqual(['Home', 'Contact', 'Cart, 0 items', 'Orders', 'Account']); // never a wrong "Log in" while the session loads
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact');
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/account/orders');
    expect(await screen.findByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
  });

  it('keeps clear of the iPhone browser’s floating buttons', () => {
    show('/');
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveClass('bottom-bar');
  });

  it('marks Contact as the current page on the contact page', () => {
    show('/contact');
    expect(screen.getByRole('link', { name: 'Contact' })).toHaveAttribute('aria-current', 'page');
  });

  it('sends a visitor who is not logged in to log in instead', async () => {
    show('/', null);
    expect(await screen.findByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });

  it('opens the cart and shows how many items are in it', async () => {
    useCart.setState({ items: [{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 1 }] });
    show('/');
    const cart = screen.getByRole('button', { name: 'Cart, 3 items' });
    expect(cart).toHaveTextContent('3');
    await userEvent.click(cart);
    expect(useUi.getState().cartOpen).toBe(true);
  });

  it('marks the page you are on', () => {
    show('/account/orders');
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it.each(['/products/attack-shark-x11-white', '/checkout', '/orders/CS-250001/pay', '/orders/CS-250001/success', '/login'])(
    'gets out of the way on %s, which has its own bottom bar or is a focused form',
    (path) => {
      show(path);
      expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    },
  );

  it('speaks Khmer when the shop is in Khmer', () => {
    useLang.getState().setLang('km');
    show('/');
    expect(screen.getByRole('link', { name: 'ទំព័រដើម' })).toBeInTheDocument();
  });
});
