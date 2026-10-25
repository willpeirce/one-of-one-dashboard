import type { SpendFacts } from './ad-spend/store.js';
import { formatNumber } from './money.js';

export type RadarAdSource = Pick<SpendFacts['sources'][number], 'source' | 'live' | 'status' | 'fetchedAt' | 'stale' | 'failures'>;
export interface RadarMeasure { score: number | null; label: string; reason: string }
export interface RadarTally { good: number; warn: number; alarm: number; reason?: string }
export interface RadarArea { key: string; name: string; measure: RadarMeasure; target?: string }
const noMeasureReasons: Record<string, string> = {
  growth: 'Growth measures are not built yet.',
  store: 'Shopify has no measured store checks yet.',
  email: 'Mailchimp measures are not built yet.',
  stock: 'Stock or its sales rate is not available yet.',
};

/** Advertising axes describe the spend feed, independently of deferred campaign gauges. */
export function radarMeasure(key: string, tally?: RadarTally, ads?: readonly RadarAdSource[]): RadarMeasure {
  if (key === 'meta' || key === 'google') {
    const source = ads?.find(row => row.source === (key === 'meta' ? 'meta' : 'google-ads'));
    if (!source || !source.live) return { score: null, label: 'Waiting for keys', reason: 'The ad spend connection is not configured.' };
    if ((source.failures ?? 0) > 0 || source.status === 'source unavailable')
      return { score: source.fetchedAt ? 0 : null, label: 'Unavailable', reason: 'The last ad spend read failed. Check Source health.' };
    if (source.stale || source.status.startsWith('stale'))
      return { score: source.fetchedAt ? 0.5 : null, label: 'Stale', reason: 'Ad spend has missed three polls. Check Source health.' };
    if (!source.fetchedAt) return { score: null, label: 'No data yet', reason: 'The first ad spend sync is pending.' };
    return { score: 1, label: 'Live', reason: 'Ad spend is updating.' };
  }
  const total = tally ? tally.good + tally.warn + tally.alarm : 0;
  if (!tally || !total) return { score: null, label: 'Not built', reason: noMeasureReasons[key] ?? 'No measures are available for this group yet.' };
  const score = (tally.good + 0.5 * tally.warn) / total;
  return { score, label: `${formatNumber(Math.round(score * 100))}%`, reason: tally.reason ?? 'Green checks count fully; amber checks count half.' };
}

/** Decisions and information have no performance score. */
export function radarGaugeScore(state: string): number | null {
  return state === 'good' ? 1 : state === 'warn' ? 0.5 : state === 'alarm' ? 0 : null;
}

export function weakestRadarGauge<T>(gauges: readonly T[], state: (gauge: T) => string): T | undefined {
  let weakest: T | undefined, lowest = Infinity;
  for (const gauge of gauges) {
    const score = radarGaugeScore(state(gauge));
    if (score !== null && score < lowest) { weakest = gauge; lowest = score; }
  }
  return weakest;
}

export function radarSummary(areas: readonly RadarArea[]): { health: number | null; weakest?: RadarArea } {
  const measured = areas.filter(area => area.measure.score !== null);
  const weakest = measured.reduce<RadarArea | undefined>((current, area) =>
    !current || area.measure.score! < current.measure.score! ? area : current, undefined);
  return { health: measured.length < 3 ? null : Math.round(100 * measured.reduce((sum, area) => sum + area.measure.score!, 0) / measured.length),
    ...(weakest ? { weakest } : {}) };
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
export interface DropArea extends RadarArea { alarms: number; title: string }

export function droppedAreas(areas: readonly DropArea[]): DropArea[] {
  return areas.filter(area => area.alarms > 0 || ['Stale', 'Unavailable'].includes(area.measure.label))
    .sort((a, b) => b.alarms - a.alarms || (a.measure.score ?? 0) - (b.measure.score ?? 0));
}

export function dropsHtml(areas: readonly DropArea[]): string {
  const dropped = droppedAreas(areas);
  if (!dropped.length) return '<span class="drops-clear">✓ Nothing has dropped</span>';
  return '<span class="drops-label"><span class="drops-icon">▼</span> Dropped:</span>' + dropped.slice(0, 2).map((area, index) =>
    `${index ? '<span>,</span>' : ''}<span class="drop-area"><button type="button" data-drop-key="${escapeHtml(area.key)}">${escapeHtml(area.name)}</button><span class="drop-title" title="${escapeHtml(area.title)}"> · ${escapeHtml(area.title)}</span></span>`).join('')
    + (dropped.length > 2 ? `<span class="drops-more">+${dropped.length - 2} more</span>` : '');
}
