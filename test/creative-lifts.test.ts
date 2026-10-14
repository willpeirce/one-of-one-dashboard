import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings } from '../src/settings.js';
import { sampleCreativeData } from '../src/creatives/sample.js';
import type { CreativeData } from '../src/creatives/model.js';
import type { AttributeRow } from '../src/creatives/attributes.js';
import { bootstrapLiftShare, computeCreativeLifts, creativeLiftStorageId, liftConfidence, readCreativeLifts,
  recomputeCreativeLifts, saveCreativeLifts, type CreativeLift } from '../src/creatives/lifts.js';
import { deriveCreativeLiftPresentation } from '../src/creatives/lift-presentation.js';
import { toggleWillAttribute } from '../src/creatives/attribute-store.js';
import { createTestDatabase } from './helpers/database.js';
import type { Database } from '../src/db.js';
import { saveCatalogue, saveInsights } from '../src/creatives/store.js';

const now = new Date('2026-10-14T12:00:00Z');
const settings = defaultSettings();
const account = 'invented-lift-account';

function fixture(kind: 'video' | 'image' = 'video', withPurchases = [10, 10, 10], withoutPurchases = [2, 2, 2]) {
  const sample = sampleCreativeData(settings, now);
  const data: CreativeData = { mode: 'live', groups: [], ads: [], insights: [] };
  const attributes: AttributeRow[] = [];
  for (const [index, purchases] of [...withPurchases, ...withoutPurchases].entries()) {
    const id = `invented-${kind}-${index}`;
    data.groups.push({ ...sample.groups[0]!, id, key: id, kind, title: `Invented ${kind} ${index}`, mergedIntoId: null });
    data.ads.push({ ...sample.ads[0]!, id: `${id}-ad`, accountId: account, mediaGroupId: id, creativeType: kind });
    data.insights.push({ ...sample.insights[0]!, adId: `${id}-ad`, day: '2026-10-14', spend: 50, purchases,
      purchaseValue: purchases * 30, linkClicks: 100, addsToCart: 10, impressions: 1000, threeSecondPlays: 200, thruPlays: 80 });
    attributes.push({ groupId: id, key: kind === 'video' ? 'hookType' : 'format', source: 'will',
      value: kind === 'video' ? index < withPurchases.length ? 'unboxing' : 'question'
        : index < withPurchases.length ? 'unboxing-flat-lay' : 'gift-guide' });
  }
  return { data, attributes };
}
const firstLift = (): CreativeLift => {
  const { data, attributes } = fixture();
  return computeCreativeLifts(data, attributes, settings, now)[0]!;
};
async function persistFixture(db: Database, data: CreativeData, attributes: AttributeRow[]) {
  await saveCatalogue(db, account, data.ads.map((ad, index) => {
    const group = data.groups.find(group => group.id === ad.mediaGroupId)!;
    return { ad, media: { ...group, lengthSeconds: 10 + index * 2, thumbnail: null, poster: null, frames: [] } };
  }), now);
  await saveInsights(db, account, '2026-10-14', '2026-10-14', data.insights, now);
  for (const row of attributes) await toggleWillAttribute(db, 'live', account, row.groupId, row.key, row.value as string, now);
}

test('bootstrap uses 200 reproducible weighted group resamples and exact confidence thresholds', () => {
  const without = [5, 8, 10].map(purchases => ({ spend: 100, purchases }));
  const score = (purchases: number) => bootstrapLiftShare([purchases, 10, 20].map(purchases => ({ spend: 100, purchases })), without, 42);
  assert.equal(score(8), 0.9);
  assert.equal(score(8), score(8));
  assert.equal(liftConfidence(score(8)), 'Likely');
  assert.equal(liftConfidence(score(10)), 'Strong');
  assert.equal(liftConfidence(score(4)), 'Hint');
  assert.equal(liftConfidence(score(1)), null);
  assert.deepEqual([0.699, 0.7, 0.849, 0.85, 0.949, 0.95].map(liftConfidence), [null, 'Hint', 'Hint', 'Likely', 'Likely', 'Strong']);
  assert.equal(bootstrapLiftShare([{ spend: 1, purchases: 0 }], [{ spend: 100, purchases: 1 }]), 0);
  assert.equal(bootstrapLiftShare([{ spend: 1, purchases: 1 }], [{ spend: 100, purchases: 0 }]), 0);
  assert.equal(bootstrapLiftShare([{ spend: 1, purchases: 0 }], [{ spend: 100, purchases: 0 }]), 0);
  assert.equal(bootstrapLiftShare([{ spend: 10, purchases: 1 }], [{ spend: 10, purchases: 1 }]), 0, 'equal CPP does not hold');
});

test('lifts require each side group and aggregate spend floors and never pool media types', () => {
  const video = fixture(), image = fixture('image');
  const lifts = computeCreativeLifts({ ...video.data, groups: [...video.data.groups, ...image.data.groups],
    ads: [...video.data.ads, ...image.data.ads], insights: [...video.data.insights, ...image.data.insights] },
  [...video.attributes, ...image.attributes], settings, now);
  assert.equal(lifts.length, 2);
  for (const lift of lifts) { assert.equal(lift.metrics.with.groupCount, 3); assert.equal(lift.metrics.with.spend, 150); }
  assert.equal(lifts.find(lift => lift.kind === 'image')!.metrics.with.hookRate, null);
  assert.equal(lifts.find(lift => lift.kind === 'image')!.metrics.with.holdRate, null);
  assert.equal(computeCreativeLifts(video.data, video.attributes, { ...settings, creativeLiftMinimumGroups: 4 }, now).length, 0);
  assert.equal(computeCreativeLifts(video.data, video.attributes, { ...settings, creativeLiftMinimumSpendGbp: 150.01 }, now).length, 0);
  video.data.insights[3]!.spend = 49;
  assert.equal(computeCreativeLifts(video.data, video.attributes, settings, now).length, 0, 'without side floor also applies');
});

test('same parent collects merged-child totals once; weighted rates and examples use summed figures', () => {
  const { data, attributes } = fixture();
  data.groups.push({ ...data.groups[0]!, id: 'invented-crop', mergedIntoId: data.groups[0]!.id });
  data.ads.push({ ...data.ads[0]!, id: 'invented-crop-ad', mediaGroupId: 'invented-crop' });
  data.insights.push({ ...data.insights[0]!, adId: 'invented-crop-ad', spend: 25, purchases: 5, purchaseValue: 200,
    addsToCart: 30, linkClicks: 20, impressions: 100, threeSecondPlays: 90, thruPlays: 70 });
  attributes.push({ groupId: 'invented-crop', key: 'hookType', source: 'will', value: 'question' });
  const lift = computeCreativeLifts(data, attributes, settings, now)[0]!;
  assert.equal(lift.confidence, 'Strong');
  assert.deepEqual(lift.metrics.with, { groupCount: 3, spend: 175, purchases: 35, purchaseValue: 1100,
    costPerPurchase: 5, roas: 1100 / 175, addToCartRate: 60 / 320, hookRate: 690 / 3100, holdRate: 310 / 690 });
  assert.deepEqual(lift.metrics.exampleGroupIds, ['invented-video-0', 'invented-video-1']);
  assert.equal(lift.metrics.without.spend, 150);
});

test('missing and unsure tags belong to neither side and Will overrides restore eligibility', () => {
  const { data, attributes } = fixture();
  attributes[0] = { groupId: data.groups[0]!.id, key: 'hookType', source: 'model', value: { value: 'unboxing', confidence: 0.49 } };
  assert.equal(computeCreativeLifts(data, attributes, settings, now).length, 0);
  attributes.push({ groupId: data.groups[0]!.id, key: 'hookType', source: 'will', value: 'unboxing' });
  assert.equal(computeCreativeLifts(data, attributes, settings, now).length, 1);
  attributes.splice(1, 1);
  assert.equal(computeCreativeLifts(data, attributes, settings, now).length, 0);
});

test('zero-spend parents remain bootstrap candidates and zero-purchase resamples count against confidence', () => {
  const { data, attributes } = fixture('video', [10, 10, 0]);
  data.insights[0]!.spend = 75; data.insights[1]!.spend = 75;
  data.insights = data.insights.filter(row => row.adId !== data.ads[2]!.id);
  const lift = computeCreativeLifts(data, attributes, settings, now)[0]!;
  assert.ok(lift);
  assert.equal(lift.metrics.with.groupCount, 3);
  assert.equal(lift.metrics.with.spend, 150);
  assert.ok(lift.metrics.share < 1 && lift.metrics.share >= 0.7);
  assert.equal(lift.metrics.exampleGroupIds.includes(data.groups[2]!.id), false, 'no-purchase group is not a best example');
});

test('window includes the current UK day across BST and excludes older and future rows', () => {
  const { data, attributes } = fixture();
  const midnight = new Date('2026-06-30T23:30:00Z');
  data.insights.forEach(row => { row.day = '2026-07-01'; });
  data.insights.push({ ...data.insights[0]!, day: '2026-06-01', spend: 9999 }, { ...data.insights[0]!, day: '2026-07-02', spend: 9999 });
  const lift = computeCreativeLifts(data, attributes, settings, midnight)[0]!;
  assert.equal(lift.metrics.from, '2026-06-02'); assert.equal(lift.metrics.to, '2026-07-01');
  assert.equal(lift.metrics.with.spend, 150);
  assert.deepEqual(computeCreativeLifts({ ...data, groups: [...data.groups].reverse(), insights: [...data.insights].reverse() },
    [...attributes].reverse(), settings, midnight), [lift], 'input order does not change bootstrap seed or examples');
});

test('winning lines rank CPP difference while briefs prioritise confidence and derive stable per-kind cards', () => {
  const { data, attributes } = fixture();
  const strong = computeCreativeLifts(data, attributes, settings, now)[0]!;
  const likely: CreativeLift = { ...strong, id: 'invented-second-lift', attributeKey: 'slabEarly', value: 'yes', label: 'slab in the first 3 seconds', confidence: 'Likely',
    metrics: { ...strong.metrics, share: 0.9, without: { ...strong.metrics.without, costPerPurchase: 60 } } };
  const hint: CreativeLift = { ...strong, id: 'invented-hint', confidence: 'Hint', label: 'hint only' };
  const result = deriveCreativeLiftPresentation([strong, likely, hint], data);
  assert.equal(result.winning.video, 'slab in the first 3 seconds (Likely) · hook: unboxing (Strong)');
  assert.equal(result.winning.image, 'Not enough data yet');
  assert.match(result.makeNext.video!.line, /^Next video: hook: unboxing · slab/);
  assert.match(result.makeNext.video!.brief, /Meta says cost per purchase £5.00 with it vs £25.00 without it/);
  assert.match(result.makeNext.video!.brief, /Best examples: Invented video 0; Invented video 1/);
  assert.match(result.makeNext.video!.brief, /correlations, not proof of cause/);
  assert.equal(result.cards.length, 1); assert.equal(result.cards[0]!.picture, data.groups[0]!.thumbnailUrl);
  assert.equal(result.cards[0]!.brief, result.makeNext.video!.brief);
  assert.equal(result.cards[0]!.id, deriveCreativeLiftPresentation([{ ...strong, computedAt: '2027-01-01T00:00:00Z' }], data).cards[0]!.id);
  assert.notEqual(result.cards[0]!.id, deriveCreativeLiftPresentation([{ ...strong, value: 'reveal' }], data).cards[0]!.id);
  assert.equal(deriveCreativeLiftPresentation([hint], data).makeNext.video, undefined);
  assert.equal(deriveCreativeLiftPresentation([likely], data).cards.length, 0);
});

test('stored lifts replace atomically and isolate account and mode; malformed legacy rows do not escape', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const lift = firstLift();
  await saveCreativeLifts(db, account, 'live', [lift]);
  await saveCreativeLifts(db, account, 'sample', [lift]);
  await saveCreativeLifts(db, 'invented-other-account', 'live', [lift]);
  assert.equal((await readCreativeLifts(db, account, 'live'))[0]!.id, creativeLiftStorageId(account, 'live', lift.id));
  await assert.rejects(saveCreativeLifts(db, account, 'live', [lift, lift]), /duplicate key/);
  assert.equal((await readCreativeLifts(db, account, 'live')).length, 1, 'failed insert rolls back the delete');
  await saveCreativeLifts(db, account, 'live', []);
  assert.equal((await readCreativeLifts(db, account, 'live')).length, 0);
  assert.equal((await readCreativeLifts(db, account, 'sample')).length, 1);
  assert.equal((await readCreativeLifts(db, 'invented-other-account', 'live')).length, 1);
  await db.query("UPDATE pulse.attribute_lifts SET metrics='{}' WHERE mode='sample'");
  assert.equal((await readCreativeLifts(db, account, 'sample')).length, 0);
});

test('live recompute after a Will edit removes the old lift and changes its brief; sample illustrations persist', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const { data, attributes } = fixture();
  await persistFixture(db, data, attributes);
  const before = await recomputeCreativeLifts(db, account, data, settings, now);
  assert.equal(before.length, 1);
  assert.ok(deriveCreativeLiftPresentation(before, data).makeNext.video);
  await toggleWillAttribute(db, 'live', account, attributes[0]!.groupId, 'hookType', 'question', now);
  const after = await recomputeCreativeLifts(db, account, data, settings, now);
  assert.equal(after.length, 0);
  assert.equal((await readCreativeLifts(db, account, 'live')).length, 0);
  assert.equal(deriveCreativeLiftPresentation(after, data).makeNext.video, undefined);
  await saveCreativeLifts(db, account, 'sample', before);
  assert.equal((await recomputeCreativeLifts(db, account, { ...data, mode: 'sample' }, settings, now)).length, 1);
});

test('overlapping worker and tag recomputes refresh attributes and insights inside their shared guard', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const { data, attributes } = fixture('video', [10, 10, 10, 10], [2, 2, 2, 2]);
  await persistFixture(db, data, attributes);
  let release!: () => void, entered!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let first = true, liveReads = 0;
  const guardedDb: Database = {
    ...db,
    query: async (sql, values) => {
      if (sql.includes('FROM pulse.ad_insights_daily')) liveReads += 1;
      return db.query(sql, values);
    },
    transaction: async fn => {
      if (first) { first = false; entered(); await pause; }
      return db.transaction(fn);
    },
  };
  const worker = recomputeCreativeLifts(guardedDb, account, data, settings, now);
  await started;
  try {
    await toggleWillAttribute(db, 'live', account, data.groups[0]!.id, 'hookType', 'question', now);
    await saveInsights(db, account, '2026-10-14', '2026-10-14', data.insights.map((row, index) => ({ ...row,
      purchases: index >= 1 && index <= 3 ? 20 : 1, purchaseValue: index >= 1 && index <= 3 ? 600 : 30 })), now);
    // Both callers captured the old CreativeData; only the guarded reread can use the import above.
    const tag = recomputeCreativeLifts(guardedDb, account, data, settings, now);
    await Promise.resolve();
    assert.equal(liveReads, 1, 'the queued call cannot read attributes or data early');
    release();
    const [old, current] = await Promise.all([worker, tag]);
    assert.equal(old[0]!.metrics.with.groupCount, 4);
    assert.equal(current[0]!.metrics.with.groupCount, 3);
    assert.equal(current[0]!.metrics.with.purchases, 60);
    assert.equal(current[0]!.metrics.without.groupCount, 5);
    assert.equal(current[0]!.metrics.without.purchases, 5);
    const stored = (await readCreativeLifts(db, account, 'live'))[0]!;
    assert.deepEqual(stored.metrics, current[0]!.metrics);
    assert.equal(liveReads, 2);
  } finally { release(); await worker; }
});
