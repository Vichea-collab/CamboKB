import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Normalize a phone number to E.164, defaulting to Cambodia. Returns null when invalid. */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  // "855..." typed without a plus is a Cambodian international number.
  const candidate = /^855\d{8,9}$/.test(digits) ? `+${digits}` : raw;
  const parsed = parsePhoneNumberFromString(candidate, 'KH');
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** "+85512345678" → "+855 •• ••• 678" */
export function maskPhone(e164: string): string {
  const tail = e164.slice(-3);
  const cc = e164.startsWith('+855') ? '+855' : e164.slice(0, e164.length - 8);
  return `${cc} •• ••• ${tail}`;
}
