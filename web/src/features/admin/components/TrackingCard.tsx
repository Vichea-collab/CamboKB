import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../shared/lib/api';
import { FormError } from '../../../shared/ui/FormCard';
import { Section } from '../../../shared/ui/Page';
import type { AdminOrder } from '../types';

/** The carrier's tracking code. Saving it messages the customer on Telegram (once per number). */
export function TrackingCard({
  orderId,
  current,
  carrier,
  onSaved,
}: {
  orderId: string;
  current: string | null;
  carrier: string;
  onSaved: (o: AdminOrder) => void;
}) {
  const [value, setValue] = useState(current ?? '');
  const trimmed = value.trim();
  const save = useMutation({
    mutationFn: () => api<AdminOrder>(`/admin/orders/${orderId}/tracking`, { method: 'POST', body: { trackingNumber: trimmed || null } }),
    onSuccess: (o) => {
      setValue(o.trackingNumber ?? '');
      onSaved(o);
    },
  });
  return (
    <Section title="Parcel tracking" description="Once you hand the parcel to the carrier, enter its tracking number. The customer gets it on Telegram.">
      <FormError>{save.error ? (save.error as Error).message : undefined}</FormError>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div>
          <label className="label" htmlFor="tracking">
            Tracking number ({carrier})
          </label>
          <input id="tracking" className="field" value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        </div>
        <button type="submit" className="btn-primary w-full sm:w-auto" disabled={save.isPending || trimmed === (current ?? '')}>
          {save.isPending ? 'Saving…' : 'Save tracking number'}
        </button>
      </form>
    </Section>
  );
}
