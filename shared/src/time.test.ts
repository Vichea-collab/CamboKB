import { expect, it } from 'vitest';
import { phnomPenhDate, phnomPenhDayRange, startOfPhnomPenhDay } from './time';

it('starts the Phnom Penh day at 17:00 UTC the previous day', () => {
  expect(startOfPhnomPenhDay(new Date('2026-11-10T18:30:00Z')).toISOString()).toBe('2026-11-10T17:00:00.000Z');
  expect(startOfPhnomPenhDay(new Date('2026-11-10T16:59:00Z')).toISOString()).toBe('2026-11-09T17:00:00.000Z');
});

it('formats the local date', () => {
  expect(phnomPenhDate(new Date('2026-11-10T18:30:00Z'))).toBe('2026-11-11');
});

it('turns an inclusive date range into UTC bounds', () => {
  const r = phnomPenhDayRange('2026-11-10', '2026-11-12');
  expect(r.start.toISOString()).toBe('2026-11-09T17:00:00.000Z');
  expect(r.endExclusive.toISOString()).toBe('2026-11-12T17:00:00.000Z');
});
