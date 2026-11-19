import { describe, expect, it } from 'vitest';
import { computeDeliveryFeeCents, DEFAULT_DELIVERY_SETTINGS as S } from './delivery';

const kmNorth = (km: number) => ({ lat: S.store.lat + km / 111.32, lng: S.store.lng });

describe('computeDeliveryFeeCents', () => {
  it('charges the province rate', () => {
    expect(computeDeliveryFeeCents(S, { region: 'PROVINCE', service: 'VET' })).toEqual({
      feeCents: 200,
      distanceKm: null,
    });
  });
  it('charges Phnom Penh standard for VET', () => {
    expect(computeDeliveryFeeCents(S, { region: 'PHNOM_PENH', service: 'VET' }).feeCents).toBe(150);
  });
  it('charges standard for Grab without a pin', () => {
    expect(computeDeliveryFeeCents(S, { region: 'PHNOM_PENH', service: 'GRAB', pin: null }).feeCents).toBe(150);
  });
  it.each([
    [2, 150],
    [4, 200],
    [8, 250],
  ])('charges Grab by distance: %d km -> %d', (km, fee) => {
    const r = computeDeliveryFeeCents(S, { region: 'PHNOM_PENH', service: 'GRAB', pin: kmNorth(km) });
    expect(r.feeCents).toBe(fee);
    expect(r.distanceKm).toBeCloseTo(km, 1);
  });
  it('rejects Grab to a province', () => {
    expect(() => computeDeliveryFeeCents(S, { region: 'PROVINCE', service: 'GRAB' })).toThrow(
      'DELIVERY_NOT_AVAILABLE',
    );
  });
});
