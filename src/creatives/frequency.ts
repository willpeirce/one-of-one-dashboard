import { createHash } from 'node:crypto';
import type { Database } from '../db.js';
import { addDays, ukToday } from '../hero-range.js';
import type { CreativeData, CreativeFrequencyRead, CreativeReader } from './model.js';
import { aggregateCreativeGroups, matchesCreativeAd, type CreativeFilter, type GroupPerformance } from './ranking.js';

export const FREQUENCY_REFRESH_MS = 30 * 60_000;
export const FREQUENCY_READ_LIMIT = 20;

const membership = (adIds: readonly string[]): string[] => [...new Set(adIds)].sort();
export const frequencyMembershipKey = (adIds: readonly string[]): string =>
  createHash('sha256').update(JSON.stringify(membership(adIds))).digest('hex');

export function hasFadingHistory(row: GroupPerformance, today: string): boolean {
  return row.spendDays >= 7 && !!row.firstSpendDay && !!row.lastSpendDay && row.lastSpendDay >= addDays(today, -1)
    && row.ads.some(ad => ad.effectiveStatus === 'ACTIVE');
}

/** Each filter combination needs its own deduplicated audience, rather than adding daily reaches. */
export function buildFrequencyRequests(data: CreativeData, today: string): Omit<CreativeFrequencyRead, 'frequency'>[] {
  const requests = new Map<string, Omit<CreativeFrequencyRead, 'frequency'>>();
  const contexts: CreativeFilter[] = [];
  for (const market of ['all', 'uk', 'us'] as const)
    for (const owner of ['all', 'ours', 'freelancer', 'unassigned'] as const)
      for (const live of ['all', true, false] as const) contexts.push({ market, owner, live });
  const groups = aggregateCreativeGroups(data, { to: today });
  const historyByAd = new Map<string, { day: string; spend: number }[]>();
  for (const row of data.insights) {
    if (row.day > today || row.spend <= 0) continue;
    const rows = historyByAd.get(row.adId) ?? [];
    rows.push(row); historyByAd.set(row.adId, rows);
  }
  for (const group of groups) for (const context of contexts) {
    const ads = group.ads.filter(ad => matchesCreativeAd(ad, context));
    if (!ads.length || !ads.some(ad => ad.effectiveStatus === 'ACTIVE')) continue;
    const adIds = membership(ads.map(ad => ad.id)), key = frequencyMembershipKey(adIds);
    if (requests.has(key)) continue;
    const days = [...new Set(ads.flatMap(ad => (historyByAd.get(ad.id) ?? []).map(row => row.day)))].sort();
    if (days.length < 7 || days.at(-1)! < addDays(today, -1)) continue;
    requests.set(key, { adIds, from: addDays(today, -6), to: today });
  }
  return [...requests.values()];
}

/** Missing, stale-window or differently filtered reads remain unavailable. */
export function exactCreativeFrequency(data: CreativeData, adIds: readonly string[], from: string, to: string): number | null {
  const expected = JSON.stringify(membership(adIds));
  const read = data.frequencyReads?.find(row => row.from === from && row.to === to
    && JSON.stringify(membership(row.adIds)) === expected);
  return read?.frequency !== null && read?.frequency !== undefined && Number.isFinite(read.frequency) && read.frequency >= 0
    ? read.frequency : null;
}

/** Refresh at most twenty distinct memberships, prioritising missing and oldest reads. */
export async function refreshCreativeFrequencies(db: Database, reader: CreativeReader, account: string,
  data: CreativeData, now = new Date()): Promise<{ requested: number; refreshed: number; unavailable: number }> {
  if (!reader.readFrequency || data.mode !== 'live') return { requested: 0, refreshed: 0, unavailable: 0 };
  const today = ukToday(now), requests = buildFrequencyRequests(data, today);
  const stored = await db.query<{ membership_key: string; fetched_at: Date | string }>(
    'SELECT membership_key,fetched_at FROM pulse.creative_frequencies WHERE account_id=$1 AND from_day=$2 AND to_day=$3',
    [account, addDays(today, -6), today]);
  const fetched = new Map(stored.rows.map(row => [row.membership_key, new Date(row.fetched_at).getTime()]));
  const pending = requests.map(request => ({ request, key: frequencyMembershipKey(request.adIds) }))
    .filter(({ key }) => !fetched.has(key) || now.getTime() - fetched.get(key)! >= FREQUENCY_REFRESH_MS)
    .sort((a, b) => (fetched.get(a.key) ?? 0) - (fetched.get(b.key) ?? 0) || a.key.localeCompare(b.key));
  let refreshed = 0, unavailable = 0;
  for (const { request, key } of pending.slice(0, FREQUENCY_READ_LIMIT)) {
    let frequency: number | null = null;
    try {
      const result = await reader.readFrequency(account, request.adIds, request.from, request.to);
      if (result !== null && Number.isFinite(result) && result >= 0) frequency = result;
    } catch {
      // Refused reads never reuse a previous audience measurement or expose a provider error.
    }
    if (frequency === null) unavailable++;
    await db.query(`INSERT INTO pulse.creative_frequencies(account_id,membership_key,ad_ids,from_day,to_day,frequency,fetched_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(account_id,membership_key,from_day,to_day)
      DO UPDATE SET ad_ids=EXCLUDED.ad_ids,frequency=EXCLUDED.frequency,fetched_at=EXCLUDED.fetched_at`,
    [account, key, JSON.stringify(request.adIds), request.from, request.to, frequency, now]);
    refreshed++;
  }
  if (unavailable) console.info(`Meta creative frequency unavailable for ${unavailable} reads.`);
  // Only the current seven-day window is useful for fading, so avoid unbounded daily cache growth.
  await db.query('DELETE FROM pulse.creative_frequencies WHERE account_id=$1 AND to_day<$2', [account, today]);
  return { requested: requests.length, refreshed, unavailable };
}
