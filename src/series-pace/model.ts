import { addDays, ukToday } from '../hero-range.js';

export type SeriesPaceMarket = 'UK' | 'US';
export interface SeriesPaceDay {
  day: string;
  sold: number;
  source: 'snapshot' | 'shopifyql';
}
export interface SeriesPaceInput {
  today: string;
  targetDate: string;
  stock: number | null;
  days: readonly SeriesPaceDay[];
}
export type SeriesPaceStatus = 'on_pace' | 'too_fast' | 'too_slow' | 'paused' | 'target_reached' | 'sold_out' | 'waiting' | 'stock_unknown';
export interface SeriesPaceResult {
  today: string;
  targetDate: string;
  stock: number | null;
  days: SeriesPaceDay[];
  dayCount: number;
  daysLeft: number;
  average: number | null;
  needed: number | null;
  projectedDays: number | null;
  projectedDate: string | null;
  gap: number | null;
  gapDays: number | null;
  needle: number;
  estimatedKits: number | null;
  correctionPerDay: number | null;
  trendAverage: number | null;
  trend: 'up' | 'down' | null;
  status: SeriesPaceStatus;
  state: 'good' | 'warn' | 'muted';
  verdict: string;
  outcome: string;
  correction: string;
  averageLabel: string;
  completeThrough: string;
}

const DAY = 86_400_000;
const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
const oneDecimal = (value: number): number => Math.sign(value) * Math.round(Math.abs(value) * 10) / 10;
const whole = (value: number): string => Math.round(value).toLocaleString('en-GB');

export function paceNumber(value: number): string {
  return value.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
export function paceDate(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}

/** All dates are already UK calendar dates. Arithmetic keeps full precision until a display field. */
export function calculateSeriesPace(input: SeriesPaceInput): SeriesPaceResult {
  const { today, targetDate, stock } = input;
  const completeThrough = addDays(today, -1);
  const firstDay = addDays(today, -7);
  const days = [...new Map(input.days.filter(day => day.day >= firstDay && day.day <= completeThrough)
    .map(day => [day.day, { ...day }])).values()].sort((a, b) => a.day.localeCompare(b.day));
  const daysLeft = (Date.parse(`${targetDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY;
  const lastTwo = [addDays(today, -2), completeThrough].map(day => days.find(row => row.day === day));
  const paused = lastTwo.every(day => day !== undefined && day.sold <= 0);
  // Keep the signed facts for the sheet. Only the two days establishing a pause count as zero.
  const counted = days.map(day => paused && day.day >= addDays(today, -2) ? 0 : day.sold);
  const average = counted.length ? mean(counted) : null;
  const trendAverage = counted.length >= 3 ? mean(counted.slice(-3)) : null;
  const trend = average !== null && trendAverage !== null && oneDecimal(trendAverage) !== oneDecimal(average)
    ? trendAverage > average ? 'up' : 'down' : null;
  const needed = stock !== null && daysLeft > 0 ? stock / daysLeft : null;
  const projectedDays = stock !== null && stock > 0 && average !== null && average > 0 ? stock / average : null;
  const gap = projectedDays === null ? null : daysLeft - projectedDays;
  const correctionPerDay = needed !== null && average !== null ? Math.abs(needed - average) : null;
  const result: SeriesPaceResult = {
    today, targetDate, stock, days, dayCount: days.length, daysLeft, average, needed, projectedDays,
    projectedDate: projectedDays === null ? null : addDays(today, projectedDays), gap,
    gapDays: gap === null ? null : Math.round(Math.abs(gap)), needle: gap === null ? -90 : Math.max(-90, Math.min(90, gap)),
    estimatedKits: needed !== null && average !== null ? Math.round(Math.abs(average - needed) * daysLeft / 10) * 10 : null,
    correctionPerDay, trendAverage, trend, status: 'waiting', state: 'muted', verdict: 'Waiting for the first complete day', outcome: '', correction: '',
    averageLabel: `${days.length}-day average`, completeThrough,
  };
  if (stock === null) return { ...result, status: 'stock_unknown', verdict: 'Waiting for current stock' };
  if (stock <= 0) return { ...result, status: 'sold_out', state: 'warn', verdict: 'Sold out',
    outcome: daysLeft > 0 ? `${whole(daysLeft)} days before the target` : daysLeft < 0 ? `${whole(-daysLeft)} days after the target` : 'On the target date' };
  if (daysLeft <= 0) return { ...result, status: 'target_reached', verdict: 'Target date reached' };
  if (average === null || needed === null) return result;
  result.correction = correctionPerDay !== null && oneDecimal(correctionPerDay) === 0 ? 'hold this pace'
    : `sell about ${paceNumber(correctionPerDay!)} ${needed > average ? 'more' : 'fewer'} a day`;
  if (paused) return { ...result, status: 'paused', state: 'warn', verdict: 'PAUSED', outcome: 'The last two complete days were zero or below.' };
  if (average <= 0) return { ...result, status: 'too_slow', state: 'warn', verdict: 'TOO SLOW', estimatedKits: stock,
    outcome: `no sell-out at this pace · about ${whole(stock)} kits left on the target date` };
  result.outcome = gap! > 0
    ? `sells out ${whole(result.gapDays!)} days early, about ${whole(result.estimatedKits!)} kits short`
    : gap! < 0 ? `about ${whole(result.estimatedKits!)} kits left on the target date · sells out ${whole(result.gapDays!)} days late`
      : 'sells out on the target date';
  if (Math.abs(gap!) <= 5) return { ...result, status: 'on_pace', state: 'good', verdict: 'ON PACE' };
  return { ...result, status: gap! > 5 ? 'too_fast' : 'too_slow', state: 'warn', verdict: gap! > 5 ? 'TOO FAST' : 'TOO SLOW' };
}

/** Invented examples from the change request; independent of saved Settings. */
export function sampleSeriesPace(now: Date | string): Record<SeriesPaceMarket, SeriesPaceResult> {
  const today = ukToday(typeof now === 'string' ? new Date(now) : now);
  const days = (sold: number[]): SeriesPaceDay[] => sold.map((quantity, index) => ({ day: addDays(today, index - 7), sold: quantity, source: 'shopifyql' }));
  return {
    UK: calculateSeriesPace({ today, stock: 1850, targetDate: addDays(today, 120), days: days([18, 12, 16, 13, 14, 16, 16]) }),
    US: calculateSeriesPace({ today, stock: 2400, targetDate: addDays(today, 90), days: days([20, 17, 22, 15, 19, 14, 12]) }),
  };
}
