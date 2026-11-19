import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Order } from '../../shared/lib/types';
import { OrderSummary } from './OrderView';

const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1',
  number: 'CS-250006',
  status: 'PENDING',
  createdAt: '2026-11-18T07:07:00.000Z',
  contactName: 'Dev Tester',
  contactPhone: '+85510000001',
  region: 'PHNOM_PENH',
  deliveryService: 'GRAB',
  addressLine: 'St. 315',
  lat: null,
  lng: null,
  distanceKm: null,
  note: null,
  trackingNumber: null,
  subtotalCents: 2100,
  deliveryFeeCents: 150,
  discountCents: 0,
  totalCents: 2250,
  promoCode: null,
  items: [],
  events: [],
  payment: null,
  ...over,
});

const show = (o: Order) =>
  render(
    <MemoryRouter>
      <OrderSummary order={o} />
    </MemoryRouter>,
  );

describe('order delivery details', () => {
  it('links to the map pin when the customer set one', () => {
    show(order({ lat: 11.5651, lng: 104.9123 }));
    expect(screen.getByRole('link', { name: 'Open map pin' })).toHaveAttribute(
      'href',
      'https://maps.google.com/?q=11.5651,104.9123',
    );
    expect(screen.queryByText(/No map pin/)).not.toBeInTheDocument();
  });

  it('warns when a Grab order has no map pin, so the shop knows to ask where to deliver', () => {
    show(order());
    expect(screen.queryByRole('link', { name: 'Open map pin' })).not.toBeInTheDocument();
    expect(screen.getByText(/No map pin on this order/)).toBeInTheDocument();
  });

  it('does not warn about the pin for deliveries that do not need one', () => {
    show(order({ deliveryService: 'VET' }));
    expect(screen.queryByText(/No map pin/)).not.toBeInTheDocument();
  });

  it('shows the carrier tracking number, with a button to copy it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    show(order({ deliveryService: 'VET', trackingNumber: 'VET-778899' }));
    expect(screen.getByText('Tracking number')).toBeInTheDocument();
    expect(screen.getByText('VET-778899')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy tracking number' }));
    expect(writeText).toHaveBeenCalledWith('VET-778899');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('shows nothing about tracking before the parcel has a number', () => {
    show(order({ deliveryService: 'VET', trackingNumber: null }));
    expect(screen.queryByText('Tracking number')).not.toBeInTheDocument();
  });
});
