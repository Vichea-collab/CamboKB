import { expect, it } from 'vitest';
import { formatUsd } from './money';

it.each([
  [2100, '$21'],
  [2150, '$21.50'],
  [0, '$0'],
  [5, '$0.05'],
])('formatUsd(%d) = %s', (cents, out) => {
  expect(formatUsd(cents)).toBe(out);
});
