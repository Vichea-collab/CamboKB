import { t } from '../lib/strings';
import { Badge, type Tone } from './Page';

const TONE: Record<string, Tone> = {
  PENDING: 'yellow',
  CONFIRMED: 'sky',
  PACKED: 'violet',
  SHIPPING: 'indigo',
  DELIVERED: 'green',
  CANCELLED: 'danger',
  PAYMENT_EXPIRED: 'neutral',
};

/**
 * An order closed because its payment ran out was not cancelled by anyone: "Payment: Expired" already says
 * why, so it reads "Expired" (grey, like something that never happened) instead of a red "Cancelled".
 * Pass the order's payment status when the screen has it.
 */
export function displayStatus(status: string, paymentStatus?: string | null): string {
  return status === 'CANCELLED' && paymentStatus === 'EXPIRED' ? 'PAYMENT_EXPIRED' : status;
}

export function StatusBadge({
  status,
  payment,
}: {
  status: string;
  /** The order's payment status, if known. */
  payment?: string | null;
}) {
  const shown = displayStatus(status, payment);
  return <Badge tone={TONE[shown] ?? 'neutral'}>{t.status[shown] ?? shown}</Badge>;
}

const PAYMENT_TONE: Record<string, Tone> = {
  PAID: 'green',
  UNPAID: 'yellow',
  PENDING: 'yellow',
  FAILED: 'danger',
  EXPIRED: 'neutral',
  REFUNDED: 'sky',
};

/**
 * How the customer pays and whether the money is in: "Paid" with KHQR or cash, "Unpaid" for cash still
 * to collect on delivery, "Waiting" for a KHQR that has not come in yet. The method sits under the badge.
 * On a closed order (cancelled) an unpaid or waiting payment is grey: nothing is owed any more.
 */
export function PaymentBadge({
  payment,
  orderStatus,
  showMethod = true,
  align = 'start',
}: {
  payment: { method: string; status: string } | null | undefined;
  orderStatus?: string;
  showMethod?: boolean;
  /** Which edge the badge and the method line sit against (`end` under a right-aligned amount). */
  align?: 'start' | 'end';
}) {
  if (!payment) return <span className="text-muted">—</span>;
  const open = payment.status === 'UNPAID' || payment.status === 'PENDING';
  const tone =
    open && orderStatus === 'CANCELLED' ? 'neutral' : (PAYMENT_TONE[payment.status] ?? 'neutral');
  const label =
    payment.method === 'KHQR' && payment.status === 'PENDING'
      ? t.paymentWaiting
      : (t.paymentStatus[payment.status] ?? payment.status);
  return (
    <div className={`flex flex-col gap-1 ${align === 'end' ? 'items-end' : 'items-start'}`}>
      <Badge tone={tone}>{label}</Badge>
      {showMethod && (
        <span className="text-xs text-muted">{t.payment[payment.method] ?? payment.method}</span>
      )}
    </div>
  );
}
