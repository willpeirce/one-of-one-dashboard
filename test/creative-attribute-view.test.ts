import assert from 'node:assert/strict';
import test from 'node:test';
import { attributesForKind, resolveAttributes, type AttributeRow } from '../src/creatives/attributes.js';
import { creativeAttributesHtml } from '../src/creatives/view.js';

// Every value and group in these examples is invented.
test('attribute rows show the full schema in plain words, with source marks and unknown states', () => {
  const rows: AttributeRow[] = [
    { groupId: 'invented-parent', key: 'lengthBand', source: 'meta', value: '10-20' },
    { groupId: 'invented-parent', key: 'hookType', source: 'model', value: { value: 'unboxing', confidence: 0.8 } },
    { groupId: 'invented-parent', key: 'slabEarly', source: 'model', value: { value: 'yes', confidence: 0.4 } },
    { groupId: 'invented-parent', key: 'slabsShown', source: 'will', value: '3-plus' },
  ];
  const html = creativeAttributesHtml(resolveAttributes('video', rows));
  assert.equal((html.match(/data-attribute=/g) ?? []).length, attributesForKind('video').length);
  assert.match(html, /Length<\/dt><dd>10 to 20 s <small[^>]*>Meta<\/small>/);
  assert.match(html, /Hook<\/dt><dd>unboxing <small[^>]*>model<\/small>/);
  assert.match(html, /Slab in the first 3 seconds<\/dt><dd>unsure <small[^>]*>model<\/small>/);
  assert.match(html, /Slabs shown<\/dt><dd>3 or more <small[^>]*>Will<\/small>/);
  assert.match(html, /class="creative-attribute unknown"[^>]*><dt>Captions<\/dt><dd>not scanned yet/);
  const visible = html.replace(/<[^>]*>/g, ' ');
  assert.doesNotMatch(visible, /lengthBand|slabEarly|slabsShown|3-plus|10-20/);
  const image = creativeAttributesHtml(resolveAttributes('image', []));
  assert.equal((image.match(/data-attribute=/g) ?? []).length, attributesForKind('image').length);
  assert.doesNotMatch(image, /data-attribute="hookType"|data-attribute="voiceOver"/);
});

test('attribute labels and displayed values are escaped before entering the sheet', () => {
  const rows = resolveAttributes('image', []);
  rows[0] = { ...rows[0]!, label: '<invented>', valueLabel: '<script>invented</script>' };
  const html = creativeAttributesHtml(rows);
  assert.doesNotMatch(html, /<script>|<invented>/);
  assert.match(html, /&lt;script&gt;invented&lt;\/script&gt;/);
});
