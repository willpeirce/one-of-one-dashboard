import assert from 'node:assert/strict';
import test from 'node:test';
import { attributesForKind, deterministicAttributeValues, resolveAttribute, resolveAttributes, validateAttributeValues, type AttributeRow } from '../src/creatives/attributes.js';
import type { CreativeAd, MediaGroup } from '../src/creatives/model.js';

const group: MediaGroup = { id: 'invented-attribute-video', kind: 'video', key: 'invented-media-key', title: 'Invented craft clip',
  lengthSeconds: 18, width: 600, height: 800, firstSeen: '2026-10-10T10:00:00Z', mergedIntoId: null,
  alternates: [{ kind: 'video', key: 'invented-square-crop' }], thumbnailUrl: '/invented-picture' };
const ad = (body: string, createdAt = '2026-10-12T10:00:00Z'): Pick<CreativeAd, 'id' | 'createdAt' | 'body' | 'title' | 'callToAction'> =>
  ({ id: 'invented-copy-ad', createdAt, body, title: 'Invented kit', callToAction: 'SHOP_NOW' });
const row = (source: AttributeRow['source'], value: unknown, key = 'hookType'): AttributeRow => ({ groupId: group.id, key, source, value });

test('Meta attributes use dimensions, length, newest copy, whole words and finite CTA labels', () => {
  const values = deterministicAttributeValues(group, [
    ad('A price, FREE stencils and MARKERS. Save £9 on this invented offer.'),
    { ...ad('No offer in the older copy', '2026-10-11T10:00:00Z'), id: 'invented-old-ad', callToAction: 'LEARN_MORE' },
  ]);
  assert.equal(values.type, 'video');
  assert.equal(values.lengthBand, '10-20');
  assert.equal(values.aspect, 'portrait');
  assert.equal(values.copyPrice, 'yes');
  assert.equal(values.copyOffer, 'yes');
  assert.equal(values.copyStencils, 'yes');
  assert.equal(values.copyMarkers, 'yes');
  assert.equal(values.placementCustomised, 'yes');
  assert.equal(values.callToAction, 'SHOP_NOW');
  const wordsOnly = deterministicAttributeValues({ ...group, width: 800, height: 600, alternates: [] }, [ad('Remarkers stencilsmith priceless coffee saved offered decoding.')]);
  assert.equal(wordsOnly.aspect, 'landscape');
  assert.equal(wordsOnly.copyPrice, 'no');
  assert.equal(wordsOnly.copyOffer, 'no');
  assert.equal(wordsOnly.copyStencils, 'no');
  assert.equal(wordsOnly.copyMarkers, 'no');
  assert.equal(wordsOnly.placementCustomised, 'no');
  assert.equal(deterministicAttributeValues(group, [ad('Invented kit ₩900.')]).copyPrice, 'yes');
  assert.equal(deterministicAttributeValues(group, [{ ...ad('Invented copy'), callToAction: 'UNRECOGNISED_PROVIDER_CODE' }]).callToAction, 'OTHER');
  assert.equal(resolveAttribute('video', 'callToAction', [row('meta', 'SHOP_NOW', 'callToAction')])!.valueLabel, 'shop now');
});

test('length bands and aspect cover boundaries, while absent measurements stay unknown', () => {
  const band = (seconds: number | null) => deterministicAttributeValues({ ...group, lengthSeconds: seconds }, []).lengthBand;
  assert.deepEqual([band(9.9), band(10), band(19.9), band(20), band(40), band(40.1)], ['under-10', '10-20', '10-20', '20-40', '20-40', 'over-40']);
  assert.equal(band(null), undefined);
  assert.equal(band(-1), undefined);
  assert.equal(deterministicAttributeValues({ ...group, width: 600, height: 600 }, []).aspect, 'square');
  assert.equal(deterministicAttributeValues({ ...group, width: null }, []).aspect, undefined);
  assert.equal(deterministicAttributeValues({ ...group, kind: 'image' }, []).lengthBand, undefined);
});

test('one resolver chooses Will then confident model then Meta; low model stays unsure and unusable for lifts', () => {
  const rows = [row('meta', 'yes', 'stencilsMentioned'), row('model', { value: 'no', confidence: 0.8 }, 'stencilsMentioned'), row('will', 'yes', 'stencilsMentioned')];
  assert.equal(resolveAttribute('video', 'stencilsMentioned', rows)!.source, 'will');
  assert.equal(resolveAttribute('video', 'stencilsMentioned', rows.slice(0, 2))!.value, 'no');
  assert.equal(resolveAttribute('video', 'stencilsMentioned', rows.slice(0, 1))!.source, 'meta');
  const unsure = resolveAttribute('video', 'stencilsMentioned', [rows[0]!, row('model', { value: 'no', confidence: 0.4 }, 'stencilsMentioned')])!;
  assert.equal(unsure.value, null);
  assert.equal(unsure.valueLabel, 'unsure');
  assert.equal(unsure.source, 'model');
  assert.equal(unsure.unsure, true);
  assert.equal(resolveAttribute('video', 'hookType', [row('model', { value: 'unboxing', confidence: 0.5 })])!.value, 'unboxing');
});

test('invalid stored values are dropped, all kind attributes resolve, and sound is never allowed from the model', () => {
  const model = validateAttributeValues('video', 'model', {
    hookType: { value: 'unboxing', confidence: 0.9, reason: 'One invented line\nwith a continuation.' },
    setting: { value: 'invented-outside-the-schema', confidence: 1 },
    inventedKey: { value: 'yes', confidence: 1 },
    captions: { value: 'yes', confidence: 2 },
    voiceOver: { value: 'yes', confidence: 1 },
    whoSpeaks: { value: 'founder', confidence: 1 },
    music: { value: 'yes', confidence: 1 },
    spokenCallToAction: { value: 'yes', confidence: 1 },
  });
  assert.equal(model.dropped, 7);
  assert.deepEqual(Object.keys(model.values), ['hookType']);
  assert.equal(model.values.hookType!.reason, 'One invented line with a continuation.');
  const all = resolveAttributes('video', [row('will', 'invalid'), row('model', { value: 'unboxing', confidence: 0.9 })]);
  assert.equal(all.length, attributesForKind('video').length);
  assert.equal(all.find(value => value.key === 'hookType')!.value, 'unboxing');
  assert.equal(all.find(value => value.key === 'slabEarly')!.valueLabel, 'not scanned yet');
  for (const key of ['whoSpeaks', 'voiceOver', 'music', 'spokenCallToAction']) assert.deepEqual(attributesForKind('video').find(attribute => attribute.key === key)!.sources, ['will']);
  assert.equal(attributesForKind('image').some(attribute => attribute.key === 'hookType'), false);
  assert.equal(attributesForKind('video').some(attribute => attribute.key === 'format'), false);
  assert.equal(resolveAttribute('video', 'unrecognised', []), null);
});
