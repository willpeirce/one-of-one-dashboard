import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import type { Database } from '../src/db.js';
import { AdError } from '../src/ad-spend/model.js';
import type { AdInsight, CatalogueEntry, CreativeReader } from '../src/creatives/model.js';
import { CreativeWorker } from '../src/creatives/worker.js';
import { creativeHealth, saveCatalogue, saveInsights } from '../src/creatives/store.js';
import { readScanHealth, runCreativeScans } from '../src/creatives/scan.js';
import { defaultSettings, type Settings } from '../src/settings.js';
import { settingsPage } from '../src/settings-view.js';
import { readSourceHealth, syncSourceHealth } from '../src/sources.js';
import { sourceHealthPage } from '../src/views.js';
import { createTestDatabase } from './helpers/database.js';

// Invented media, reporting rows and dynamically generated test credentials only.
const account = 'invented-scan-integration-account';
const now = new Date('2026-10-14T12:00:00Z');
const settings = (): Settings => ({ ...defaultSettings(), metaAdAccountId: account,
  creativeScanInputPrice: 1, creativeScanOutputPrice: 2,
  metaOwners: [{ campaignId: 'invented-integration-campaign', owner: 'ours' }] });
const entry: CatalogueEntry = {
  ad: { id: 'invented-integration-ad', accountId: account, name: 'Invented drawing kit ad', status: 'ACTIVE',
    effectiveStatus: 'ACTIVE', createdAt: '2026-10-08T08:00:00Z', adSetId: 'invented-integration-set', adSetName: 'Invented UK set',
    campaignId: 'invented-integration-campaign', campaignName: 'Invented UK campaign', owner: 'ours', market: 'uk',
    creativeId: 'invented-integration-creative', creativeType: 'image', body: 'Invented drawing kit copy', title: 'Invented gift guide',
    callToAction: 'SHOP_NOW', linkUrl: null, utmContent: null, lastSeen: now.toISOString(), facebookUrl: null,
    instagramUrl: null, objectStoryId: null, instagramMediaId: null },
  media: { id: 'invented-integration-group', kind: 'image', key: 'invented-integration-image', title: 'Invented gift guide',
    lengthSeconds: null, width: 600, height: 600, firstSeen: '2026-10-08T08:00:00Z', alternates: [],
    thumbnail: new Uint8Array([0xff, 0xd8, 0xff, 1]), poster: null, frames: [] },
};
const insights: AdInsight[] = Array.from({ length: 7 }, (_, index) => ({ adId: entry.ad.id, adSetId: entry.ad.adSetId,
  day: `2026-10-${String(index + 8).padStart(2, '0')}`, spend: 20, impressions: 100, reach: 80, frequency: 1.25,
  linkClicks: 10, threeSecondPlays: 0, threeSecondSource: 'none', plays: 0, thruPlays: 0, plays25: 0, plays50: 0,
  plays75: 0, plays100: 0, averagePlayTime: 0, addsToCart: 2, purchases: 1, purchaseValue: 30 }));
const answer = (text = JSON.stringify({ attributes: { format: { value: 'gift-guide', confidence: 0.9, reason: 'Invented guide layout' } } }), input = 100, output = 50) =>
  new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: input, output_tokens: output } }),
    { headers: { 'content-type': 'application/json' } });
let db: Database;
const originalFlag = process.env.CREATIVE_SCAN_ENABLED, originalKey = process.env.ANTHROPIC_API_KEY;
before(async () => { db = await createTestDatabase(); });
beforeEach(async () => {
  await db.query('TRUNCATE pulse.media_groups,pulse.ad_insights_daily,pulse.creative_jobs,pulse.creative_insight_days,pulse.creative_frequencies,pulse.attribute_lifts CASCADE');
  process.env.CREATIVE_SCAN_ENABLED = 'true'; process.env.ANTHROPIC_API_KEY = randomUUID();
});
after(async () => {
  await db.close();
  if (originalFlag === undefined) delete process.env.CREATIVE_SCAN_ENABLED; else process.env.CREATIVE_SCAN_ENABLED = originalFlag;
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = originalKey;
});
async function seed() {
  await saveCatalogue(db, account, [entry], now);
  await saveInsights(db, account, '2026-10-08', '2026-10-14', insights, now);
  await db.query(`INSERT INTO pulse.creative_jobs(account_id,backfill_done,nightly_day) VALUES($1,true,'2026-10-14')`, [account]);
}
function reader(events: string[], failure?: 'catalogue' | 'insights' | 'frequency'): CreativeReader {
  return { readCatalogue: async function* () {
    events.push('catalogue'); if (failure === 'catalogue') throw new AdError('timeout'); yield [entry];
  }, readInsights: async (_account, from, to) => {
    events.push('insights'); if (failure === 'insights') throw new AdError('http', 400, 100, 42);
    return insights.filter(row => row.day >= from && row.day <= to);
  }, readFrequency: async () => {
    events.push('frequency'); if (failure === 'frequency') throw new AdError('timeout'); return 1.5;
  }, imageBytes: async () => { throw new Error('Unexpected invented image refill'); },
  videoSource: async () => { throw new Error('Unexpected invented video read'); }, videoFrames: async () => [] };
}
const job = async () => (await db.query<{ error_code: string | null; last_success_at: Date | null }>(
  'SELECT error_code,last_success_at FROM pulse.creative_jobs WHERE account_id=$1', [account])).rows[0]!;
const scanRows = async () => (await db.query<{ status: string; failure_reason: string | null }>(
  'SELECT status,failure_reason FROM pulse.creative_scans WHERE account_id=$1 ORDER BY sequence', [account])).rows;

test('worker with scan flag off completes Meta and frequency without a scan request or scan log', async t => {
  await seed(); process.env.CREATIVE_SCAN_ENABLED = 'false';
  const events: string[] = [], logs: unknown[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logs.push(args));
  t.mock.method(console, 'info', (...args: unknown[]) => logs.push(args));
  await new CreativeWorker(db, reader(events), { clock: () => now, sleep: async () => {}, fetch: async () => {
    events.push('scan'); return answer();
  } }).run(account, settings(), now);
  assert.deepEqual(events.slice(0,2).sort(), ['catalogue', 'insights']);
  assert.deepEqual(events.slice(2), ['frequency']);
  assert.deepEqual(logs, []); assert.deepEqual(await scanRows(), []);
  assert.equal((await job()).error_code, null);
  assert.equal((await readScanHealth(db, settings(), { mode: 'live', accountId: account, now })).line, 'Scan: off');
});

test('enabled worker scans after successful Meta and exact frequency reads', async () => {
  await seed(); const events: string[] = [];
  await new CreativeWorker(db, reader(events), { clock: () => now, sleep: async () => {}, fetch: async (url, init) => {
    events.push('scan'); assert.equal(String(url), 'https://api.anthropic.com/v1/messages'); assert.equal(init?.method, 'POST'); return answer();
  } }).run(account, settings(), now);
  assert.deepEqual(events.slice(0,2).sort(), ['catalogue', 'insights']);
  assert.deepEqual(events.slice(2), ['frequency', 'scan']);
  assert.deepEqual(await scanRows(), [{ status: 'done', failure_reason: null }]);
  assert.equal((await job()).error_code, null); assert.ok((await job()).last_success_at);
  assert.equal((await db.query('SELECT 1 FROM pulse.creative_frequencies WHERE account_id=$1', [account])).rowCount, 1);
});

for (const failure of ['catalogue', 'insights', 'frequency'] as const) {
  test(`scan success after ${failure} failure preserves the independent Meta result`, async t => {
    await seed(); const events: string[] = [];
    t.mock.method(console, 'error', () => {}); t.mock.method(console, 'info', () => {});
    await new CreativeWorker(db, reader(events, failure), { clock: () => now, sleep: async () => {}, fetch: async () => {
      events.push('scan'); return answer();
    } }).run(account, settings(), now);
    assert.equal(events.at(-1), 'scan'); assert.deepEqual(await scanRows(), [{ status: 'done', failure_reason: null }]);
    assert.equal((await job()).error_code, failure === 'catalogue' ? 'timeout at catalogue after 0 ads'
      : failure === 'insights' ? 'http 400, meta 100/42 at insights' : null);
    if (failure === 'frequency') {
      assert.ok((await job()).last_success_at);
      assert.equal((await db.query<{ frequency: number | null }>('SELECT frequency FROM pulse.creative_frequencies WHERE account_id=$1', [account])).rows[0]!.frequency, null);
    }
  });
}

for (const failure of ['malformed', 'network'] as const) {
  test(`${failure} scan failure leaves successful Meta catalogue and insights healthy`, async t => {
    await seed(); const events: string[] = [], logs: string[] = [];
    t.mock.method(console, 'error', (...args: unknown[]) => logs.push(args.join(' ')));
    await new CreativeWorker(db, reader(events), { clock: () => now, sleep: async () => {}, fetch: async () => {
      events.push('scan'); if (failure === 'network') throw new Error(process.env.ANTHROPIC_API_KEY); return answer('invented malformed JSON');
    } }).run(account, settings(), now);
    assert.deepEqual(events.slice(0,2).sort(), ['catalogue', 'insights']);
  assert.deepEqual(events.slice(2), ['frequency', 'scan']);
    assert.deepEqual(await scanRows(), [{ status: 'failed', failure_reason: failure }]);
    assert.equal((await job()).error_code, null); assert.ok((await job()).last_success_at);
    assert.deepEqual(logs, [`Creative scan failed (${failure})`]);
    assert.ok(!JSON.stringify(logs).includes(process.env.ANTHROPIC_API_KEY!));
  });
}

async function sourceHealthHtml(config: Settings) {
  const scan = await readScanHealth(db, config, { mode: 'live', accountId: account, now });
  const sources = await readSourceHealth(db, scan);
  const creatives = await creativeHealth(db, config, { META_ACCESS_TOKEN: randomUUID() }, now);
  return { scan, anthropic: sources.find(source => source.source === 'anthropic')!, html: sourceHealthPage(sources, undefined, undefined, undefined, {
    summary: 'Invented integration data', checkedAt: now.toISOString(), creatives,
    shopify: { mode: 'sample', checks: [], stock: [], needs: [], detail: {}, live: { lastOrder: 'No data', dispatch: 'No data', carts: 'No data' } },
  }) };
}

test('Source health maps scan success and refusal to Anthropic with safe reason and cap figures', async t => {
  await seed(); t.mock.method(console, 'error', () => {});
  await syncSourceHealth(db, { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY });
  await runCreativeScans(db, settings(), { mode: 'live', accountId: account, clock: () => now, fetch: async () => answer(undefined, 400_000, 10_000) });
  const healthy = await sourceHealthHtml(settings());
  assert.equal(healthy.anthropic.status, 'healthy'); assert.equal(healthy.anthropic.statusText, 'Healthy');
  assert.equal(healthy.anthropic.lastSuccessAt!.toISOString(), now.toISOString());
  assert.match(healthy.html, /data-creative-scan>Scan: on · 1 scanned · 0 failed · £0.42 of £1.00 today/);
  const capped = await sourceHealthHtml({ ...settings(), creativeScanCapGbp: 0.42 });
  assert.equal(capped.anthropic.status, 'healthy');
  assert.match(capped.html, /£0.42 of £0.42 today/);
  assert.match(capped.html, /Daily scan cap reached; try again next UK day/);
  await runCreativeScans(db, settings(), { mode: 'live', accountId: account, groupId: entry.media.id!, clock: () => now,
    fetch: async () => new Response(JSON.stringify({ error: process.env.ANTHROPIC_API_KEY }), { status: 400 }) });
  const failed = await sourceHealthHtml(settings());
  assert.equal(failed.anthropic.status, 'error'); assert.equal(failed.anthropic.consecutiveFailures, 1);
  assert.equal(failed.anthropic.statusText, 'Scan failed: refused (http 400)');
  assert.match(failed.html, /Scan failed: refused \(http 400\)/);
  assert.match(failed.html, /Scan: on · 0 scanned · 1 failed · http 400 · £0.42 of £1.00 today/);
  assert.ok(!failed.html.includes(process.env.ANTHROPIC_API_KEY!));
});

test('zero prices show the exact Settings notice and missing credentials keep Anthropic waiting', async () => {
  await seed(); await syncSourceHealth(db, { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY });
  for (const key of ['creativeScanInputPrice', 'creativeScanOutputPrice'] as const) {
    const config = { ...settings(), [key]: 0 };
    const health = await sourceHealthHtml(config);
    assert.equal(health.scan.message, 'Set the scan prices in Settings');
    assert.equal(health.anthropic.statusText, 'Set the scan prices in Settings');
    assert.match(health.html, /Set the scan prices in Settings/);
    assert.match(settingsPage({ version: 0, values: config }, [], 'live', now), /data-creative-scan-prices>Set the scan prices in Settings<\/p>/);
  }
  delete process.env.ANTHROPIC_API_KEY;
  const missing = await sourceHealthHtml(settings());
  assert.equal(missing.anthropic.status, 'waiting_for_keys'); assert.equal(missing.anthropic.mode, 'sample');
  assert.equal(missing.anthropic.statusText, 'Waiting for keys');
  assert.match(missing.html, /data-creative-scan>Scan: off<\/p>/);
});
