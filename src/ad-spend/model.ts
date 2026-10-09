import { ukToday } from '../hero-range.js';
import type { Settings } from '../settings.js';
import type { SourceMode } from '../sources.js';
export const adSources = ['meta', 'google-ads', 'tiktok'] as const;
export type AdSource = (typeof adSources)[number];
export const adNames: Record<AdSource, string> = {
  meta: 'Meta',
  'google-ads': 'Google',
  tiktok: 'TikTok',
};
export interface SpendRow {
  source: AdSource;
  accountId: string;
  campaignId: string;
  campaignName: string;
  adSetId: string | null;
  adSetName: string | null;
  market: 'uk' | 'us' | 'unknown';
  owner: 'ours' | 'freelancer' | 'unassigned';
  day: string;
  amount: string;
  currency: string;
}
export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  createdAt: string;
}
export interface MetaCampaignView extends MetaCampaign {
  firstSeen: string;
  lastSeen: string;
  owner: 'ours' | 'freelancer';
  confirmed: boolean;
  mode: SourceMode;
}
export class AdError extends Error {
  constructor(
    readonly code:
      | 'http'
      | 'timeout'
      | 'invalid'
      | 'unauthorized'
      | 'rate_limit'
      | 'developer_token_required',
    readonly status = 0,
  ) {
    super(`Ad spend request failed (${code}).`);
  }
}
export function decimalMicros(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d{1,18}(\.\d{1,6})?$/.test(value))
    throw new AdError('invalid');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}
export function microsDecimal(value: bigint): string {
  return `${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, '0')}`;
}
export function nameMarket(...names: (string | null)[]): SpendRow['market'] {
  const text = names.join(' '),
    uk = /\bUK\b/i.test(text),
    us = /\bUS\b/i.test(text);
  return uk && !us ? 'uk' : us && !uk ? 'us' : 'unknown';
}
export function marketFor(
  names: (string | null)[],
  countries: readonly string[] = [],
): SpendRow['market'] {
  const named = nameMarket(...names);
  if (named !== 'unknown') return named;
  const unique = [...new Set(countries)];
  return unique.length === 1
    ? unique[0] === 'GB'
      ? 'uk'
      : unique[0] === 'US'
        ? 'us'
        : 'unknown'
    : 'unknown';
}
export function ownerFor(
  source: AdSource,
  campaignId: string,
  settings: Pick<Settings, 'metaOwners'>,
): 'ours' | 'freelancer' {
  return source === 'meta'
    ? (settings.metaOwners.find((r) => r.campaignId === campaignId)?.owner ?? 'ours')
    : 'freelancer';
}
/** Source hours are UTC unless Meta explicitly supplies another account timezone. */
export function hourDay(day: string, hour: number, zone = 'UTC'): string {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(hour) || hour < 0 || hour > 23)
    throw new AdError('invalid');
  const wall = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 10) !== day)
    throw new AdError('invalid');
  if (zone === 'UTC' || zone === 'GMT' || zone === 'Etc/GMT') return ukToday(new Date(wall));
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const local = (at: number) => {
    const p = formatter.formatToParts(new Date(at));
    const n = (k: string) => Number(p.find((r) => r.type === k)!.value);
    return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'));
  };
  const offsets = new Set(
    [-24, 0, 24].map((h) => local(wall + h * 3600000) - (wall + h * 3600000)),
  );
  const candidates = [...offsets].map((offset) => wall - offset).filter((at) => local(at) === wall);
  const days = [...new Set(candidates.map((at) => ukToday(new Date(at))))];
  // A repeated source hour is an aggregate bucket; never invent its allocation.
  if (days.length !== 1) throw new AdError('invalid');
  return days[0]!;
}
export function aggregateHours(rows: SpendRow[], from: string, to: string): SpendRow[] {
  const groups = new Map<string, { row: SpendRow; micros: bigint }>();
  for (const row of rows) {
    if (row.day < from || row.day > to) continue;
    const key = JSON.stringify([row.source, row.campaignId, row.adSetId, row.day]);
    const current = groups.get(key);
    if (current && (current.row.currency !== row.currency || current.row.market !== row.market))
      throw new AdError('invalid');
    if (current) current.micros += decimalMicros(row.amount);
    else groups.set(key, { row, micros: decimalMicros(row.amount) });
  }
  return [...groups.values()].map(({ row, micros }) => ({ ...row, amount: microsDecimal(micros) }));
}
export const accountFor = (source: AdSource, settings: Settings) =>
  source === 'meta'
    ? settings.metaAdAccountId
    : source === 'google-ads'
      ? settings.googleCustomerId
      : settings.tiktokAdvertiserId;
