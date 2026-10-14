import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings } from '../src/settings.js';
import { sampleCreativeData } from '../src/creatives/sample.js';
import { buildCreativeSheet, buildCreativeView } from '../src/creatives/routes.js';
import { creativeGalleryHtml, creativePanelHtml, creativeSheetHtml } from '../src/creatives/view.js';

const settings = defaultSettings(), today = '2026-10-13';
const data = sampleCreativeData(settings, new Date(`${today}T12:00:00Z`));
test('stored lift presentation is shared by the panel, gallery, sheet and Decide card', async () => {
  const view = buildCreativeView(data, settings, today);
  assert.match(creativePanelHtml(view), /Winning in video:.*Strong/);
  const gallery = creativeGalleryHtml(view);
  for (const phrase of ['Video lifts', 'Image lifts', 'Make next', 'Next video:', 'Next image:', 'correlation, not a cause', 'fixed invented']) assert.ok(gallery.includes(phrase));
  assert.doesNotMatch(gallery, /deferred|no lift calculation|not built/);
  const card = view.cards.find(row => row.kind === 'decide')!;
  assert.equal(card.id, 'creative-lift-video-slabEarly-yes');
  assert.equal(card.brief, view.makeNext.video?.brief);
  assert.match(card.brief!, /Meta says cost per purchase.*Best examples:/s);
  const sheet = await buildCreativeSheet(data, settings, today, 'sample-video-1', {}, async () => ({ count: 9, mode: 'sample' }), view.lifts);
  assert.equal(sheet?.brief, view.makeNext.video?.brief);
  assert.match(creativeSheetHtml(sheet!), /Make more like this · Copy brief/);
});
test('missing and Hint-only lifts produce no recommendation or copy brief', async () => {
  const baseline = buildCreativeView(data, settings, today);
  for (const lifts of [[], baseline.lifts.map(lift => ({ ...lift, confidence: 'Hint' as const }))]) {
    const view = buildCreativeView(data, settings, today, {}, [], lifts);
    assert.equal(view.winning.video, 'Not enough data yet');
    assert.equal(view.winning.image, 'Not enough data yet');
    assert.deepEqual(view.makeNext, {});
    assert.ok(view.cards.every(card => card.kind !== 'decide'));
    const sheet = await buildCreativeSheet(data, settings, today, 'sample-video-1', {}, async () => ({ count: 9, mode: 'sample' }), lifts);
    assert.equal(sheet?.brief, undefined);
    assert.doesNotMatch(creativeSheetHtml(sheet!), /Make more like this/);
  }
});


test('sheet performance keeps four windows as columns and every video metric as a row', async () => {
  const sheet = await buildCreativeSheet(data, settings, today, 'sample-video-1', {}, async () => ({ count: 9, mode: 'sample' }));
  const html = creativeSheetHtml(sheet!);
  assert.equal((html.match(/scope="col"/g) ?? []).length, 5);
  assert.equal((html.match(/scope="row"/g) ?? []).length, 9);
  for (const metric of ['Purchases', 'Purchase value', 'ROAS', 'Per purchase', 'Hook', 'Hold', 'Watch-through', 'Add to cart']) assert.ok(html.includes(metric));
  assert.doesNotMatch(html, /maxlength="200"|creative-table-scroll/);
});
