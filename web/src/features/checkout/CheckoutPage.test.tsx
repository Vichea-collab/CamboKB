import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/ui/MapPicker', () => ({ default: () => <div data-testid="map" /> }));
vi.mock('../../shared/lib/api', async (orig) => ({ ...(await orig<typeof import('../../shared/lib/api')>()), api: vi.fn() }));
import { api, ApiError } from '../../shared/lib/api';
import { useCart } from '../cart/cart-store';
import Checkout from './CheckoutPage';

const PID = '7f1c1f5e-3b0a-4f53-9d0e-2a7a1f6c9b11';
const product = { id: PID, slug: 'x11', name: 'Attack Shark X11 White', specsLine: '', priceCents: 2100, compareAtCents: null, isSoldOut: false, category: { slug: 'mice', name: 'Mice' }, image: null, imageCount: 0 };
const quote = (over: object = {}) => ({ items: [{ productId: PID, name: product.name, priceCents: 2100, quantity: 1, lineTotalCents: 2100, image: null }], subtotalCents: 2100, deliveryFeeCents: 150, distanceKm: null, discountCents: 0, totalCents: 2250, promo: null, ...over });

let orderCalls: { headers?: Record<string, string>; body?: unknown }[] = [];

function mockServer(opts: { promoValid?: boolean; khqr?: boolean } = {}) {
  orderCalls = [];
  vi.mocked(api).mockImplementation(async (path: string, init?: { body?: unknown; headers?: Record<string, string> }) => {
    if (path === '/auth/me') return { user: { id: 'u1', name: 'Dara', phone: '+85512345678', role: 'CUSTOMER', telegramUsername: null } };
    if (path === '/me') return { user: { id: 'u1', name: 'Dara', phone: '+85512345678', role: 'CUSTOMER', telegramUsername: null }, defaultAddress: null };
    if (path.startsWith('/products/by-ids')) return { items: [product] };
    if (path === '/store') {
      return {
        storeName: 'Cambo Supply',
        info: { phone: '', telegram: '', facebook: '', address: '', hours: '', warranty: '' },
        delivery: { provinceFeeCents: 200, phnomPenhStandardFeeCents: 150, grabTiers: [], grabBeyondFeeCents: 250 },
        payments: { cod: true, khqr: opts.khqr ?? true },
      };
    }
    if (path === '/checkout/quote') {
      const body = init?.body as { promoCode?: string; region: string };
      if (body.promoCode && !opts.promoValid) throw new ApiError(422, 'PROMO_INVALID', 'invalid', { reason: 'EXPIRED' });
      return quote(body.region === 'PROVINCE' ? { deliveryFeeCents: 200, totalCents: 2300 } : {});
    }
    if (path === '/orders') {
      orderCalls.push({ headers: init?.headers, body: init?.body });
      await new Promise((r) => setTimeout(r, 50));
      return { id: 'o1', number: 'CS-250001', payment: { method: (init?.body as { paymentMethod: string }).paymentMethod } };
    }
    throw new Error(`unexpected ${path}`);
  });
}

const renderCheckout = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/checkout']}>
        <Routes>
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/orders/:number/success" element={<p>success page</p>} />
          <Route path="/orders/:number/pay" element={<p>payment page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('Checkout', () => {
  beforeEach(() => {
    useCart.setState({ items: [{ productId: PID, quantity: 1 }] });
  });

  it('hides Grab and disables cash on delivery for provinces', async () => {
    mockServer();
    renderCheckout();
    const region = await screen.findByLabelText('Delivery location');
    expect(screen.getByRole('option', { name: /Grab/ })).toBeInTheDocument();
    await userEvent.selectOptions(region, 'PROVINCE');
    expect(screen.queryByRole('option', { name: /Grab/ })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Cash on delivery/ })).toBeDisabled();
    expect(screen.getByText('Cash on delivery is only available in Phnom Penh.')).toBeInTheDocument();
    // The total appears in the phone summary bar and in the order summary panel.
    expect((await screen.findAllByText('$23')).length).toBeGreaterThan(0);
  });

  it('explains an invalid promo code', async () => {
    mockServer({ promoValid: false });
    renderCheckout();
    await userEvent.type(await screen.findByLabelText('Promo code'), 'oldcode');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('This promo code has expired.')).toBeInTheDocument();
  });

  it('sends one order with an idempotency key when Place order is double-clicked', async () => {
    mockServer();
    renderCheckout();
    await userEvent.type(await screen.findByLabelText('Address / note for the driver'), 'St. 315');
    const button = await screen.findByRole('button', { name: 'Place order' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.dblClick(button);
    expect(await screen.findByText('success page')).toBeInTheDocument();
    expect(orderCalls).toHaveLength(1);
    expect(orderCalls[0]!.headers?.['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(useCart.getState().items).toEqual([]);
  });

  it('switches province orders to KHQR and sends the customer to the payment page', async () => {
    mockServer({ khqr: true });
    renderCheckout();
    await userEvent.selectOptions(await screen.findByLabelText('Delivery location'), 'PROVINCE');
    await waitFor(() => expect(screen.getByRole('radio', { name: /KHQR/ })).toBeChecked());
    await userEvent.type(screen.getByLabelText('Address / note for the driver'), 'Siem Reap');
    const button = screen.getByRole('button', { name: 'Place order' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(await screen.findByText('payment page')).toBeInTheDocument();
    expect(orderCalls[0]!.body).toMatchObject({ region: 'PROVINCE', paymentMethod: 'KHQR' });
  });

  it('keeps KHQR off when the store has not set it up', async () => {
    mockServer({ khqr: false });
    renderCheckout();
    await screen.findByLabelText('Delivery location');
    await waitFor(() => expect(screen.getByRole('radio', { name: /KHQR/ })).toBeDisabled());
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });
});
