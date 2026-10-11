import { addDays, ukToday } from '../hero-range.js';
import { formatNumber } from '../money.js';

export const GEO_NOTICE_ID = 'geo:recent';
/** A rolling UK-day notice; unaffected store-wide totals remain usable. */
export function geoNotice(rows: readonly { day: string; marketReliable: boolean }[], now: Date) {
  const today = ukToday(now), from = addDays(today, -6);
  const days = new Set(rows.filter(row => row.day >= from && row.day <= today && !row.marketReliable).map(row => row.day)).size;
  return days ? { days, why: `Some sessions have no reliable country, so conversion by market is approximate for ${formatNumber(days)} ${days === 1 ? 'day' : 'days'}. Store-wide conversion is unaffected.` } : null;
}
