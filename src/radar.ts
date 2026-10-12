import type { SpendFacts } from './ad-spend/store.js';
import { formatNumber } from './money.js';

export type RadarAdSource = Pick<SpendFacts['sources'][number], 'source' | 'live' | 'status' | 'fetchedAt' | 'stale' | 'failures'>;
export interface RadarMeasure { score: number; label: string; reason: string }
export interface RadarTally { good: number; warn: number; alarm: number }
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
    if (!source || !source.live) return { score: 0, label: 'Waiting for keys', reason: 'The ad spend connection is not configured.' };
    if ((source.failures ?? 0) > 0 || source.status === 'source unavailable')
      return { score: 0, label: 'Unavailable', reason: 'The last ad spend read failed. Check Source health.' };
    if (source.stale || source.status.startsWith('stale'))
      return { score: 0.5, label: 'Stale', reason: 'Ad spend has missed three polls. Check Source health.' };
    if (!source.fetchedAt) return { score: 0, label: 'No data yet', reason: 'The first ad spend sync is pending.' };
    return { score: 1, label: 'Live', reason: 'Ad spend is updating.' };
  }
  const total = tally ? tally.good + tally.warn + tally.alarm : 0;
  if (!tally || !total) return { score: 0, label: 'No data yet', reason: noMeasureReasons[key] ?? 'No measures are available for this group yet.' };
  const score = (tally.good + 0.5 * tally.warn) / total;
  return { score, label: `${formatNumber(Math.round(score * 100))}%`, reason: 'Green checks count fully; amber checks count half.' };
}
