import { phnomPenhDayRange } from '@cambo/shared';
import { z } from 'zod';
import { ReportError } from './errors';

const DAY_MS = 24 * 60 * 60 * 1000;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)));

export type DateRange = { from: string; to: string };

export const rangeSchema = z.object({ from: dateStr, to: dateStr });

/** Inclusive Phnom Penh dates → UTC bounds; at most 366 days. */
export function resolveRange({ from, to }: DateRange) {
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
  if (span < 0) throw new ReportError(400, 'INVALID_RANGE', '"to" must be on or after "from"');
  if (span > 365) throw new ReportError(400, 'INVALID_RANGE', 'Choose a range of at most one year');
  return phnomPenhDayRange(from, to);
}

/** Every period label between from and to, inclusive. */
export function periodsBetween({ from, to }: DateRange, groupBy: 'day' | 'month'): string[] {
  const out: string[] = [];
  if (groupBy === 'day') {
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) {
      out.push(new Date(t).toISOString().slice(0, 10));
    }
  } else {
    let [y, m] = from.split('-').map(Number) as [number, number];
    const [ty, tm] = to.split('-').map(Number) as [number, number];
    while (y < ty || (y === ty && m <= tm)) {
      out.push(`${y}-${String(m).padStart(2, '0')}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
  return out;
}
