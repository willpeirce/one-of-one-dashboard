import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogueEntry } from '../src/creatives/model.js';
import { readSampleCreativeCatalogue, sampleCreativeAttributeRows, sampleCreativeData, sampleCreativeStoredLifts, SAMPLE_CREATIVE_ACCOUNT } from '../src/creatives/sample.js';
import { defaultSettings } from '../src/settings.js';
import { resolveAttributes, validAttributeValue } from '../src/creatives/attributes.js';
import { creativeTaggingQueue } from '../src/creatives/tagging.js';
import { deriveCreativeLiftPresentation } from '../src/creatives/lift-presentation.js';
import { buildCreativeSheet, buildCreativeView } from '../src/creatives/routes.js';
import { creativeCardsHtml, creativeSheetHtml, creativesPage } from '../src/creatives/view.js';

test('the sample catalogue yields one complete page matching the invented UI ads and pictures', async () => {
  const settings = defaultSettings(), now = new Date('2026-10-14T12:00:00Z');
  const sample = sampleCreativeData(settings, now), pages: CatalogueEntry[][] = [];
  for await (const page of readSampleCreativeCatalogue(settings, now)) pages.push(page);
  assert.equal(pages.length, 1);
  const entries = pages[0]!;
  assert.equal(entries.length, sample.ads.length);
  assert.deepEqual(entries.map(entry => entry.ad), sample.ads);
  for (const entry of entries) {
    assert.equal(entry.ad.accountId, SAMPLE_CREATIVE_ACCOUNT);
    const group = sample.groups.find(group => group.id === entry.media.id)!;
    assert.equal(entry.media.id, group.id);
    assert.equal(entry.media.key, group.key);
    assert.equal(entry.media.kind, group.kind);
    const picture = decodeURIComponent(group.thumbnailUrl.slice(group.thumbnailUrl.indexOf(',') + 1));
    assert.equal(Buffer.from(entry.media.thumbnail!).toString('utf8'), picture);
    assert.match(picture, /Invented picture · sample data/);
    assert.deepEqual(entry.media.poster, group.kind === 'video' ? entry.media.thumbnail : null);
    assert.deepEqual(entry.media.frames, []);
  }
});

const now = new Date('2026-10-14T12:00:00Z');

test('invented sample attributes cover each source, unsure and unknown states with exactly one queue candidate', () => {
  const settings = defaultSettings();
  const data = sampleCreativeData(settings, now);
  const rows = sampleCreativeAttributeRows(data);
  for (const row of rows) {
    const group = data.groups.find(group => group.id === row.groupId)!;
    assert.equal(group.mergedIntoId, null);
    assert.ok(validAttributeValue(group.kind, row.key, row.source, row.value), `${row.groupId}: ${row.key}`);
  }
  assert.deepEqual([...new Set(rows.map(row => row.source))].sort(), ['meta', 'model', 'will']);
  const queue = creativeTaggingQueue(data, rows, settings.creativeSpendFloorGbp, '2026-10-14');
  assert.deepEqual(queue.map(group => group.groupId), ['sample-video-3']);
  assert.equal(queue[0]!.unsure, true);
  const queued = resolveAttributes('video', rows.filter(row => row.groupId === queue[0]!.groupId));
  assert.equal(queued.find(row => row.key === 'hookType')!.unsure, true);
  assert.equal(queued.find(row => row.key === 'hookType')!.value, null);
  assert.equal(queued.find(row => row.key === 'productEarly')!.source, 'model');
  assert.equal(queued.find(row => row.key === 'lengthBand')!.source, 'meta');
  assert.equal(queued.find(row => row.key === 'voiceOver')!.valueLabel, 'not scanned yet');
  const tagged = resolveAttributes('video', rows.filter(row => row.groupId === 'sample-video-1'));
  assert.equal(tagged.find(row => row.key === 'slabEarly')!.source, 'will');
  assert.equal(tagged.find(row => row.key === 'slabEarly')!.value, 'yes');
});

test('invented sample lifts use canonical figures and existing examples for both types with one Strong card', () => {
  const data = sampleCreativeData(defaultSettings(), now);
  const lifts = sampleCreativeStoredLifts(now).filter(lift => lift.windowDays === 7 && lift.market === 'all');
  assert.deepEqual(lifts.map(lift => lift.kind), ['video', 'image']);
  assert.equal(lifts.filter(lift => lift.confidence === 'Strong').length, 1);
  const presentation = deriveCreativeLiftPresentation(lifts, data);
  assert.equal(presentation.cards.length, 1);
  assert.equal(presentation.cards[0]!.kind, 'decide');
  for (const kind of ['video', 'image'] as const) {
    assert.equal(presentation.makeNext[kind].line, presentation.makeNext[kind].bullets[0]!.text);
    assert.match(presentation.makeNext[kind]!.brief, /Patterns, not proof/);
    assert.match(presentation.makeNext[kind]!.brief, /a purchase/);
    assert.doesNotMatch(presentation.makeNext[kind].line, /Not enough data yet/);
  }
  for (const lift of lifts) {
    assert.match(lift.id, /^invented-brief-/);
    assert.equal(lift.metrics.from, '2026-10-08');
    assert.equal(lift.metrics.to, '2026-10-14');
    for (const side of [lift.metrics.with, lift.metrics.without]) {
      assert.equal(side.costPerPurchase, side.spend / side.purchases);
      assert.equal(side.roas, side.purchaseValue / side.spend);
      assert.ok(side.groupCount >= 3 && side.spend >= 150);
      if (lift.kind === 'image') assert.equal(side.hookRate, null);
    }
    for (const id of lift.metrics.exampleGroupIds) {
      const example = data.groups.find(group => group.id === id);
      assert.equal(example?.kind, lift.kind);
      assert.equal(example?.mergedIntoId, null);
    }
  }
});


test('sample mode renders the attributes, form, queue, scan-off state, lifts, briefs and Decide card', async () => {
  const settings = defaultSettings();
  const data = sampleCreativeData(settings, now);
  const view = buildCreativeView(data, settings, '2026-10-14');
  assert.deepEqual(view.taggingQueue.map(group => group.groupId), ['sample-video-3']);
  const html = creativesPage(view);
  assert.match(html, /Sample data · every ad, picture and figure is invented/);
  assert.match(html, /Scan: off/);
  assert.match(html, /data-queue-group="sample-video-3"/);
  assert.match(html, /Model unsure/);
  assert.match(html, /name="attribute"/);
  assert.match(html, /data-make-next="video"/);
  assert.match(html, /data-make-next="image"/);
  assert.match(html, /invented lift illustrations/);
  assert.match(html, /Make next/);
  assert.match(html, /aria-label="Copy video instructions"/);
  assert.doesNotMatch(html, /Copy video brief|Copy image brief/);
  assert.doesNotMatch(html, /Scan now|deferred to the next batch/);
  const sheet = await buildCreativeSheet(data, settings, '2026-10-14', 'sample-video-3', {}, async () => ({ count: 3, mode: 'sample' }));
  assert.ok(sheet);
  const sheetHtml = creativeSheetHtml(sheet);
  assert.match(sheetHtml, /data-tag-group="sample-video-3"/);
  assert.match(sheetHtml, /data-creative-tag-key="hookType"/);
  assert.match(sheetHtml, /model · unsure/);
  assert.match(sheetHtml, /not scanned yet/);
  assert.match(sheetHtml, /creative-attribute-source">Meta/);
  assert.match(sheetHtml, /Make more like this · Copy brief/);
  assert.doesNotMatch(sheetHtml, /Scan now/);
  const cards = creativeCardsHtml(view.cards.filter(card => card.kind === 'decide'));
  assert.equal((cards.match(/data-creative-card=/g) ?? []).length, 1);
  assert.match(cards, /Make more like this: video/);
  assert.match(cards, /Copy brief/);
  assert.match(cards, /data-creative-action="done"/);
});
