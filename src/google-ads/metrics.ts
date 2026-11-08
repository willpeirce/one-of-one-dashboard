import type { HeroMarket } from '../dashboard-types.js';
import { spendMarket } from '../ad-spend/placement.js';
import type { GoogleCampaign, GoogleFacts, GoogleJobKind, GoogleNetworkSlice } from './model.js';

export const googleCampaignMarket = (campaign: GoogleCampaign) => spendMarket({
  source: 'google-ads', campaignName: campaign.name, adSetName: null, owner: 'freelancer', targetCountries: campaign.targetCountries,
});
export function googleCampaignIds(facts: GoogleFacts, market: HeroMarket): Set<string> | null {
  return market === 'all' ? null : new Set(facts.campaigns.filter(campaign => googleCampaignMarket(campaign) === market).map(campaign => campaign.id));
}
export function googleCovers(facts: GoogleFacts, kind: GoogleJobKind, from: string, to: string, allowPartialDay = false): boolean {
  const job = facts.jobs.find(row => row.kind === kind), coverage = job?.coverage;
  if (!job?.lastSuccessAt || !coverage || (job.currency ?? facts.currency) !== 'GBP') return false;
  const first = coverage.basis === 'uk' ? coverage.from : coverage.ukFrom;
  const last = coverage.basis === 'uk' ? coverage.to : allowPartialDay ? coverage.ukTo : coverage.completeUkTo;
  return !!first && !!last && first <= from && last >= to;
}
export function googleNetworkTotals(rows: readonly GoogleNetworkSlice[], from: string, to: string) {
  const slices = new Map<string, { campaignId: string; network: string; spendMicros: bigint; valueMicros: bigint }>();
  for (const row of rows) {
    if (row.day < from || row.day > to) continue;
    const key = JSON.stringify([row.campaignId, row.network]);
    const total = slices.get(key) ?? { campaignId: row.campaignId, network: row.network, spendMicros: 0n, valueMicros: 0n };
    total.spendMicros += BigInt(row.spendMicros); total.valueMicros += BigInt(row.conversionValueMicros);
    slices.set(key, total);
  }
  return [...slices.values()];
}
/** Only explicit YouTube network enums count; MIXED and new values keep their own slices. */
export const isYouTubeNetwork = (network: string) => network === 'YOUTUBE_SEARCH' || network === 'YOUTUBE_WATCH';
export function googleNetworkName(network: string): string {
  return ({ SEARCH: 'Search', SEARCH_PARTNERS: 'Search partners', CONTENT: 'Display / content',
    YOUTUBE_SEARCH: 'YouTube search', YOUTUBE_WATCH: 'YouTube watch', MIXED: 'Mixed' } as Record<string, string>)[network] ?? network;
}
