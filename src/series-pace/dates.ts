import { addDays } from '../hero-range.js';

export function isSeriesDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export interface SeriesPaceDates {
  landingDate: string;
  targetDate: string;
  targetKind: 'landing date' | 'your date';
}

/** Calendar-day offsets, independent of clocks and daylight saving changes. */
export function seriesPaceDates(orderDate: string, offsetDays: number, targetDate = ''): SeriesPaceDates | null {
  if (!isSeriesDate(orderDate) || !Number.isInteger(offsetDays) || offsetDays < 0 || offsetDays > 365
    || (targetDate !== '' && !isSeriesDate(targetDate))) return null;
  const landingDate = addDays(orderDate, offsetDays);
  if (!isSeriesDate(landingDate)) return null;
  return { landingDate, targetDate: targetDate || landingDate, targetKind: targetDate ? 'your date' : 'landing date' };
}
