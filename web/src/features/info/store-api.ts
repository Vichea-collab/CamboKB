import type { StoreInfo } from '@cambo/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/lib/api';

export type StoreData = {
  storeName: string;
  info: StoreInfo;
  delivery: {
    provinceFeeCents: number;
    phnomPenhStandardFeeCents: number;
    grabTiers: { maxKm: number; feeCents: number }[];
    grabBeyondFeeCents: number;
  };
  payments: { cod: boolean; khqr: boolean };
};

export const useStore = () => useQuery({ queryKey: ['store'], queryFn: () => api<StoreData>('/store'), staleTime: 5 * 60_000 });

/**
 * A tel: link target from a number as the owner typed it ("087 522 210" → "tel:+85587522210").
 * Deliberately not using the phone-number library: this runs on every page (footer) and
 * that library is large.
 */
export function telHref(phone: string): string {
  const d = phone.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return `tel:${d}`;
  if (d.startsWith('855')) return `tel:+${d}`;
  if (d.startsWith('0')) return `tel:+855${d.slice(1)}`;
  return `tel:${d}`;
}
