import { t } from '../lib/strings';
import { Badge, type Tone } from './Page';

const TONE: Record<string, Tone> = {
  PENDING: 'yellow',
  CONFIRMED: 'sky',
  PACKED: 'violet',
  SHIPPING: 'indigo',
  DELIVERED: 'green',
  CANCELLED: 'danger',
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={TONE[status] ?? 'neutral'}>{t.status[status] ?? status}</Badge>;
}
