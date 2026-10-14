import assert from 'node:assert/strict';
import test from 'node:test';
import { ukToday } from '../src/hero-range.js';
import { aggregateCreativeGroups, creativeTotals, creativeWindowRange, parentGroup, topCreatives } from '../src/creatives/ranking.js';
import { creativeAd, creativeData, creativeGroup, creativeInsight } from './helpers/creatives.js';

const settings = { creativeDefaultWindow: '3d' as const, creativeSpendFloorGbp: 50, creativePurchaseMinimum: 2 };
const today = '2026-10-13';

test('creative ranking uses summed purchase ROAS, inclusive spend/purchase floors and tie breakers', () => {
  const data = creativeData(['high', 'more', 'cheaper', 'dearer', 'small', 'few']);
  data.insights = [
    creativeInsight('high', { spend: 50, purchases: 2, purchaseValue: 300 }),
    creativeInsight('more', { spend: 100, purchases: 5, purchaseValue: 400 }),
    creativeInsight('cheaper', { spend: 60, purchases: 3, purchaseValue: 240 }),
    creativeInsight('dearer', { spend: 75, purchases: 3, purchaseValue: 300 }),
    creativeInsight('small', { spend: 49.99, purchases: 20, purchaseValue: 5000 }),
    creativeInsight('few', { spend: 500, purchases: 1, purchaseValue: 10000 }),
  ];
  const result = topCreatives(data, settings, { today });
  assert.deepEqual(result.groups.map(row => row.group.id), ['high', 'more', 'cheaper']);
  assert.equal(result.eligibleCount, 4);
  assert.equal(result.underFloor, false);
  assert.equal(result.message, '');
});

test('two qualifying creatives explain the spend floor and purchase minimum in one line', () => {
  const result = topCreatives(creativeData(['one', 'two']), settings, { today });
  assert.equal(result.groups.length, 2);
  assert.match(result.message, /^2 ads over £50 in 3 days/);
  assert.match(result.message, /at least 2 purchases \(Meta says\)/);
});

test('nothing qualifying falls back to top spenders even when purchase minimum caused failure', () => {
  const data = creativeData(['one', 'two', 'three', 'four']);
  data.insights = [
    creativeInsight('one', { spend: 60, purchases: 1 }), creativeInsight('two', { spend: 10, purchases: 0 }),
    creativeInsight('three', { spend: 40, purchases: 0 }), creativeInsight('four', { spend: 30, purchases: 0 }),
  ];
  const result = topCreatives(data, settings, { today });
  assert.equal(result.underFloor, true);
  assert.deepEqual(result.groups.map(row => row.group.id), ['one', 'three', 'four']);
  assert.match(result.message, /£50 spend and 2 purchases \(Meta says\).*under the floor/);
});

test('a catalogue without spend still supplies pictures; a genuinely empty catalogue explains pending data', () => {
  const data = creativeData(['one', 'two', 'three']);
  data.insights = [];
  assert.equal(topCreatives(data, settings, { today }).groups.length, 3);
  assert.match(topCreatives(creativeData([]), settings, { today }).message, /No creative media has been read yet/);
});

test('market and owner filters apply before parent totals; unknown market stays under All', () => {
  const data = creativeData(['parent']);
  data.ads.push(creativeAd('us', 'parent', { market: 'us', owner: 'freelancer' }), creativeAd('none', 'parent', { market: 'unknown' }));
  data.insights.push(creativeInsight('us', { spend: 90, purchases: 6, purchaseValue: 450 }), creativeInsight('none', { spend: 20 }));
  assert.equal(topCreatives(data, settings, { today }).groups[0]!.totals.spend, 170);
  const uk = topCreatives(data, settings, { today, market: 'uk' });
  assert.equal(uk.groups[0]!.totals.spend, 60);
  assert.equal(uk.unplacedAds, 1);
  assert.equal(uk.unplacedMessage, '1 ad without a market is under All');
  const ours = topCreatives(data, settings, { today, owner: 'ours' });
  assert.equal(ours.groups[0]!.totals.spend, 80);
  assert.deepEqual(topCreatives(data, settings, { today, owner: 'ours', market: 'us' }).groups, []);
});

test('merged grandchildren aggregate under one parent and keep earliest spend across filters', () => {
  const data = creativeData(['parent']);
  data.groups.push(creativeGroup('child', { mergedIntoId: 'parent' }), creativeGroup('grandchild', { mergedIntoId: 'child' }));
  data.ads.push(creativeAd('child', 'child', { market: 'us', firstSpendDay: '2026-08-01' }), creativeAd('grandchild', 'grandchild'));
  data.insights.push(creativeInsight('child'), creativeInsight('grandchild'));
  const [parent] = aggregateCreativeGroups(data, { market: 'uk' });
  assert.equal(aggregateCreativeGroups(data).length, 1);
  assert.equal(parent!.totals.spend, 120);
  assert.equal(parent!.firstSpendDay, '2026-08-01');
  assert.deepEqual(parent!.ads.map(ad => ad.id), ['parent', 'grandchild']);
  assert.equal(parentGroup('grandchild', data.groups)!.id, 'parent');
});

test('broken and cyclic merge references are excluded safely', () => {
  const groups = [creativeGroup('one', { mergedIntoId: 'two' }), creativeGroup('two', { mergedIntoId: 'one' })];
  assert.equal(parentGroup('one', groups), null);
  assert.equal(parentGroup('missing', groups), null);
  assert.equal(parentGroup('one', [creativeGroup('one', { mergedIntoId: 'missing' })]), null);
});

test('window boundaries include UK today through the clock change and 24h includes yesterday', () => {
  assert.deepEqual(creativeWindowRange('24h', '2026-10-25'), { from: '2026-10-24', to: '2026-10-25' });
  assert.deepEqual(creativeWindowRange('3d', today), { from: '2026-10-11', to: today });
  assert.deepEqual(creativeWindowRange('7d', today), { from: '2026-10-07', to: today });
  assert.equal(ukToday(new Date('2026-10-24T23:30:00Z')), '2026-10-25');
  const data = creativeData(['one']);
  data.insights = ['2026-10-10', '2026-10-11', '2026-10-12', today, '2026-10-14'].map(day => creativeInsight('one', { day }));
  assert.equal(topCreatives(data, settings, { today, window: '24h' }).groups[0]!.totals.spend, 120);
  assert.equal(topCreatives(data, settings, { today }).groups[0]!.totals.spend, 180);
  assert.equal(aggregateCreativeGroups(data, creativeWindowRange('lifetime', today))[0]!.totals.spend, 240);
  assert.match(topCreatives(data, settings, { today, window: '24h' }).windowNote, /Last complete UK day plus today so far/);
});

test('sheet rates use weighted totals and expose a two-second hook fallback and reach caveat', () => {
  const totals = creativeTotals([
    creativeInsight('one', { spend: 10, impressions: 100, reach: 50, linkClicks: 20, purchases: 1, purchaseValue: 20,
      plays: 80, threeSecondPlays: 50, thruPlays: 25, plays100: 20, addsToCart: 4, averagePlayTime: 2 }),
    creativeInsight('two', { spend: 90, impressions: 900, reach: 450, linkClicks: 30, purchases: 4, purchaseValue: 180,
      plays: 320, threeSecondPlays: 150, thruPlays: 25, plays100: 20, addsToCart: 6, averagePlayTime: 7,
      threeSecondSource: 'video_continuous_2_sec_watched_actions' }),
  ]);
  assert.equal(totals.roas, 2);
  assert.equal(totals.costPerPurchase, 20);
  assert.equal(totals.ctr, .05);
  assert.equal(totals.hookRate, .2);
  assert.equal(totals.holdRate, .25);
  assert.equal(totals.watchThroughRate, .1);
  assert.equal(totals.addToCartRate, .2);
  assert.equal(totals.averagePlayTime, 6);
  assert.equal(totals.dailyReachFrequencyProxy, 2);
  assert.equal(totals.hookSource, 'mixed');
  assert.match(totals.frequencyNote, /summed daily ad reach/);
  const empty = creativeTotals([]);
  for (const key of ['roas', 'costPerPurchase', 'ctr', 'hookRate', 'holdRate', 'watchThroughRate', 'addToCartRate', 'dailyReachFrequencyProxy'] as const)
    assert.equal(empty[key], null);
});

test('gallery type and effective-live filters use matching ads while keeping parent identity', () => {
  const data = creativeData(['video', 'image']);
  data.groups[1]!.kind = 'image';
  data.ads[0]!.effectiveStatus = 'CAMPAIGN_PAUSED';
  assert.deepEqual(aggregateCreativeGroups(data, { live: true }).map(row => row.group.id), ['image']);
  assert.deepEqual(aggregateCreativeGroups(data, { live: false }).map(row => row.group.id), ['video']);
  assert.deepEqual(aggregateCreativeGroups(data, { kind: 'image' }).map(row => row.group.id), ['image']);
});
