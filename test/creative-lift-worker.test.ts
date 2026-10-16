import assert from 'node:assert/strict';
import test from 'node:test';
import { CreativeWorker } from '../src/creatives/worker.js';
import { readCreativeLifts } from '../src/creatives/lifts.js';
import { saveCatalogue, saveInsights } from '../src/creatives/store.js';
import type { CreativeReader } from '../src/creatives/model.js';
import { AdError } from '../src/ad-spend/model.js';
import { defaultSettings } from '../src/settings.js';
import { createTestDatabase } from './helpers/database.js';
import { creativeAd, creativeGroup, creativeInsight } from './helpers/creatives.js';

// Every identifier, image byte, token count, price and performance figure is invented.
test('worker recomputes lifts after scans, and keeps recomputing stored evidence after a Meta failure', async t => {
  const inventedCredential = 'invented-worker-scan-key';
  const db = await createTestDatabase();
  t.after(() => db.close());
  const oldFlag = process.env.CREATIVE_SCAN_ENABLED, oldKey = process.env.ANTHROPIC_API_KEY;
  t.after(() => {
    if (oldFlag === undefined) delete process.env.CREATIVE_SCAN_ENABLED; else process.env.CREATIVE_SCAN_ENABLED = oldFlag;
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = oldKey;
  });
  process.env.CREATIVE_SCAN_ENABLED = 'true'; process.env.ANTHROPIC_API_KEY = inventedCredential;
  t.mock.method(console, 'error', () => {});
  const account = 'invented-lift-worker', now = new Date('2026-10-14T12:00:00Z');
  const entries = Array.from({ length: 6 }, (_, index) => {
    const id = `invented-worker-image-${index}`;
    return { ad: creativeAd(`ad-${id}`, id, { accountId: account, creativeType: 'image' }),
      media: { ...creativeGroup(id, { kind: 'image', lengthSeconds: null }),
        thumbnail: new Uint8Array([0xff, 0xd8, 0xff, index]), poster: null, frames: [] } };
  });
  await saveCatalogue(db, account, entries, now);
  const insights = entries.map((entry, index) => creativeInsight(entry.ad.id,
    { day: '2026-10-13', spend: 60, purchases: index < 3 ? 12 : 2 }));
  let catalogueFails = false;
  const reader: CreativeReader = {
    async *readCatalogue() { if (catalogueFails) throw new AdError('timeout'); yield []; },
    readInsights: async (_account, from, to) => insights.filter(row => row.day >= from && row.day <= to),
    imageBytes: async () => new Uint8Array(), videoFrames: async () => [],
    videoSource: async () => { throw new Error('Unused invented reader'); },
  };
  const settings = { ...defaultSettings(), metaAdAccountId: account,
    creativeScanInputPrice: 1, creativeScanOutputPrice: 2 };
  let calls = 0;
  const worker = new CreativeWorker(db, reader, { clock: () => now, fetch: async (_url, init) => {
    calls++;
    const image = JSON.parse(String(init?.body)).messages[0].content[0].source.data;
    const index = Buffer.from(image, 'base64').at(-1)!;
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ attributes: {
      format: { value: index < 3 ? 'unboxing-flat-lay' : 'gift-guide', confidence: 1, reason: 'Invented picture' },
    } }) }], usage: { input_tokens: 100, output_tokens: 50 } }));
  } });
  await worker.run(account, settings, now);
  assert.equal(calls, 6);
  const first = await readCreativeLifts(db, account, 'live', { windowDays: 7, market: 'all' });
  assert.equal(first.length, 1);
  assert.equal(first[0]?.value, 'unboxing-flat-lay');
  assert.equal(first[0]?.confidence, 'Strong');
  assert.equal(first[0]?.metrics.with.costPerPurchase, 5);
  // Existing complete data is still useful when the next catalogue pass is refused.
  catalogueFails = true;
  const changed = insights.map(row => ({ ...row, purchases: 6 }));
  await saveInsights(db, account, '2026-10-13', '2026-10-13', changed, now);
  await worker.run(account, settings, new Date('2026-10-14T12:30:00Z'));
  assert.equal(calls, 6, 'already scanned parents need no new request');
  assert.deepEqual(await readCreativeLifts(db, account, 'live'), []);
  assert.match((await db.query<{ error_code: string }>('SELECT error_code FROM pulse.creative_jobs WHERE account_id=$1', [account])).rows[0]!.error_code, /timeout at catalogue/);
});
