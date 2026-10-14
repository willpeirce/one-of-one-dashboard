import assert from 'node:assert/strict';
import test from 'node:test';
import { CreativeWorker } from '../src/creatives/worker.js';
import { readGroupAttributes } from '../src/creatives/attribute-store.js';
import type { CatalogueEntry, CreativeReader } from '../src/creatives/model.js';
import { AdError } from '../src/ad-spend/model.js';
import { defaultSettings } from '../src/settings.js';
import { creativeAd, creativeGroup } from './helpers/creatives.js';
import { createTestDatabase } from './helpers/database.js';

// Every ad, picture, identifier and figure is invented.
test('catalogue passes refresh Meta facts from committed pages, including a partial pass', async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  t.mock.method(console, 'error', () => {});
  const account = 'invented-attribute-worker';
  const group = creativeGroup('invented-attribute-group');
  let copy = 'An invented free kit with markers.';
  let partial = false;
  const reader: CreativeReader = {
    async *readCatalogue() {
      const entry: CatalogueEntry = {
        ad: creativeAd('invented-attribute-ad', group.id, { accountId: account, body: copy }),
        media: { ...group, thumbnail: new Uint8Array([0xff, 0xd8, 1]), poster: null, frames: [] },
      };
      yield [entry];
      if (partial) throw new AdError('timeout');
    },
    readInsights: async () => [], imageBytes: async () => new Uint8Array(), videoFrames: async () => [],
    videoSource: async () => { throw new Error('Unused invented reader'); },
  };
  const settings = { ...defaultSettings(), metaAdAccountId: account };
  await new CreativeWorker(db, reader).run(account, settings, new Date('2026-10-14T12:00:00Z'));
  const first = await readGroupAttributes(db, 'live', account, group.id);
  assert.equal(first.find(row => row.key === 'copyOffer')?.value, 'yes');
  assert.equal(first.find(row => row.key === 'copyMarkers')?.source, 'meta');
  copy = 'An invented kit with stencils.';
  partial = true;
  await new CreativeWorker(db, reader).run(account, settings, new Date('2026-10-14T12:30:00Z'));
  const updated = await readGroupAttributes(db, 'live', account, group.id);
  assert.equal(updated.find(row => row.key === 'copyOffer')?.value, 'no');
  assert.equal(updated.find(row => row.key === 'copyStencils')?.value, 'yes');
  assert.equal((await db.query('SELECT error_code FROM pulse.creative_jobs')).rows[0]?.error_code,
    'timeout at catalogue after 1 ads');
  await db.query('UPDATE pulse.ads SET body=$1', ['Invented free kit.']);
  reader.readCatalogue = async function* () { yield []; };
  await new CreativeWorker(db, reader).run(account, settings, new Date('2026-10-14T13:00:00Z'));
  const retained = await readGroupAttributes(db, 'live', account, group.id);
  assert.equal(retained.find(row => row.key === 'copyOffer')?.value, 'yes',
    'A successful empty list still refreshes facts for retained groups');
});
