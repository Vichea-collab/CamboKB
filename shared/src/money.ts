/** Format integer USD cents for display: 2100 → "$21", 2150 → "$21.50". */
export function formatUsd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  return rest === 0 ? `${sign}$${dollars}` : `${sign}$${dollars}.${String(rest).padStart(2, '0')}`;
}
