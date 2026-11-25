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
let quoteCalls: { pin?: { lat: number; lng: number } | null }[] = [];

function mockServer(opts: { promoValid?: boolean; khqr?: boolean; shared?: 'location' | 'expired' } = {}) {
  orderCalls = [];
  quoteCalls = [];
  vi.mocked(api).mockImplementation(async (path: string, init?: { body?: unknown; headers?: Record<string, string> }) => {
    if (path === '/auth/session') return { user: { id: 'u1', name: 'Dara', phone: '+85512345678', role: 'CUSTOMER', telegramUsername: null } };
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
      const body = init?.body as { promoCode?: string; region: string; pin?: { lat: number; lng: number } | null };
      quoteCalls.push(body);
      if (body.promoCode && !opts.promoValid) throw new ApiError(422, 'PROMO_INVALID', 'invalid', { reason: 'EXPIRED' });
      return quote(body.region === 'PROVINCE' ? { deliveryFeeCents: 200, totalCents: 2300 } : {});
    }
    if (path === '/orders') {
      orderCalls.push({ headers: init?.headers, body: init?.body });
      await new Promise((r) => setTimeout(r, 50));
      return { id: 'o1', number: 'CS-250001', payment: { method: (init?.body as { paymentMethod: string }).paymentMethod } };
    }
    // Sharing the delivery location through the Telegram bot.
    if (path === '/auth/telegram/current') return { request: null };
    if (path === '/auth/telegram/start') return { requestId: 'r1', deepLink: 'https://t.me/shop_bot?start=abc' };
    if (path === '/auth/telegram/r1/status')
      return opts.shared === 'expired' ? { status: 'EXPIRED' } : { status: 'VERIFIED', lat: 11.5651, lng: 104.9123 };
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

/** The dropdowns are bottom sheets: open one by its label, then pick an option from the list. */
async function choose(label: string, option: string | RegExp) {
  await userEvent.click(await screen.findByLabelText(label));
  await userEvent.click(await screen.findByRole('radio', { name: option }));
}

describe('Checkout', () => {
  beforeEach(() => {
    useCart.setState({ items: [{ productId: PID, quantity: 1 }] });
    // Sharing a location through the Telegram bot is offered on phones (see the desktop test below).
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    );
  });

  it('shows grey blocks for the amounts until they are known, then the amounts', async () => {
    mockServer();
    const server = vi.mocked(api).getMockImplementation()!;
    let answer = () => {};
    const held = new Promise<void>((r) => (answer = r));
    vi.mocked(api).mockImplementation(async (path: string, ...rest) => {
      if (path === '/checkout/quote') await held;
      return server(path, ...rest);
    });
    const { container } = renderCheckout();
    await screen.findByRole('heading', { name: 'Checkout' });
    const totals = container.querySelector('dl[aria-live]')!;
    // Subtotal, delivery and total, and the total in the phone's folded summary.
    expect(totals.querySelectorAll('dd .bone')).toHaveLength(3);
    expect(container.querySelectorAll('summary .bone')).toHaveLength(1);
    expect(totals).not.toHaveTextContent('—');
    answer();
    await waitFor(() => expect(totals.querySelectorAll('.bone')).toHaveLength(0));
    expect(totals).toHaveTextContent('$21.00');
    expect(container.querySelectorAll('summary .bone')).toHaveLength(0);
  });

  it('does not keep the grey blocks when the amounts cannot be worked out', async () => {
    mockServer();
    const server = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path: string, ...rest) => {
      if (path === '/checkout/quote') throw new ApiError(503, 'DOWN', 'Please try again');
      return server(path, ...rest);
    });
    const { container } = renderCheckout();
    expect(await screen.findByText('Please try again')).toBeInTheDocument();
    expect(container.querySelectorAll('dl[aria-live] .bone')).toHaveLength(0);
  });

  it('offers a back link to return to the shop', async () => {
    mockServer();
    renderCheckout();
    expect(await screen.findByRole('link', { name: 'Back to the shop' })).toHaveAttribute('href', '/');
  });

  it('does not offer Telegram location sharing on a computer, where Telegram cannot send a location', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
    );
    mockServer();
    renderCheckout();
    expect(await screen.findByRole('button', { name: /Use my location/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Share location in Telegram/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Telegram on a computer can’t send a location/)).toBeInTheDocument();
  });

  it('hides Grab and disables cash on delivery for provinces', async () => {
    mockServer();
    renderCheckout();
    await userEvent.click(await screen.findByLabelText('Delivery service'));
    expect(await screen.findByRole('radio', { name: /Grab/ })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await choose('Delivery location', 'Province (តាមខេត្ត)');
    await userEvent.click(await screen.findByLabelText('Delivery service'));
    expect(await screen.findByRole('radio', { name: /VET/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Grab/ })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('radio', { name: /Cash on delivery/ })).toBeDisabled();
    expect(screen.getByText('Cash on delivery is only available in Phnom Penh.')).toBeInTheDocument();
    // The total appears in the phone summary bar and in the order summary panel.
    expect((await screen.findAllByText('$23.00')).length).toBeGreaterThan(0);
  });

  it('moves the pin to the location the customer shared in Telegram, and prices the delivery from it', async () => {
    mockServer({ shared: 'location' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderCheckout();
    await userEvent.click(await screen.findByRole('button', { name: /Share location in Telegram/ }));
    expect(open).toHaveBeenCalledWith('https://t.me/shop_bot?start=abc', '_blank', 'noopener');
    expect(await screen.findByText(/Location received from Telegram/, {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(quoteCalls.at(-1)?.pin).toEqual({ lat: 11.5651, lng: 104.9123 }));
    open.mockRestore();
  });

  it('tells the customer when the Telegram location request ran out', async () => {
    mockServer({ shared: 'expired' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderCheckout();
    await userEvent.click(await screen.findByRole('button', { name: /Share location in Telegram/ }));
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/took too long/);
    open.mockRestore();
  });

  it('will not place a Grab order until a map pin is set, then sends the pin with the order', async () => {
    mockServer({ shared: 'location' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderCheckout();
    await userEvent.type(await screen.findByLabelText('Address / note for the driver'), 'St. 315');
    const place = await screen.findByRole('button', { name: 'Place order' });
    expect(place).toBeDisabled();
    expect(screen.getByText(/Set your delivery pin first/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Share location in Telegram/ }));
    await waitFor(() => expect(place).toBeEnabled(), { timeout: 5000 });
    expect(screen.queryByText(/Set your delivery pin first/)).not.toBeInTheDocument();

    await userEvent.click(place);
    expect(await screen.findByText('success page')).toBeInTheDocument();
    expect((orderCalls[0]!.body as { pin?: unknown }).pin).toEqual({ lat: 11.5651, lng: 104.9123 });
    open.mockRestore();
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
    await choose('Delivery service', /VET/); // Grab would need a map pin
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
    await choose('Delivery location', 'Province (តាមខេត្ត)');
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
