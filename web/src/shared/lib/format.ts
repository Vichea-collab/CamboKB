import { intlLocale } from './i18n';

/** Dates and times, always in Phnom Penh time, the same way on every page. */
const TZ = 'Asia/Phnom_Penh';

/** 18 Nov 2026, 14:05 */
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(intlLocale(), { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
/** 18 Nov 2026 */
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(intlLocale(), { timeZone: TZ, dateStyle: 'medium' });
/** 14:05 */
export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(intlLocale(), { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
