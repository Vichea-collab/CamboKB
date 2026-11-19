import { haversineKm, type LatLng } from './geo';
import type { DeliveryService, Region } from './types';

export type DeliverySettings = {
  store: LatLng;
  provinceFeeCents: number;
  phnomPenhStandardFeeCents: number;
  /** Ascending by maxKm. */
  grabTiers: { maxKm: number; feeCents: number }[];
  grabBeyondFeeCents: number;
};

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  store: { lat: 11.5714, lng: 104.8872 },
  provinceFeeCents: 200,
  phnomPenhStandardFeeCents: 150,
  grabTiers: [
    { maxKm: 3, feeCents: 150 },
    { maxKm: 5, feeCents: 200 },
  ],
  grabBeyondFeeCents: 250,
};

export function isServiceAvailable(region: Region, service: DeliveryService): boolean {
  return !(region === 'PROVINCE' && service === 'GRAB');
}

export function computeDeliveryFeeCents(
  s: DeliverySettings,
  input: { region: Region; service: DeliveryService; pin?: LatLng | null },
): { feeCents: number; distanceKm: number | null } {
  if (!isServiceAvailable(input.region, input.service)) throw new Error('DELIVERY_NOT_AVAILABLE');
  if (input.region === 'PROVINCE') return { feeCents: s.provinceFeeCents, distanceKm: null };
  if (input.service !== 'GRAB' || !input.pin) {
    return { feeCents: s.phnomPenhStandardFeeCents, distanceKm: null };
  }
  const distanceKm = Math.round(haversineKm(s.store, input.pin) * 100) / 100;
  const tier = [...s.grabTiers].sort((a, b) => a.maxKm - b.maxKm).find((t) => distanceKm <= t.maxKm);
  return { feeCents: tier ? tier.feeCents : s.grabBeyondFeeCents, distanceKm };
}
