import type { AdInsight, CreativeAd, CreativeData, MediaGroup } from '../../src/creatives/model.js';

// Entirely invented ads and figures; no source account is used in these tests.
export function creativeGroup(id: string, values: Partial<MediaGroup> = {}): MediaGroup {
  return { id, kind: 'video', key: `invented-${id}`, title: `Invented clip ${id}`, lengthSeconds: 12,
    width: 600, height: 800, firstSeen: '2026-10-01T09:00:00Z', mergedIntoId: null,
    alternates: [], thumbnailUrl: `/media/${id}`, ...values };
}

export function creativeAd(id: string, mediaGroupId: string, values: Partial<CreativeAd> = {}): CreativeAd {
  return { id, mediaGroupId, accountId: 'invented-account', name: `Invented ad ${id}`, status: 'ACTIVE', effectiveStatus: 'ACTIVE',
    createdAt: '2026-10-01T09:00:00Z', adSetId: `invented-set-${id}`, adSetName: 'Invented UK set',
    campaignId: 'invented-campaign', campaignName: 'Invented UK campaign', owner: 'ours', market: 'uk',
    creativeId: `invented-creative-${id}`, creativeType: 'video', body: 'An invented slab-kit scene.',
    title: 'Invented kit', callToAction: 'SHOP_NOW', linkUrl: null, utmContent: null,
    firstSpendDay: null, lastSeen: '2026-10-13T09:00:00Z', facebookUrl: null, instagramUrl: null,
    objectStoryId: null, instagramMediaId: null, ...values };
}

export function creativeInsight(adId: string, values: Partial<AdInsight> = {}): AdInsight {
  return { adId, adSetId: `invented-set-${adId}`, day: '2026-10-13', spend: 60, impressions: 1000, reach: 500,
    frequency: 2, linkClicks: 100, threeSecondPlays: 400, threeSecondSource: 'video_view', plays: 500,
    thruPlays: 200, plays25: 350, plays50: 250, plays75: 200, plays100: 150, averagePlayTime: 4,
    addsToCart: 20, purchases: 3, purchaseValue: 180, ...values };
}

export function creativeData(ids: string[]): CreativeData {
  return { mode: 'sample', groups: ids.map(id => creativeGroup(id)), ads: ids.map(id => creativeAd(id, id)),
    insights: ids.map(id => creativeInsight(id)) };
}
