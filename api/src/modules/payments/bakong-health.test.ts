import { describe, expect, it } from 'vitest';
import { BakongHealth } from './bakong-health';

const SEC = 1000;
const MIN = 60 * SEC;
/** Fail every 20 seconds (as the sweep does) from `from` to `to`, and return what was said and when. */
const failing = (h: BakongHealth, from: number, to: number) => {
  const said: number[] = [];
  for (let t = from; t <= to; t += 20 * SEC) if (h.failed(t) === 'down') said.push(t - from);
  return said;
};

describe('Bakong health', () => {
  it('says it is down after 5 minutes of failing, once', () => {
    expect(failing(new BakongHealth(), 0, 60 * MIN)).toEqual([5 * MIN]);
  });

  it('stays quiet about a short hiccup', () => {
    const h = new BakongHealth();
    expect(failing(h, 0, 4 * MIN)).toEqual([]);
    expect(h.ok()).toBeNull();
    expect(failing(h, 5 * MIN, 9 * MIN)).toEqual([]);
  });

  it('says when it works again, once, and can report the next outage', () => {
    const h = new BakongHealth();
    failing(h, 0, 6 * MIN);
    expect(h.ok()).toBe('recovered');
    expect(h.ok()).toBeNull();
    expect(failing(h, 20 * MIN, 30 * MIN)).toEqual([5 * MIN]);
  });

  it('two single failures hours apart are not an outage (it only asks while somebody is paying)', () => {
    const h = new BakongHealth();
    expect(h.failed(0)).toBeNull();
    expect(h.failed(180 * MIN)).toBeNull();
    expect(failing(h, 180 * MIN + 20 * SEC, 183 * MIN)).toEqual([]);
  });

  it('does not repeat itself when nobody paid for a while during the same outage', () => {
    const h = new BakongHealth();
    failing(h, 0, 6 * MIN);
    expect(failing(h, 120 * MIN, 140 * MIN)).toEqual([]);
    expect(h.ok()).toBe('recovered');
  });
});
