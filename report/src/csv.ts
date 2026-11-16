/** RFC 4180 quoting, plus a leading ' on cells that spreadsheets would run as formulas. */
export function escapeCsvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: (keyof T & string)[]): string {
  const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => escapeCsvCell(r[c])).join(','))];
  return `${lines.join('\r\n')}\r\n`;
}
