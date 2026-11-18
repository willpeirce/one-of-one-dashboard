import {createHash} from 'node:crypto';
import type {CreativeAd} from './model.js';
import type {SourceMode} from '../sources.js';
import type {CreativeLibrary, CreativeLibraryGroup, CreativeOverview, CreativeSheet} from './presentation-types.js';

export const CREATIVE_AD_PAGE_SIZE = 50;
export function compactCreativeLibrary(view: CreativeOverview): CreativeLibrary {
  const group = (row: CreativeOverview['groups'][number]): CreativeLibraryGroup => ({
    group: {id: row.group.id, title: row.group.title, kind: row.group.kind, thumbnailUrl: row.group.thumbnailUrl},
    totals: {spend: row.totals.spend, purchases: row.totals.purchases, roas: row.totals.roas, costPerPurchase: row.totals.costPerPurchase},
    markets: row.markets, owners: row.owners,
  });
  return {...view, groups: view.groups.map(group), top: {...view.top, groups: view.top.groups.map(group)}};
}
// Preserve the stored read's order; the version also fences any subsequent reorder.
export const creativeAdsInReadOrder = (ads: readonly CreativeAd[]): CreativeAd[] => [...ads];
/** Content as well as membership is fenced, so a later page never mixes two stored reads. */
export function creativeAdsVersion(mode: SourceMode, account: string, groupId: string, ads: readonly CreativeAd[]): string {
  return createHash('sha256').update(JSON.stringify([mode, account, groupId, ads])).digest('base64url');
}
export function pageCreativeSheet(sheet: CreativeSheet, accountId: string): CreativeSheet {
  const all = creativeAdsInReadOrder(sheet.ads), ads = all.slice(0, CREATIVE_AD_PAGE_SIZE);
  return {...sheet, ads, group: {...sheet.group, ads}, adPage: {total: all.length,
    adSetCount: new Set(all.map(ad => ad.adSetId)).size,
    nextOffset: all.length > ads.length ? ads.length : null,
    version: creativeAdsVersion(sheet.mode, accountId, sheet.group.group.id, all), accountId}};
}
