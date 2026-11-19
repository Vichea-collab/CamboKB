import { formatUsdExact } from '@cambo/shared';
import { Undo2 } from 'lucide-react';

/** A cancelled order the customer has paid for: the shop must send the money back, then say so here. */
export function RefundNotice({ amountCents, busy, onRefunded }: { amountCents: number; busy: boolean; onRefunded: () => void }) {
  return (
    <div className="mb-4 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm">
      <p className="flex items-center gap-2 font-semibold text-danger">
        <Undo2 className="size-4" aria-hidden /> Refund due
      </p>
      <p className="mt-0.5 text-muted">
        The customer paid {formatUsdExact(amountCents)} but this order is cancelled. Send the money back through Bakong or your bank, then mark it refunded here.
      </p>
      <button type="button" className="btn-ghost btn-sm mt-3 w-full" onClick={onRefunded} disabled={busy}>
        Mark as refunded
      </button>
    </div>
  );
}
