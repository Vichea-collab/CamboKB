import { t } from '../lib/strings';

const TONE: Record<string, string> = {
  PENDING: 'bg-yellow/15 text-yellow',
  CONFIRMED: 'bg-sky-400/15 text-sky-300',
  PACKED: 'bg-violet-400/15 text-violet-300',
  SHIPPING: 'bg-indigo-400/15 text-indigo-300',
  DELIVERED: 'bg-green/15 text-green',
  CANCELLED: 'bg-danger/15 text-danger',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${TONE[status] ?? 'bg-raised text-muted'}`}>{t.status[status] ?? status}</span>;
}
