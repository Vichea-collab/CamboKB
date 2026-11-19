import { expect, it } from 'vitest';
import { formatUsd, formatUsdExact } from './money';

it.each([
  [2100, '$21'],
  [2150, '$21.50'],
  [0, '$0'],
  [5, '$0.05'],
  [399890, '$3,998.90'],
  [100000, '$1,000'],
  [99900, '$999'],
  [-123456789, '-$1,234,567.89'],
])('formatUsd(%d) = %s', (cents, out) => {
  expect(formatUsd(cents)).toBe(out);
});

it.each([
  [2100, '$21.00'],
  [2250, '$22.50'],
  [0, '$0.00'],
  [5, '$0.05'],
  [-150, '-$1.50'],
  [399890, '$3,998.90'],
  [100000, '$1,000.00'],
  [123456789, '$1,234,567.89'],
])('formatUsdExact(%d) = %s', (cents, out) => {
  expect(formatUsdExact(cents)).toBe(out);
});
