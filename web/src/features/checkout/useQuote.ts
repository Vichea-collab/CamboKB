import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../shared/lib/api';
import type { Quote } from '../../shared/lib/types';

export type QuoteInput = {
  items: { productId: string; quantity: number }[];
  region: 'PHNOM_PENH' | 'PROVINCE';
  deliveryService: 'GRAB' | 'VET' | 'JNT';
  pin?: { lat: number; lng: number } | null;
  promoCode?: string;
};

/** Server-priced totals, re-fetched (debounced 300 ms) whenever the checkout inputs change. */
export function useQuote(input: QuoteInput) {
  const key = JSON.stringify(input);
  const [debounced, setDebounced] = useState(key);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(key), 300);
    return () => clearTimeout(id);
  }, [key]);
  return useQuery({
    queryKey: ['quote', debounced],
    queryFn: () => api<Quote>('/checkout/quote', { method: 'POST', body: JSON.parse(debounced) as QuoteInput }),
    enabled: input.items.length > 0,
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  });
}
