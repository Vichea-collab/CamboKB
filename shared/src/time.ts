/** Cambodia is UTC+7 all year (no daylight saving). */
export const PHNOM_PENH_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfPhnomPenhDay(d: Date): Date {
  const local = d.getTime() + PHNOM_PENH_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - PHNOM_PENH_OFFSET_MS);
}

/** `YYYY-MM-DD` of the instant in Phnom Penh. */
export function phnomPenhDate(d: Date): string {
  return new Date(d.getTime() + PHNOM_PENH_OFFSET_MS).toISOString().slice(0, 10);
}

/** Inclusive local dates → [start, endExclusive) in UTC. */
export function phnomPenhDayRange(from: string, to: string): { start: Date; endExclusive: Date } {
  const start = new Date(Date.parse(`${from}T00:00:00Z`) - PHNOM_PENH_OFFSET_MS);
  const endExclusive = new Date(Date.parse(`${to}T00:00:00Z`) - PHNOM_PENH_OFFSET_MS + DAY_MS);
  return { start, endExclusive };
}
