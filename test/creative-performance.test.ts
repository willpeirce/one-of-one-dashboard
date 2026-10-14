import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays } from '../src/hero-range.js';
import { creativePerformance } from '../src/creatives/performance.js';
import { creativeAd, creativeData, creativeGroup, creativeInsight } from './helpers/creatives.js';

const settings = { cppUkTargetGbp: 20, cppUsTargetGbp: 30, creativeWeeklyTarget: 7,
  creativeHitWinnerSpendGbp: 100, creativeHitKilledSpendGbp: 75, creativeHitKilledTargetMultiplier: 1.5,
  creativeFadeFrequency: 3, creativeFadeCtrDropPercent: 40 };
const today = '2026-10-13';

test('hit rate counts parent groups and lifetime performance in the first-spend 30-day cohort', () => {
  const data = creativeData(['winner', 'killed', 'testing', 'old']);
  data.groups.push(creativeGroup('copy', { mergedIntoId: 'winner' }));
  data.ads.push(creativeAd('copy', 'copy'));
  data.ads.find(ad => ad.id === 'old')!.firstSpendDay = '2026-09-13';
  data.insights = [
    creativeInsight('winner', { spend: 50, purchases: 3 }), creativeInsight('copy', { spend: 50, purchases: 3 }),
    creativeInsight('killed', { spend: 75, purchases: 2 }), creativeInsight('testing', { spend: 30, purchases: 4 }),
    creativeInsight('old', { spend: 200, purchases: 20 }),
  ];
  const result = creativePerformance(data, settings, { today });
  assert.deepEqual(result.hitRate, { winners: 1, killed: 1, testing: 1, total: 3, label: 'hit rate 1 of 3' });
  assert.equal(result.newThisWeek.count, 3);
  assert.equal(result.label, 'New this week 3 of 7 · hit rate 1 of 3');
});

test('new-this-week uses first spend, seven inclusive calendar dates and the configurable target', () => {
  const data = creativeData(['edge', 'before', 'future', 'unspent']);
  data.ads[0]!.firstSpendDay = '2026-10-07';
  data.ads[1]!.firstSpendDay = '2026-10-06';
  data.ads[2]!.firstSpendDay = '2026-10-14';
  data.insights = [creativeInsight('edge'), creativeInsight('before'), creativeInsight('future', { day: '2026-10-14' })];
  const result = creativePerformance(data, { ...settings, creativeWeeklyTarget: 9 }, { today });
  assert.deepEqual(result.newThisWeek, { count: 1, target: 9, label: 'New this week 1 of 9' });
  assert.equal(result.hitRate.total, 2);
});

test('cohort does not become new when another market or a newly merged ad starts spending', () => {
  const data = creativeData(['parent']);
  data.ads[0]!.firstSpendDay = '2026-08-01';
  data.ads[0]!.market = 'us';
  data.groups.push(creativeGroup('copy', { mergedIntoId: 'parent' }));
  data.ads.push(creativeAd('copy', 'copy', { firstSpendDay: today }));
  data.insights.push(creativeInsight('copy', { spend: 120, purchases: 12 }));
  const result = creativePerformance(data, settings, { today, market: 'uk' });
  assert.equal(result.hitRate.total, 0);
  assert.equal(result.newThisWeek.count, 0);
});

test('hit thresholds use strict CPP boundaries, inclusive spend, zero purchases and unknown-market safeguards', () => {
  const data = creativeData(['winner-edge', 'killed-edge', 'no-purchases', 'unknown', 'below-spend']);
  data.insights = [
    creativeInsight('winner-edge', { spend: 100, purchases: 5 }),
    creativeInsight('killed-edge', { spend: 90, purchases: 3 }),
    creativeInsight('no-purchases', { spend: 75, purchases: 0 }),
    creativeInsight('unknown', { spend: 100, purchases: 100 }),
    creativeInsight('below-spend', { spend: 74.99, purchases: 0 }),
  ];
  data.ads.find(ad => ad.id === 'unknown')!.market = 'unknown';
  const result = creativePerformance(data, settings, { today });
  assert.equal(result.hitRate.winners, 0);
  assert.equal(result.hitRate.killed, 1);
  assert.equal(result.hitRate.testing, 4);
});

test('mixed-market parent compares its CPP with purchase-weighted market targets', () => {
  const data = creativeData(['parent']);
  data.ads.push(creativeAd('us', 'parent', { market: 'us' }));
  data.insights = [creativeInsight('parent', { spend: 50, purchases: 2 }), creativeInsight('us', { spend: 50, purchases: 3 })];
  assert.equal(creativePerformance(data, settings, { today }).hitRate.winners, 1);
  // Selecting UK must not borrow the US purchases or spending to reach £100.
  assert.equal(creativePerformance(data, settings, { today, market: 'uk' }).hitRate.winners, 0);
  data.ads.push(creativeAd('unknown', 'parent', { market: 'unknown' }));
  data.insights.push(creativeInsight('unknown', { spend: 0, purchases: 10 }));
  assert.equal(creativePerformance(data, settings, { today }).hitRate.testing, 1);
});

function fadingData(frequency: number, recentClicks = 100) {
  const data = creativeData(['clip']);
  data.ads[0]!.firstSpendDay = '2026-09-20';
  data.insights = Array.from({ length: 24 }, (_, index) => {
    const day = addDays('2026-09-20', index);
    return creativeInsight('clip', { day, spend: 10, impressions: 1000, reach: 1000 / frequency,
      frequency, linkClicks: day >= '2026-10-07' ? recentClicks : 100 });
  });
  data.frequencyReads = [{ adIds: ['clip'], from: '2026-10-07', to: today, frequency }];
  return data;
}

test('fading frequency fires above 3.0 but not at or below it using Meta deduplicated reach', () => {
  const result = creativePerformance(fadingData(3.1), settings, { today });
  assert.equal(result.fading.length, 1);
  assert.match(result.fading[0]!.reasons[0]!, /frequency 3.1, seen too often/);
  assert.doesNotMatch(result.fading[0]!.reasons[0]!, /proxy/);
  assert.equal(creativePerformance(fadingData(2.9), settings, { today }).fading.length, 0);
  assert.equal(creativePerformance(fadingData(3), settings, { today }).fading.length, 0);
});

test('fading clicks fire at 40% but not 39% and can report both independent rules', () => {
  const exact = creativePerformance(fadingData(2, 60), settings, { today });
  assert.equal(exact.fading.length, 1);
  assert.deepEqual(exact.fading[0]!.reasons, ['clicks 40% under its first week']);
  assert.equal(creativePerformance(fadingData(2, 61), settings, { today }).fading.length, 0);
  assert.equal(creativePerformance(fadingData(3.1, 52), settings, { today }).fading[0]!.reasons.length, 2);
});

test('fading needs seven distinct spend dates, not seven rows or seven elapsed days', () => {
  const data = fadingData(4);
  data.insights = data.insights.filter(row => row.day >= '2026-10-08');
  data.ads.push(creativeAd('copy', 'clip'));
  data.insights.push(...data.insights.map(row => ({ ...row, adId: 'copy' })));
  data.frequencyReads![0]!.adIds = ['clip', 'copy'];
  assert.equal(creativePerformance(data, settings, { today }).fading.length, 0);
  data.insights.push(creativeInsight('clip', { day: '2026-10-07', spend: 10, impressions: 1000, reach: 250 }));
  assert.equal(creativePerformance(data, settings, { today }).fading.length, 1);
});

test('paused, dormant and zero-spend creatives never fade', () => {
  const paused = fadingData(4);
  paused.ads[0]!.effectiveStatus = 'PAUSED';
  assert.equal(creativePerformance(paused, settings, { today }).fading.length, 0);
  const dormant = fadingData(4);
  dormant.insights = dormant.insights.filter(row => row.day < '2026-10-12');
  assert.equal(creativePerformance(dormant, settings, { today }).fading.length, 0);
  const zero = fadingData(4);
  zero.insights = zero.insights.map(row => ({ ...row, spend: 0 }));
  assert.equal(creativePerformance(zero, settings, { today }).fading.length, 0);
});

test('CTR baseline skips the partial initial day and requires the first full week to finish', () => {
  const data = fadingData(2, 60);
  data.insights[0]!.linkClicks = 0;
  assert.match(creativePerformance(data, settings, { today }).fading[0]!.reasons[0]!, /40%/);
  const early = creativeData(['clip']);
  early.ads[0]!.firstSpendDay = '2026-10-06';
  early.insights = Array.from({ length: 8 }, (_, index) => creativeInsight('clip', {
    day: addDays('2026-10-06', index), spend: 10, linkClicks: index === 0 ? 900 : 1,
  }));
  assert.equal(creativePerformance(early, settings, { today }).fading.length, 0);
  // Frequency can already flag the seventh spend day without a finished CTR baseline.
  early.insights = early.insights.map(row => ({ ...row, reach: 250 }));
  early.frequencyReads = [{ adIds: ['clip'], from: '2026-10-07', to: today, frequency: 4 }];
  assert.equal(creativePerformance(early, settings, { today }).fading[0]!.reasons.length, 1);
});

test('fading uses weighted click rates, market-filtered rows and Settings thresholds', () => {
  const data = fadingData(3.1, 60);
  assert.equal(creativePerformance(data, { ...settings, creativeFadeFrequency: 4, creativeFadeCtrDropPercent: 41 }, { today }).fading.length, 0);
  data.ads[0]!.market = 'us';
  assert.equal(creativePerformance(data, settings, { today, market: 'uk' }).fading.length, 0);
  const weighted = fadingData(2, 100);
  weighted.insights = weighted.insights.map(row => row.day >= '2026-10-07'
    ? { ...row, impressions: 2000, reach: 1000, linkClicks: 120 } : row);
  assert.match(creativePerformance(weighted, settings, { today }).fading[0]!.reasons[0]!, /40%/);
});

test('exact window frequency catches repeated people that a sum of daily reaches misses', () => {
  const data = fadingData(1.7);
  data.mode = 'live';
  data.frequencyReads![0]!.frequency = 3.4;
  const result = creativePerformance(data, settings, { today });
  assert.equal(result.fading[0]!.frequency, 3.4);
  assert.deepEqual(result.fading[0]!.reasons, ['frequency 3.4, seen too often']);
  // No exact read means unavailable: never substitute even a high daily proxy.
  data.frequencyReads = [];
  data.insights = data.insights.map(row => ({ ...row, impressions: 1000, reach: 100 }));
  assert.equal(creativePerformance(data, settings, { today }).fading.length, 0);
});

test('frequency membership respects current market, owner and merge selection; stale windows never trigger fading', () => {
  const data = fadingData(2);
  data.ads.push(creativeAd('us-copy', 'clip', { market: 'us', owner: 'freelancer' }));
  data.insights.push(...data.insights.filter(row => row.adId === 'clip').map(row => ({ ...row, adId: 'us-copy' })));
  data.frequencyReads = [
    { adIds: ['clip', 'us-copy'], from: '2026-10-07', to: today, frequency: 4 },
    { adIds: ['clip'], from: '2026-10-07', to: today, frequency: 2 },
    { adIds: ['us-copy'], from: '2026-10-06', to: '2026-10-12', frequency: 5 },
  ];
  assert.equal(creativePerformance(data, settings, { today }).fading.length, 1);
  assert.equal(creativePerformance(data, settings, { today, market: 'uk' }).fading.length, 0);
  assert.equal(creativePerformance(data, settings, { today, owner: 'ours' }).fading.length, 0);
  assert.equal(creativePerformance(data, settings, { today, market: 'us' }).fading.length, 0);
});
