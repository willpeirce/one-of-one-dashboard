import { addDays } from '../hero-range.js';
import { formatNumber, formatPounds } from '../money.js';
import type { Settings } from '../settings.js';
import type { AdInsight, CreativeAd, CreativeData, CreativeMarket, CreativeOwner, MediaGroup } from './model.js';

export type CreativeWindow = '24h' | '3d' | '7d' | 'lifetime';
export interface CreativeFilter {
  market?: 'all' | 'uk' | 'us';
  owner?: 'all' | CreativeOwner;
  kind?: 'all' | MediaGroup['kind'];
  live?: 'all' | boolean;
}
export interface CreativeRange extends CreativeFilter { from?: string; to?: string }

const ratio = (numerator: number, denominator: number): number | null => denominator > 0 ? numerator / denominator : null;
const sums = ['spend', 'impressions', 'reach', 'linkClicks', 'threeSecondPlays', 'plays', 'thruPlays',
  'plays25', 'plays50', 'plays75', 'plays100', 'addsToCart', 'purchases', 'purchaseValue'] as const;

/** Rates are ratios of totals, never averages of the individual ad/day rates. */
export function creativeTotals(rows: readonly AdInsight[], kind?: MediaGroup['kind']) {
  const totals = Object.fromEntries(sums.map(key => [key, 0])) as Record<typeof sums[number], number>;
  let weightedPlayTime = 0, holdThreeSecondPlays = 0, holdDataRows = 0, allSpendPlaysZero = true;
  const spendDays=new Set<string>(),missingPlayDays=new Set<string>();
  const hookSources = new Set<AdInsight['threeSecondSource']>();
  for (const row of rows) {
    for (const key of sums) totals[key] += row[key] ?? 0;
    if(row.spend>0){
      spendDays.add(row.day);
      if(row.plays==null)missingPlayDays.add(row.day);
      if(row.plays!==0||row.thruPlays!==0)allSpendPlaysZero=false;
    }
    if (row.thruPlays != null) {
      holdThreeSecondPlays += row.holdThreeSecondPlays ?? row.threeSecondPlays;
      holdDataRows++;
    }
    weightedPlayTime += row.averagePlayTime * (row.plays??0);
    if (row.threeSecondSource !== 'none') hookSources.add(row.threeSecondSource);
  }
  // A served video with only zero play pairs has no usable play reading.
  if(kind==='video'&&allSpendPlaysZero)for(const day of spendDays)missingPlayDays.add(day);
  return {
    ...totals, holdThreeSecondPlays, holdDataRows,holdSpendDays:spendDays.size,holdMissingPlayDays:missingPlayDays.size,
    roas: ratio(totals.purchaseValue, totals.spend),
    costPerPurchase: ratio(totals.spend, totals.purchases),
    ctr: ratio(totals.linkClicks, totals.impressions),
    hookRate: ratio(totals.threeSecondPlays, totals.impressions),
    holdRate: missingPlayDays.size?null:ratio(totals.thruPlays, holdThreeSecondPlays),
    watchThroughRate: ratio(totals.plays100, totals.plays),
    addToCartRate: ratio(totals.addsToCart, totals.linkClicks),
    averagePlayTime: ratio(weightedPlayTime, totals.plays),
    // Daily/ad reach cannot deduplicate the same person across the whole window.
    dailyReachFrequencyProxy: ratio(totals.impressions, totals.reach),
    frequencyNote: 'Frequency proxy: impressions ÷ summed daily ad reach; people may be counted more than once.',
    hookSource: hookSources.size > 1 ? 'mixed' as const : [...hookSources][0] ?? 'none',
  };
}
export type CreativeTotals = ReturnType<typeof creativeTotals>;

/** Broken/cyclic ancestry must never create two performance entries for one group. */
export function parentGroup(groupId: string, groups: readonly MediaGroup[]): MediaGroup | null {
  return resolveParent(groupId, new Map(groups.map(group => [group.id, group])));
}

function resolveParent(groupId: string, indexed: ReadonlyMap<string, MediaGroup>): MediaGroup | null {
  const seen = new Set<string>();
  let group = indexed.get(groupId);
  while (group?.mergedIntoId) {
    if (seen.has(group.id)) return null;
    seen.add(group.id);
    group = indexed.get(group.mergedIntoId);
  }
  return group ?? null;
}

export function creativeWindowRange(window: CreativeWindow, today: string): { from: string; to: string } {
  return { from: window === 'lifetime' ? '0000-01-01' : addDays(today, window === '24h' ? -1 : window === '3d' ? -2 : -6), to: today };
}

export function matchesCreativeAd(ad: CreativeAd, filter: CreativeFilter): boolean {
  return (!filter.market || filter.market === 'all' || ad.market === filter.market)
    && (!filter.owner || filter.owner === 'all' || ad.owner === filter.owner)
    && (filter.live === undefined || filter.live === 'all' || (ad.effectiveStatus === 'ACTIVE') === filter.live);
}

export interface GroupPerformance {
  group: MediaGroup;
  ads: CreativeAd[];
  totals: CreativeTotals;
  firstSpendDay: string | null;
  lastSpendDay: string | null;
  spendDays: number;
  markets: CreativeMarket[];
  owners: CreativeOwner[];
}

/** Select ads before summing their rows; a shared parent can run in both markets. */
export function aggregateCreativeGroups(data: CreativeData, filter: CreativeRange = {}): GroupPerformance[] {
  const indexedGroups = new Map(data.groups.map(group => [group.id, group]));
  const parentById = new Map(data.groups.map(group => [group.id, resolveParent(group.id, indexedGroups)]));
  const adById = new Map(data.ads.map(ad => [ad.id, ad]));
  const allAdsByGroup = new Map<string, CreativeAd[]>();
  for (const ad of data.ads) {
    const parent = parentById.get(ad.mediaGroupId);
    if (!parent) continue;
    const ads = allAdsByGroup.get(parent.id) ?? [];
    ads.push(ad);
    allAdsByGroup.set(parent.id, ads);
  }
  const allRowsByGroup = new Map<string, AdInsight[]>();
  for (const row of data.insights) {
    const ad = adById.get(row.adId), parent = ad && parentById.get(ad.mediaGroupId);
    if (!parent) continue;
    const rows = allRowsByGroup.get(parent.id) ?? [];
    rows.push(row);
    allRowsByGroup.set(parent.id, rows);
  }
  return data.groups.filter(group => !group.mergedIntoId
    && (!filter.kind || filter.kind === 'all' || filter.kind === group.kind)).flatMap(group => {
    const allAds = allAdsByGroup.get(group.id) ?? [];
    const ads = allAds.filter(ad => matchesCreativeAd(ad, filter));
    if (!ads.length && (allAds.length > 0 || filter.market && filter.market !== 'all'
      || filter.owner && filter.owner !== 'all' || typeof filter.live === 'boolean')) return [];
    const ids = new Set(ads.map(ad => ad.id));
    const historical = (allRowsByGroup.get(group.id) ?? []).filter(row => !filter.to || row.day <= filter.to);
    const selected = historical.filter(row => ids.has(row.adId) && (!filter.from || row.day >= filter.from));
    // Cohort age belongs to the parent, not the currently selected market or ad.
    const firstDays = [...allAds.flatMap(ad => ad.firstSpendDay && (!filter.to || ad.firstSpendDay <= filter.to) ? [ad.firstSpendDay] : []),
      ...historical.filter(row => row.spend > 0).map(row => row.day)].sort();
    const selectedSpendDays = [...new Set(selected.filter(row => row.spend > 0).map(row => row.day))].sort();
    return [{ group, ads, totals: creativeTotals(selected,group.kind), firstSpendDay: firstDays[0] ?? null,
      lastSpendDay: selectedSpendDays.at(-1) ?? null, spendDays: selectedSpendDays.length,
      markets: [...new Set(ads.map(ad => ad.market))].sort(), owners: [...new Set(ads.map(ad => ad.owner))].sort() }];
  });
}

export type CreativeRankingSettings = Pick<Settings, 'creativeDefaultWindow' | 'creativeSpendFloorGbp' | 'creativePurchaseMinimum'>;
export function topCreatives(data: CreativeData, settings: CreativeRankingSettings,
  options: CreativeFilter & { today: string; window?: Exclude<CreativeWindow, 'lifetime'> }) {
  const window = options.window ?? settings.creativeDefaultWindow;
  const range = creativeWindowRange(window, options.today);
  const all = aggregateCreativeGroups(data, { ...options, ...range });
  const eligible = all.filter(row => row.totals.spend > 0 && row.totals.spend >= settings.creativeSpendFloorGbp
    && row.totals.purchases >= settings.creativePurchaseMinimum);
  const ranked = eligible.sort((a, b) => (b.totals.roas ?? 0) - (a.totals.roas ?? 0)
    || b.totals.purchases - a.totals.purchases
    || (a.totals.costPerPurchase ?? Infinity) - (b.totals.costPerPurchase ?? Infinity)
    || a.group.id.localeCompare(b.group.id));
  const underFloor = eligible.length === 0;
  const groups = (underFloor ? all.sort((a, b) => b.totals.spend - a.totals.spend || a.group.id.localeCompare(b.group.id)) : ranked).slice(0, 3);
  const duration = window === '24h' ? 'yesterday and today so far' : `${window === '3d' ? 3 : 7} days`;
  const floor = formatPounds(settings.creativeSpendFloorGbp, value => formatNumber(value));
  const minimum = `${formatNumber(settings.creativePurchaseMinimum)} purchases (Meta says)`;
  const message = !all.length ? 'No creative media has been read yet.' : underFloor
    ? `No ads meet ${floor} spend and ${minimum} in ${duration} · top spenders shown under the floor`
    : eligible.length < 3 ? `${eligible.length} ${eligible.length === 1 ? 'ad' : 'ads'} over ${floor} in ${duration} with at least ${minimum}` : '';
  const unplacedAds = data.ads.filter(ad => ad.market === 'unknown' && matchesCreativeAd(ad, { ...options, market: 'all' })).length;
  const unplacedMessage = options.market && options.market !== 'all' && unplacedAds
    ? `${unplacedAds} ${unplacedAds === 1 ? 'ad' : 'ads'} without a market ${unplacedAds === 1 ? 'is' : 'are'} under All` : '';
  return { groups, eligibleCount: eligible.length, underFloor, message, unplacedAds, unplacedMessage, ...range,
    windowNote: window === '24h' ? 'Last complete UK day plus today so far.' : `Last ${window === '3d' ? 3 : 7} UK days, including today so far.` };
}
