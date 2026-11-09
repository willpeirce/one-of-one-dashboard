import { addDays, dayCount, ukToday } from '../hero-range.js';
import type { SourceMode } from '../sources.js';

export const tickerKinds = ['flag', 'spark', 'box', 'signpost', 'truck', 'pen'] as const;
export type TickerKind = typeof tickerKinds[number];
export interface KeyDate { name: string; date: string; note: string; kind: TickerKind }
export interface TickerItem extends KeyDate { key: string; days: number; chip: string; dateLabel: string }
export interface TickerPassed extends TickerItem { passed_at: string }
export interface PassedDate { event_key: string; passed_at: Date | string }
export interface TickerSnapshot {
  mode: SourceMode;
  current: TickerItem | null;
  then: TickerItem[];
  ahead: TickerItem[];
  passed: TickerPassed[];
}

export function tickerEventKey(row: Pick<KeyDate, 'name' | 'date'>): string {
  return `${row.name.trim().replace(/\s+/g, ' ').toLowerCase()}|${row.date}`;
}

/** Calendar-day arithmetic is independent of elapsed hours at either UK clock change. */
export function tickerState(rows: readonly KeyDate[], passed: readonly PassedDate[], now: Date, mode: SourceMode): TickerSnapshot {
  const today = ukToday(now);
  const passedByKey = new Map(passed.map(row => [row.event_key, new Date(row.passed_at).toISOString()]));
  const items = rows.map(row => {
    const days = dayCount(today, row.date) - 1;
    const chip = days < 0 ? `${-days} day${days === -1 ? '' : 's'} late`
      : days === 0 ? 'today' : days === 1 ? 'tomorrow' : days <= 60 ? `in ${days} days` : `in ${Math.ceil(days / 7)} weeks`;
    const dateLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
      ...(row.date.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' as const }) })
      .format(new Date(`${row.date}T12:00:00Z`)).replaceAll(',', '');
    return { ...row, key: tickerEventKey(row), days, chip, dateLabel };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'en-GB'));
  const ahead = items.filter(row => !passedByKey.has(row.key));
  const saved = items.filter(row => passedByKey.has(row.key)).map(row => ({ ...row, passed_at: passedByKey.get(row.key)! }))
    .sort((a, b) => b.passed_at.localeCompare(a.passed_at) || a.key.localeCompare(b.key));
  return { mode, current: ahead[0] ?? null, then: ahead.slice(1, 3), ahead, passed: saved };
}

export function sampleKeyDates(now: Date): KeyDate[] {
  const today = ukToday(now);
  return [
    { name: 'Sample order window', offset: -1, kind: 'flag' },
    { name: 'Sample launch', offset: 0, kind: 'spark' },
    { name: 'Sample stock arrival', offset: 1, kind: 'truck' },
    { name: 'Sample decision', offset: 7, kind: 'signpost' },
    { name: 'Sample packing deadline', offset: 30, kind: 'box' },
    { name: 'Sample artwork deadline', offset: 70, kind: 'pen' },
  ].map(row => ({ name: row.name, date: addDays(today, row.offset), note: 'Sample data. Invented date.', kind: row.kind as TickerKind }));
}
