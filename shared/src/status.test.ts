import { expect, it } from 'vitest';
import { canTransition } from './status';

it.each([
  ['PENDING', 'CONFIRMED', true],
  ['PENDING', 'DELIVERED', true],
  ['DELIVERED', 'PENDING', false],
  ['SHIPPING', 'CANCELLED', false],
  ['PACKED', 'CANCELLED', true],
  ['CANCELLED', 'CONFIRMED', false],
  ['PENDING', 'PENDING', false],
] as const)('%s -> %s is %s', (from, to, ok) => {
  expect(canTransition(from, to)).toBe(ok);
});
