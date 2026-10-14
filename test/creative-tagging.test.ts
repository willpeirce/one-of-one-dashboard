import assert from 'node:assert/strict';
import test from 'node:test';
import { creativeAttributeOptions, creativeTaggingQueue, filterCreativeAttributes } from '../src/creatives/tagging.js';
import { resolveAttributes, type AttributeRow } from '../src/creatives/attributes.js';
import { aggregateCreativeGroups } from '../src/creatives/ranking.js';
import { creativeTagRowHtml } from '../src/creatives/view.js';
import { creativeAd, creativeData, creativeGroup, creativeInsight } from './helpers/creatives.js';

test('tagging queue includes only eligible parents without any Will row, unsure first then newest', () => {
  const data = creativeData(['invented-old-unsure', 'invented-new', 'invented-tagged', 'invented-note', 'invented-floor']);
  data.groups[0]!.firstSeen = '2026-10-01T12:00:00Z';
  data.groups[1]!.firstSeen = '2026-10-12T12:00:00Z';
  data.insights.at(-1)!.spend = 50;
  data.groups.push(creativeGroup('invented-child', { mergedIntoId: 'invented-new' }));
  data.ads.push(creativeAd('invented-child-ad', 'invented-child'));
  data.insights.push(creativeInsight('invented-child-ad'));
  const rows: AttributeRow[] = [
    { groupId: 'invented-old-unsure', key: 'hookType', source: 'model', value: { value: 'unboxing', confidence: 0.4 } },
    { groupId: 'invented-tagged', key: 'slabEarly', source: 'will', value: 'yes' },
    { groupId: 'invented-note', key: 'note', source: 'will', value: { value: 'Invented note' } },
  ];
  assert.deepEqual(creativeTaggingQueue(data, rows, 50, '2026-10-13').map(group => [group.groupId, group.unsure]), [
    ['invented-old-unsure', true], ['invented-new', false],
  ]);
});

test('attribute filters use the shared resolved value and exclude unknown or unsure groups', () => {
  const data = creativeData(['invented-will', 'invented-model', 'invented-unsure', 'invented-unknown']);
  const rows: AttributeRow[] = [
    { groupId: 'invented-will', key: 'hookType', source: 'model', value: { value: 'claim', confidence: 0.9 } },
    { groupId: 'invented-will', key: 'hookType', source: 'will', value: 'unboxing' },
    { groupId: 'invented-model', key: 'hookType', source: 'model', value: { value: 'unboxing', confidence: 0.8 } },
    { groupId: 'invented-unsure', key: 'hookType', source: 'model', value: { value: 'unboxing', confidence: 0.4 } },
  ];
  const groups = aggregateCreativeGroups(data);
  assert.deepEqual(filterCreativeAttributes(groups, rows, 'hookType', 'unboxing').map(group => group.group.id).sort(), ['invented-model', 'invented-will']);
  assert.equal(filterCreativeAttributes(groups, rows, 'hookType', 'claim').length, 0);
  assert.equal(filterCreativeAttributes(groups, rows).length, 4);
  assert.ok(!creativeAttributeOptions('image').some(attribute => attribute.key === 'voiceOver'));
  assert.deepEqual(creativeAttributeOptions().find(attribute => attribute.key === 'type')!.values.map(option => option.value), ['video', 'image']);
});

test('tagging pills show plain labels, prefill the resolved answer and retain its source', () => {
  const attribute = resolveAttributes('video', [{ groupId: 'invented-parent', key: 'slabsShown', source: 'model', value: { value: '3-plus', confidence: 0.8 } }])
    .find(attribute => attribute.key === 'slabsShown')!;
  const html = creativeTagRowHtml(attribute);
  assert.match(html, /aria-pressed="true">3 or more<\/button>/);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.match(html, /creative-tag-source">model/);
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ' '), /3-plus|slabsShown|Save button/);
});
