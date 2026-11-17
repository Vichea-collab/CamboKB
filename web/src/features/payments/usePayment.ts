import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/lib/api';
import type { PaymentView } from '../../shared/lib/types';

/** Payment state for an order. While waiting, asks every 3 s (the server checks Bakong). */
export function usePayment(number: string) {
  return useQuery({
    queryKey: ['payment', number],
    queryFn: () => api<PaymentView>(`/orders/${encodeURIComponent(number)}/payment`),
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? 3000 : false),
    refetchIntervalInBackground: true,
  });
}

export function useRenewKhqr(number: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<PaymentView>(`/orders/${encodeURIComponent(number)}/payment/khqr`, { method: 'POST' }),
    onSuccess: (view) => qc.setQueryData(['payment', number], view),
  });
}
