import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings } from '../src/settings.js';
import { sampleCreativeData } from '../src/creatives/sample.js';
import { buildCreativeSheet, buildCreativeView } from '../src/creatives/routes.js';
import { homeMakeNextHtml } from '../src/creatives/lift-view.js';
import { creativeGalleryHtml, creativePanelHtml, creativeSheetHtml } from '../src/creatives/view.js';

const settings = defaultSettings(), today = '2026-10-13';
const data = sampleCreativeData(settings, new Date(`${today}T12:00:00Z`));
test('stored lift presentation is shared by the panel, gallery, sheet and Decide card', async () => {
  const view = buildCreativeView(data, settings, today);
  assert.match(creativePanelHtml(view), /Make next · video.*Strength: strong/);
  const gallery = creativeGalleryHtml(view);
  for (const phrase of ['Make next', '>Video<', '>Image<', 'Full evidence', 'Patterns, not proof', 'invented lift']) assert.ok(gallery.includes(phrase));
  assert.doesNotMatch(gallery, /deferred|no lift calculation|not built/);
  const card = view.cards.find(row => row.kind === 'decide')!;
  assert.equal(card.id, 'creative-lift-video-slabEarly-yes');
  assert.equal(card.brief, view.makeNext.video?.brief);
  assert.match(card.brief!, /a purchase.*Copy:/s);
  const sheet = await buildCreativeSheet(data, settings, today, 'sample-video-1', {}, async () => ({ count: 9, mode: 'sample' }), view.lifts);
  assert.equal(sheet?.brief, view.makeNext.video?.brief);
  assert.match(creativeSheetHtml(sheet!), /Make more like this · Copy brief/);
});
test('missing and Hint-only lifts produce no recommendation or copy brief', async () => {
  const baseline = buildCreativeView(data, settings, today);
  for (const lifts of [[], baseline.lifts.map(lift => ({ ...lift, confidence: 'Hint' as const }))]) {
    const view = buildCreativeView(data, settings, today, {}, [], lifts);
    assert.equal(view.makeNext.video.empty, 'Not enough yet. Scans and spend fill this in.');
    assert.equal(view.makeNext.image.empty, view.makeNext.video.empty);
    assert.deepEqual(view.makeNext.video.bullets, []);
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


test('Home chooses one Make next well by first-bullet confidence, preferring video on a tie', () => {
  const view = buildCreativeView(data, settings, today);
  const briefs = structuredClone(view.homeMakeNext);
  for (const kind of ['video', 'image'] as const) briefs[kind].bullets = Array.from({length: 4}, (_, i) => ({text: `Invented ${kind} instruction ${i}`, confidence: 'Likely', liftIds: []}));
  let html = homeMakeNextHtml(briefs);
  assert.match(html, /data-home-make-next="video"/);
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
  assert.match(html, /aria-label="Copy brief"/);
  briefs.image.bullets[0]!.confidence = 'Strong';
  html = homeMakeNextHtml(briefs);
  assert.match(html, /data-home-make-next="image"/);
  assert.ok(html.includes('data-creative-copy='));
  briefs.video.bullets = []; briefs.image.bullets = [];
  html = homeMakeNextHtml(briefs);
  assert.ok(html.includes(briefs.video.empty));
  assert.doesNotMatch(html, /data-creative-copy/);
});

test('compact Home creatives keep pictures and controls but omit repeated detail paragraphs', () => {
  const view = buildCreativeView(data, settings, today), html = creativePanelHtml(view, true);
  assert.equal((html.match(/class="creative-picture"/g) ?? []).length, 3);
  assert.match(html, /id="creative-ours"/); assert.match(html, /class="cline creative-floor"/);
  assert.doesNotMatch(html, /creative-unplaced|creative-lines|creative-cpp/);
  assert.equal((html.match(/data-home-make-next=/g) ?? []).length, 1);
  assert.match(creativePanelHtml(view), /creative-lines/);
});
