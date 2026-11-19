/** Format integer USD cents for display: 2100 → "$21", 2150 → "$21.50". */
export function formatUsd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  return rest === 0 ? `${sign}$${dollars}` : `${sign}$${dollars}.${String(rest).padStart(2, '0')}`;
}

/**
 * Same as formatUsd but always with cents: 2100 → "$21.00". Use it where amounts line up in a column
 * (totals, summaries, reports) so "$21", "$1.50" and "$22.50" don't sit next to each other.
 */
export function formatUsdExact(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
