import { creativeLiftLabel } from './lift-phrasing.js';
import { attributesForKind } from './attributes.js';
import { creativeLiftWindows } from './lifts.js';
import { appConfig } from '../config.js';
import type { Settings } from '../settings.js';
import { ukToday } from '../hero-range.js';
import { metaSpendMarket } from '../ad-spend/placement.js';
import type { AdInsight, CatalogueEntry, CreativeAd, CreativeData, CreativeMarket, CreativeOwner, MediaGroup } from './model.js';
import { buildFrequencyRequests } from './frequency.js';
import { parentGroup } from './ranking.js';
import { deterministicAttributeValues, type AttributeRow, type AttributeSource } from './attributes.js';

/** Every name, picture, identifier and figure in this module is invented. */
export const SAMPLE_CREATIVE_ACCOUNT = 'sample-meta-account';

function dayBefore(today: string, days: number): string {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function sampleCreativePicture(title: string, kind: 'image' | 'video', colour = '#ad7feb'): string {
  const safe = title.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#2b1859"/><stop offset="1" stop-color="${colour}"/></linearGradient></defs><rect width="600" height="800" fill="url(#bg)"/><circle cx="470" cy="145" r="115" fill="#ffffff" fill-opacity=".09"/><g transform="translate(95 150) rotate(-7 200 225)"><rect width="280" height="380" x="10" y="25" rx="26" fill="#e5e0fd" fill-opacity=".3" stroke="#fff" stroke-width="5"/><rect width="240" height="300" x="30" y="70" rx="15" fill="#392254"/><path d="M75 295 150 130l80 165z" fill="${colour}"/><circle cx="150" cy="217" r="37" fill="#ffd898"/><rect x="62" y="385" width="176" height="8" rx="4" fill="#fff"/></g>${kind === 'video' ? '<circle cx="465" cy="555" r="49" fill="#fff" fill-opacity=".2"/><path d="m451 528 38 27-38 27z" fill="#fff"/>' : ''}<text x="36" y="657" fill="#fff" font-family="sans-serif" font-size="28" font-weight="bold">${safe}</text><text x="36" y="702" fill="#fff" fill-opacity=".8" font-family="sans-serif" font-size="22">Invented picture · sample data</text></svg>`)}`;
}

type Example = { id: string; title: string; kind: 'video' | 'image'; age: number; spend: number; purchases: number; value: number; market: CreativeMarket; owner: CreativeOwner; seconds: number | null; colour: string; faded?: boolean };
const examples: readonly Example[] = [
  { id: 'sample-video-1', title: 'Unboxing clip 4', kind: 'video', age: 4, spend: 24, purchases: 3, value: 102, market: 'uk', owner: 'ours', seconds: 12, colour: '#9964dd' },
  { id: 'sample-video-2', title: 'Kitchen table reveal', kind: 'video', age: 20, spend: 22, purchases: 2, value: 77, market: 'us', owner: 'freelancer', seconds: 22, colour: '#4a88c7', faded: true },
  { id: 'sample-video-3', title: 'Colour card challenge', kind: 'video', age: 8, spend: 20, purchases: 2, value: 64, market: 'unknown', owner: 'unassigned', seconds: 35, colour: '#b7608e' },
  { id: 'sample-image-1', title: 'Three slabs flat lay', kind: 'image', age: 3, spend: 18, purchases: 1, value: 45, market: 'uk', owner: 'ours', seconds: null, colour: '#5979bd' },
  { id: 'sample-image-2', title: 'Invented gift guide', kind: 'image', age: 16, spend: 19, purchases: 1, value: 42, market: 'us', owner: 'freelancer', seconds: null, colour: '#af7182' },
  { id: 'sample-image-3', title: 'Sample card montage', kind: 'image', age: 2, spend: 4, purchases: 0, value: 0, market: 'unknown', owner: 'unassigned', seconds: null, colour: '#6b699d' },
];

export function sampleCreativeData(settings: Pick<Settings, 'metaOwners'>, now = new Date(appConfig.shopify.sampleNow)): CreativeData {
  const today = ukToday(now);
  const groups: MediaGroup[] = [];
  const ads: CreativeAd[] = [];
  const insights: AdInsight[] = [];
  for (const [index, example] of examples.entries()) {
    const firstDay = dayBefore(today, example.age);
    const firstSeen = `${firstDay}T08:00:00Z`;
    groups.push({ id: example.id, kind: example.kind, key: `invented-${example.id}`, title: example.title, lengthSeconds: example.seconds,
      width: 600, height: 800, firstSeen, mergedIntoId: null, alternates: [], thumbnailUrl: sampleCreativePicture(example.title, example.kind, example.colour) });
    const campaignId = example.owner === 'freelancer' ? '900000000604' : example.owner === 'unassigned' ? '900000000603' : '900000000601';
    const owner = settings.metaOwners.find(rule => rule.campaignId === campaignId)?.owner ?? example.owner;
    const campaignName = example.owner === 'freelancer' ? 'Invented Willow discovery US' : example.owner === 'unassigned' ? 'Invented Lumen launch' : 'Invented Aurora discovery';
    const adSetName = `Invented ${example.market.toUpperCase()} creative set`;
    const market = metaSpendMarket(campaignName, adSetName, owner);
    const ad: CreativeAd = { id: `sample-ad-${index + 1}`, accountId: SAMPLE_CREATIVE_ACCOUNT,
      name: `Invented ${example.title} ad`, status: 'ACTIVE', effectiveStatus: 'ACTIVE', createdAt: firstSeen,
      adSetId: `sample-adset-${example.owner}-${example.market}`, adSetName,
      campaignId, campaignName, owner, market,
      creativeId: `sample-creative-${index + 1}`, creativeType: example.kind, mediaGroupId: example.id,
      body: 'Invented ad copy: turn an imaginary card into a colourful keepsake. Sample data only.', title: example.title,
      callToAction: 'SHOP_NOW', linkUrl: null, utmContent: `invented-creative-${index + 1}`, firstSpendDay: firstDay, lastSeen: now.toISOString(),
      facebookUrl: null, instagramUrl: null, objectStoryId: null, instagramMediaId: null };
    ads.push(ad);
    for (let daysAgo = example.age; daysAgo >= 0; daysAgo -= 1) {
      const video = example.kind === 'video';
      const fading = example.faded && daysAgo < 7;
      insights.push({ adId: ad.id, adSetId: ad.adSetId, day: dayBefore(today, daysAgo), spend: example.spend,
        impressions: 680, reach: fading ? 200 : 400, frequency: fading ? 3.4 : 1.7, linkClicks: fading ? 12 : 27,
        threeSecondPlays: video ? 204 : 0, threeSecondSource: video ? 'video_view' : 'none',
        plays: video ? 340 : 0, thruPlays: video ? 102 : 0, plays25: video ? 160 : 0,
        plays50: video ? 120 : 0, plays75: video ? 90 : 0, plays100: video ? 70 : 0,
        averagePlayTime: video ? 8.2 : 0, addsToCart: example.purchases + 2, purchases: example.purchases, purchaseValue: example.value });
    }
  }
  // A second ad for the same parent demonstrates that hit rate counts media groups.
  const parent = groups[0]!;
  const firstAd = ads[0]!;
  groups.push({ ...parent, id: 'sample-video-1-crop', key: 'invented-video-crop-1', title: `Auto_Cropped_AR_4_X_5_DCO_${parent.title}`, mergedIntoId: parent.id });
  const cropAd = { ...firstAd, id: 'sample-ad-crop-1', name: 'Invented unboxing crop ad', creativeId: 'sample-creative-crop-1', mediaGroupId: 'sample-video-1-crop' };
  ads.push(cropAd);
  for (const row of insights.filter(row => row.adId === firstAd.id)) {
    row.spend /= 2; row.purchases /= 2; row.purchaseValue /= 2;
    insights.push({ ...row, adId: cropAd.id });
  }
  const data: CreativeData = { mode: 'sample', ads, groups, insights };
  data.frequencyReads = buildFrequencyRequests(data, today).map(request => ({ ...request,
    frequency: request.adIds.includes('sample-ad-2') ? 3.4 : 1.7 }));
  return data;
}

/** The sample catalogue has one complete page, with the same invented pictures as the UI. */
export async function* readSampleCreativeCatalogue(settings: Pick<Settings, 'metaOwners'>, now = new Date(appConfig.shopify.sampleNow)): AsyncIterable<CatalogueEntry[]> {
  const sample = sampleCreativeData(settings, now);
  yield sample.ads.map(ad => {
    const group = sample.groups.find(group => group.id === ad.mediaGroupId)!;
    const bytes = Buffer.from(decodeURIComponent(group.thumbnailUrl.slice(group.thumbnailUrl.indexOf(',') + 1)), 'utf8');
    return { ad, media: { ...group, id: group.id, thumbnail: bytes, poster: group.kind === 'video' ? bytes : null, frames: [] } };
  });
}

/** Fixed invented answers: only Colour card challenge is both over the floor and untagged. */
const sampleAttributeAnswers: readonly {
  groupId: string;
  attributes: readonly { key: string; value: string; source: AttributeSource; confidence?: number; reason?: string }[];
}[] = [
  { groupId: 'sample-video-1', attributes: [
    { key: 'hookType', value: 'unboxing', source: 'will' },
    { key: 'slabEarly', value: 'yes', source: 'will' },
    { key: 'slabsShown', value: '3-plus', source: 'will' },
    { key: 'whoSpeaks', value: 'nobody', source: 'will' },
    { key: 'slabEarly', value: 'no', source: 'model', confidence: 0.91, reason: 'Invented answer overridden by the sample tag.' },
    { key: 'productEarly', value: 'yes', source: 'model', confidence: 0.94, reason: 'Invented product-first example.' },
  ] },
  { groupId: 'sample-video-2', attributes: [
    { key: 'setting', value: 'kitchen-table', source: 'will' },
    { key: 'slabEarly', value: 'yes', source: 'model', confidence: 0.92, reason: 'Invented early-slab example.' },
  ] },
  { groupId: 'sample-video-3', attributes: [
    { key: 'hookType', value: 'reveal', source: 'model', confidence: 0.4, reason: 'Invented low-confidence example for the tagging queue.' },
    { key: 'productEarly', value: 'yes', source: 'model', confidence: 0.92, reason: 'Invented product-first example.' },
  ] },
  { groupId: 'sample-image-1', attributes: [
    { key: 'format', value: 'unboxing-flat-lay', source: 'will' },
    { key: 'productInShot', value: 'yes', source: 'model', confidence: 0.96, reason: 'Invented product picture.' },
  ] },
  { groupId: 'sample-image-2', attributes: [
    { key: 'format', value: 'gift-guide', source: 'will' },
  ] },
];

/** Uses the same canonical rows for pure sample rendering and the isolated sample seed. */
export function sampleCreativeAttributeRows(data: CreativeData): AttributeRow[] {
  const rows: AttributeRow[] = [];
  for (const group of data.groups.filter(group => !group.mergedIntoId)) {
    const values = deterministicAttributeValues(group, data.ads.filter(ad => parentGroup(ad.mediaGroupId, data.groups)?.id === group.id));
    for (const [key, value] of Object.entries(values)) rows.push({ groupId: group.id, key, source: 'meta', value: { value } });
    for (const attribute of sampleAttributeAnswers.find(example => example.groupId === group.id)?.attributes ?? []) {
      rows.push({ groupId: group.id, key: attribute.key, source: attribute.source,
        value: attribute.source === 'model'
          ? { value: attribute.value, confidence: attribute.confidence, reason: attribute.reason }
          : { value: attribute.value } });
    }
  }
  return rows;
}

const sampleLiftExamples = [
  { kind: 'video', attributeKey: 'slabEarly', label: 'slab in the first 3 seconds', value: 'yes', confidence: 'Strong',
    withCppGbp: 11, withoutCppGbp: 18, withGroupCount: 3, withoutGroupCount: 3, withSpendGbp: 264, withoutSpendGbp: 324 },
  { kind: 'image', attributeKey: 'format', label: 'unboxing flat lay', value: 'unboxing-flat-lay', confidence: 'Likely',
    withCppGbp: 13, withoutCppGbp: 20, withGroupCount: 3, withoutGroupCount: 3, withSpendGbp: 234, withoutSpendGbp: 300 },
] as const;

/** Fixed invented lift illustrations; their groups/figures are not calculated from this small gallery. */
export function sampleCreativeStoredLifts(now = new Date(appConfig.shopify.sampleNow)): import('./lifts.js').CreativeLift[] {
  const today = ukToday(now);
  return creativeLiftWindows.flatMap(windowDays => (['all', 'uk', 'us'] as const).flatMap(market => sampleLiftExamples.map(lift => {
    const video = lift.kind === 'video';
    const side = (withValue: boolean) => {
      const spend = withValue ? lift.withSpendGbp : lift.withoutSpendGbp;
      const costPerPurchase = withValue ? lift.withCppGbp : lift.withoutCppGbp;
      const purchases = spend / costPerPurchase;
      const roas = video ? (withValue ? 4 : 2) : (withValue ? 3 : 1.5);
      return { groupCount: withValue ? lift.withGroupCount : lift.withoutGroupCount, spend, purchases,
        purchaseValue: spend * roas, costPerPurchase, roas, addToCartRate: withValue ? 0.15 : 0.08,
        hookRate: video ? (withValue ? 0.4 : 0.3) : null, holdRate: video ? (withValue ? 0.5 : 0.4) : null };
    };
    return { id: `invented-brief-${windowDays}-${market}-${lift.kind}`, windowDays, market, kind: lift.kind, attributeKey: lift.attributeKey, value: lift.value,
      attributeLabel: video ? 'Slab in the first 3 seconds' : 'Format', valueLabel: video ? 'yes' : 'unboxing flat lay',
      label: creativeLiftLabel(attributesForKind(lift.kind).find(attribute => attribute.key === lift.attributeKey)!, lift.value), confidence: lift.confidence, metrics: { with: side(true), without: side(false),
        share: video ? 0.975 : 0.9, from: dayBefore(today, windowDays - 1), to: today,
        withGroupIds: video ? ['sample-video-1', 'sample-video-2'] : ['sample-image-1', 'sample-image-2'],
        exampleGroupIds: video ? ['sample-video-1', 'sample-video-2'] : ['sample-image-1', 'sample-image-2'] },
      computedAt: now.toISOString() };
  })));
}
