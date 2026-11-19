import { expect, it } from 'vitest';
import { formatUsd, formatUsdExact } from './money';

it.each([
  [2100, '$21'],
  [2150, '$21.50'],
  [0, '$0'],
  [5, '$0.05'],
])('formatUsd(%d) = %s', (cents, out) => {
  expect(formatUsd(cents)).toBe(out);
});

it.each([
  [2100, '$21.00'],
  [2250, '$22.50'],
  [0, '$0.00'],
  [5, '$0.05'],
  [-150, '-$1.50'],
])('formatUsdExact(%d) = %s', (cents, out) => {
  expect(formatUsdExact(cents)).toBe(out);
});
