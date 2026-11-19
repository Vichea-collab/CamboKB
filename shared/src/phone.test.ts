import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each(['012 345 678', '+855 12 345 678', '85512345678', '12345678', '0123-456-78'])(
    'normalizes %s to E.164',
    (input) => {
      expect(normalizePhone(input)).toBe('+85512345678');
    },
  );

  it.each(['abc', '123', ''])('rejects %j', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

import { formatPhone } from './phone';

describe('formatPhone', () => {
  it('formats E.164 for display', () => {
    expect(formatPhone('+85512345678')).toBe('+855 12 345 678');
  });
  it('returns the input when it cannot be parsed', () => {
    expect(formatPhone('n/a')).toBe('n/a');
  });
});
