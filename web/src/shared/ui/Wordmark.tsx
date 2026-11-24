import { t } from '../lib/strings';

/** The shop's name in two parts: the last word is the yellow one. One place, so the shop and the admin always agree. */
export function brandParts(): { first: string; last: string } {
  const words = t.brand.name.split(' ');
  const last = words.pop() ?? '';
  return { first: words.join(' '), last };
}
