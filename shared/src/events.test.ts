import { describe, expect, it } from 'vitest';
import { EVENT_TARGETS, eventDataSchemas, parseEvent, type OrderSnapshot } from './events';

const EVENT_ID = '0d3b9a52-1c61-4c4e-9d7e-6a1f4b2c8e90';

const order: OrderSnapshot = {
  id: '5b0f1c4e-6f0d-4d52-9a6e-2f1d8a3b9c10',
  number: 'CS-100001',
  status: 'PENDING',
  createdAt: '2026-11-19T01:00:00.000Z',
  contactName: 'Dara',
  contactPhone: '+85512345678',
  region: 'PHNOM_PENH',
  deliveryService: 'VET',
  addressLine: 'St. 315',
  lat: null,
  lng: null,
  distanceKm: null,
  note: null,
  subtotalCents: 4200,
  deliveryFeeCents: 150,
  discountCents: 0,
  totalCents: 4350,
  promoCode: null,
  payment: { method: 'COD', status: 'UNPAID' },
  items: [
    {
      productId: '8d7a0b3e-3c5a-4e0b-8f6a-0d9a8f1e2b34',
      name: 'Attack Shark X11',
      quantity: 2,
      priceCents: 2100,
      lineTotalCents: 4200,
    },
  ],
};

describe('event contracts', () => {
  it('every event type has a target and a schema', () => {
    expect(Object.keys(EVENT_TARGETS).sort()).toEqual(Object.keys(eventDataSchemas).sort());
  });

  it('parses a valid envelope and its data', () => {
    const { data, envelope } = parseEvent('order.placed', {
      id: EVENT_ID,
      type: 'order.placed',
      emittedAt: new Date().toISOString(),
      data: { order, customerChatId: '7001', adminAlerts: true, holdMinutes: 10 },
    });
    expect(data.order.number).toBe('CS-100001');
    expect(envelope.requestId).toBeUndefined();
  });

  it('rejects data that breaks the contract', () => {
    expect(() =>
      parseEvent('order.snapshot', {
        id: EVENT_ID,
        type: 'order.snapshot',
        emittedAt: new Date().toISOString(),
        data: { ...order, totalCents: 'free' },
      }),
    ).toThrow();
  });

  it('admin alerts default to on', () => {
    expect(eventDataSchemas['admin.alert'].parse({ text: 'hi' }).adminAlerts).toBe(true);
  });
});
