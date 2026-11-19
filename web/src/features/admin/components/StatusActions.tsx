import { canTransition, type OrderStatus } from '@cambo/shared';

const FLOW: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'];
const LABEL: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: 'Confirm order',
  PACKED: 'Mark packed',
  SHIPPING: 'Mark shipped',
  DELIVERED: 'Mark delivered',
};

/** The one next step in the flow, plus Cancel while it's still allowed. */
export function StatusActions({ status, busy, onChange }: { status: OrderStatus; busy: boolean; onChange: (to: OrderStatus) => void }) {
  const i = FLOW.indexOf(status);
  const next = i >= 0 && i < FLOW.length - 1 ? FLOW[i + 1]! : null;
  const cancellable = canTransition(status, 'CANCELLED');
  if (!next && !cancellable) return null;
  return (
    <div className="flex flex-col gap-2">
      {next && (
        <button className="btn-primary w-full" disabled={busy} onClick={() => onChange(next)}>
          {LABEL[next]}
        </button>
      )}
      {cancellable && (
        <button className="btn-danger w-full" disabled={busy} onClick={() => onChange('CANCELLED')}>
          Cancel order
        </button>
      )}
    </div>
  );
}
