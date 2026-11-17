import { normalizePhone, type StoreInfo } from '@cambo/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type StoreData = {
  storeName: string;
  info: StoreInfo;
  delivery: {
    provinceFeeCents: number;
    phnomPenhStandardFeeCents: number;
    grabTiers: { maxKm: number; feeCents: number }[];
    grabBeyondFeeCents: number;
  };
};

export const useStore = () => useQuery({ queryKey: ['store'], queryFn: () => api<StoreData>('/store'), staleTime: 5 * 60_000 });

/** A tel: link target from a number as typed by the owner ("087 522 210" → "+85587522210"). */
export const telHref = (phone: string) => `tel:${normalizePhone(phone) ?? phone.replace(/[^\d+]/g, '')}`;
