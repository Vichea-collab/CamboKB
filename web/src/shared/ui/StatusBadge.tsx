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
