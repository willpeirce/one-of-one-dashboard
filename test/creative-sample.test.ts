import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogueEntry } from '../src/creatives/model.js';
import { readSampleCreativeCatalogue, sampleCreativeData, SAMPLE_CREATIVE_ACCOUNT } from '../src/creatives/sample.js';
import { defaultSettings } from '../src/settings.js';

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
