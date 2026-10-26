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
  dayBasis?: 'uk' | 'gmt';
  impressions?: number | null;
  linkClicks?: number | null;
  addsToCart?: number | null;
  purchases?: number | null;
  purchaseValue?: number | null;
}
export interface SpendHourRow extends SpendRow { hour: number }
/** Optional recent hourly rows accompany the daily totals from the same report. */
export type SpendRead = SpendRow[] & { hourly?: SpendHourRow[] };
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
  retryAfterMs?: number;
  readonly status: number;
  readonly providerCode: number | undefined;
  readonly providerSubcode: number | undefined;
  constructor(
    readonly code:
      | 'hourly_unavailable'
      | 'http'
      | 'timeout'
      | 'invalid'
      | 'unauthorized'
      | 'rate_limit'
      | 'developer_token_required'
      | 'unsupported_account',
    status = 0,
    providerCode?: unknown,
    providerSubcode?: unknown,
  ) {
    super(`Ad spend request failed (${code}).`);
    this.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
    this.providerCode = safeNumericCode(providerCode);
    this.providerSubcode = safeNumericCode(providerSubcode);
  }
}
function safeNumericCode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
/** Only app-owned categories and numeric provider details may reach logs or Settings. */
export function adErrorCode(error: unknown, source: AdSource): string {
  if (!(error instanceof AdError)) return 'unknown';
  const parts: string[] = error.code === 'http' && error.status ? [] : [error.code];
  if (error.status) parts.push(`http ${error.status}`);
  if (error.providerCode !== undefined) {
    const provider = source === 'google-ads' ? 'google' : source;
    parts.push(`${provider} ${error.providerCode}${error.providerSubcode === undefined ? '' : `/${error.providerSubcode}`}`);
  }
  return parts.join(', ');
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
function sourceHourInstants(day: string, hour: number, zone: string): number[] {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(hour) || hour < 0 || hour > 23)
    throw new AdError('invalid');
  const wall = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 10) !== day)
    throw new AdError('invalid');
  if (zone === 'UTC' || zone === 'GMT' || zone === 'Etc/GMT') return [wall];
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
  return candidates;
}
export function hourDay(day: string, hour: number, zone = 'UTC'): string {
  const days = [...new Set(sourceHourInstants(day, hour, zone).map(at => ukToday(new Date(at))))];
  // A repeated source hour is an aggregate bucket; never invent its allocation.
  if (days.length !== 1) throw new AdError('invalid');
  return days[0]!;
}
const ukHourClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' });
/** Repeated autumn UK hours combine; a source bucket must map to one UK hour. */
export function ukHourBucket(day: string, hour: number, zone: string): { day: string; hour: number } {
  const buckets = new Map(sourceHourInstants(day, hour, zone).map(at => {
    const date = new Date(at), bucket = { day: ukToday(date), hour: Number(ukHourClock.format(date)) };
    return [`${bucket.day}:${bucket.hour}`, bucket] as const;
  }));
  if (buckets.size !== 1) throw new AdError('invalid');
  return [...buckets.values()][0]!;
}
export function aggregateSpendHours(rows: SpendHourRow[], from: string, to: string): SpendHourRow[] {
  const groups = new Map<string, SpendHourRow>();
  for (const row of rows) {
    if (row.day < from || row.day > to) continue;
    const key = JSON.stringify([row.campaignId, row.adSetId, row.day, row.hour]);
    const previous = groups.get(key);
    if (previous && (previous.currency !== row.currency || previous.market !== row.market)) throw new AdError('invalid');
    groups.set(key, { ...row, amount: microsDecimal(decimalMicros(row.amount) + (previous ? decimalMicros(previous.amount) : 0n)) });
  }
  return [...groups.values()];
}
export function aggregateHours(rows: SpendRow[], from: string, to: string): SpendRow[] {
  const groups = new Map<string, { row: SpendRow; micros: bigint }>();
  for (const row of rows) {
    if (row.day < from || row.day > to) continue;
    const key = JSON.stringify([row.source, row.campaignId, row.adSetId, row.day]);
    const current = groups.get(key);
    if (current && (current.row.currency !== row.currency || current.row.market !== row.market))
      throw new AdError('invalid');
    if (current) {
      current.micros += decimalMicros(row.amount);
      for (const field of ['impressions', 'linkClicks', 'addsToCart', 'purchases', 'purchaseValue'] as const) {
        if (field in current.row || field in row)
          current.row[field] = current.row[field] == null || row[field] == null ? null : current.row[field]! + row[field]!;
      }
    }
    else groups.set(key, { row: { ...row }, micros: decimalMicros(row.amount) });
  }
  return [...groups.values()].map(({ row, micros }) => ({ ...row, amount: microsDecimal(micros) }));
}
export const accountFor = (source: AdSource, settings: Settings) =>
  source === 'meta'
    ? settings.metaAdAccountId
    : source === 'google-ads'
      ? settings.googleCustomerId
      : settings.tiktokAdvertiserId;
