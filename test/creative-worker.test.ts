import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { MetaSpend } from '../src/ad-spend/clients.js';
import { AdError } from '../src/ad-spend/model.js';
import { SpendWorker } from '../src/ad-spend/worker.js';
import { MetaCreativeClient } from '../src/creatives/client.js';
import type { AdInsight, CatalogueEntry, CreativeReader } from '../src/creatives/model.js';
import { saveCatalogue, saveInsights } from '../src/creatives/store.js';
import { CreativeWorker } from '../src/creatives/worker.js';
import type { Database } from '../src/db.js';
import { defaultSettings } from '../src/settings.js';
import { syncSourceHealth } from '../src/sources.js';
import { createTestDatabase } from './helpers/database.js';

// All identifiers, names, figures and source responses in this file are invented.
const account = '900000009001';
const now = new Date('2026-10-13T12:00:00Z');
const earlier = new Date('2026-10-12T12:00:00Z');
const settings = () => ({ ...defaultSettings(), metaAdAccountId: account });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
function entry(suffix = 'kept'): CatalogueEntry {
  return {
    ad: {
      id: `invented-ad-${suffix}`, accountId: account, name: `Invented ${suffix} ad`, status: 'ACTIVE', effectiveStatus: 'ACTIVE',
      createdAt: earlier.toISOString(), adSetId: 'invented-set', adSetName: 'Invented UK audience',
      campaignId: 'invented-campaign', campaignName: 'Invented campaign', owner: 'ours', market: 'uk',
      creativeId: `invented-creative-${suffix}`, creativeType: 'image', body: 'Invented saved copy', title: 'Invented saved headline',
      callToAction: 'SHOP_NOW', linkUrl: 'https://example.test/invented', utmContent: 'invented-tag', lastSeen: earlier.toISOString(),
      facebookUrl: 'https://www.facebook.com/invented', instagramUrl: 'https://www.instagram.com/invented',
      objectStoryId: 'invented-story', instagramMediaId: 'invented-instagram',
    },
    media: {
      id: `invented-group-${suffix}`, kind: 'image', key: `invented-image-${suffix}`, title: 'Invented saved media', lengthSeconds: null,
      width: 600, height: 600, firstSeen: earlier.toISOString(), alternates: [], thumbnail: new Uint8Array([0xff, 0xd8, 1]),
      poster: null, frames: [],
    },
  };
}
function insight(day: string): AdInsight {
  return {
    adId: entry().ad.id, adSetId: 'invented-set', day, spend: 12, impressions: 100, reach: 80, frequency: 1.25,
    linkClicks: 5, threeSecondPlays: 0, threeSecondSource: 'none', plays: 0, thruPlays: 0, plays25: 0, plays50: 0,
    plays75: 0, plays100: 0, averagePlayTime: 0, addsToCart: 2, purchases: 1, purchaseValue: 30,
  };
}
const reader = (readInsights: CreativeReader['readInsights'] = async () => []): CreativeReader => ({
  readCatalogue: async () => [], readInsights, imageBytes: async () => new Uint8Array(), videoFrames: async () => [],
  videoSource: async () => { throw new Error('unused'); },
});
async function snapshot(db: Database) {
  const result: Record<string, unknown> = {};
  for (const table of ['ads', 'media_groups', 'ad_insights_daily', 'creative_insight_days', 'creative_frequencies']) {
    result[table] = (await db.query(`SELECT to_jsonb(row) AS value FROM pulse.${table} row ORDER BY to_jsonb(row)::text`)).rows;
  }
  return result;
}
const withoutRefreshFields = (row: Record<string, unknown>) => Object.fromEntries(
  Object.entries(row).filter(([key]) => !['name', 'status', 'effective_status', 'last_seen', 'fetched_at'].includes(key)),
);
async function completedJob(db: Database) {
  await db.query('INSERT INTO pulse.creative_jobs(account_id,backfill_done,nightly_day) VALUES($1,true,$2)', [account, '2026-10-13']);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('the exact deleted-object list refusal names catalogue and leaves all saved data untouched', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await saveCatalogue(db, account, [entry(), entry('vanished')], earlier);
  await saveInsights(db, account, '2026-10-12', '2026-10-12', [insight('2026-10-12')], earlier);
  const before = await snapshot(db), requests: string[] = [], logs: string[] = [];
  const credential = randomBytes(16).toString('hex');
  const refusal = { error: { code: 100, error_subcode: 1815001, message: 'Requesting for deleted objects is not supported in this endpoint.' } };
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  const client = new MetaCreativeClient(new MetaSpend(credential, {
    sleep: async () => {},
    fetch: async (url) => {
      const path = new URL(String(url)).pathname;
      requests.push(path.split('/').at(-1)!);
      return path.endsWith('/ads') ? response(refusal, 400) : response({ currency: 'GBP', timezone_name: 'Europe/London' });
    },
  }));
  let frequencyReads = 0;
  client.readFrequency = async () => { frequencyReads++; return 1; };
  await new CreativeWorker(db, client).run(account, settings(), now);
  assert.deepEqual(requests, [`act_${account}`, 'ads']);
  assert.equal(frequencyReads, 0, 'a refused catalogue cannot write independent frequency results');
  assert.deepEqual(await snapshot(db), before);
  const job = (await db.query('SELECT error_code,last_catalogue_at,last_success_at FROM pulse.creative_jobs')).rows[0]!;
  assert.deepEqual(job, { error_code: 'http 400, meta 100/1815001 at catalogue', last_catalogue_at: null, last_success_at: null });
  assert.deepEqual(logs, ['Meta creatives read failed (http 400, meta 100/1815001 at catalogue).']);
  assert.ok(!JSON.stringify([job, logs]).includes(refusal.error.message));
  assert.ok(!JSON.stringify([job, logs]).includes(credential));
});

test('metadata-only catalogue refresh changes only list fields in the matching mode and account', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await saveCatalogue(db, account, [entry(), entry('vanished')], earlier);
  await saveCatalogue(db, '900000009002', [{ ...entry(), media: { ...entry().media, id: 'invented-other-account-group' } }], earlier);
  await saveCatalogue(db, account, [{ ...entry(), media: { ...entry().media, id: 'invented-sample-group' } }], earlier, 'sample');
  await saveInsights(db, account, '2026-10-12', '2026-10-12', [insight('2026-10-12')], earlier);
  const before = await snapshot(db);
  const adsBefore = (await db.query('SELECT * FROM pulse.ads ORDER BY mode,account_id,ad_id')).rows;
  await saveCatalogue(db, account, [
    { ad: { id: entry().ad.id, name: 'Invented renamed ad', status: 'PAUSED', effectiveStatus: 'CAMPAIGN_PAUSED', lastSeen: now.toISOString() }, media: null },
    { ad: { id: 'invented-absent-ad', name: 'Invented absent ad', status: 'ACTIVE', effectiveStatus: 'ACTIVE', lastSeen: now.toISOString() }, media: null },
  ], now);
  const after = await snapshot(db);
  for (const table of ['media_groups', 'ad_insights_daily', 'creative_insight_days', 'creative_frequencies']) assert.deepEqual(after[table], before[table]);
  const adsAfter = (await db.query('SELECT * FROM pulse.ads ORDER BY mode,account_id,ad_id')).rows;
  assert.equal(adsAfter.length, adsBefore.length, 'a refresh never fabricates a missing stored ad');
  for (const [index, row] of adsAfter.entries()) {
    if (row.mode !== 'live' || row.account_id !== account || row.ad_id !== entry().ad.id) {
      assert.deepEqual(row, adsBefore[index], 'omitted ads and other scopes remain untouched');
      continue;
    }
    assert.deepEqual(withoutRefreshFields(row), withoutRefreshFields(adsBefore[index]!));
    assert.equal(row.name, 'Invented renamed ad');
    assert.equal(row.status, 'PAUSED');
    assert.equal(row.effective_status, 'CAMPAIGN_PAUSED');
    assert.equal(new Date(row.last_seen as string).toISOString(), now.toISOString());
    assert.equal(new Date(row.fetched_at as string).toISOString(), now.toISOString());
  }
});

test('worker supplies stored mappings for list-only refresh and reads a changed creative in full', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await saveCatalogue(db, account, [entry(), entry('vanished')], earlier);
  await saveInsights(db, account, '2026-08-07', '2026-08-07', [insight('2026-08-07')], earlier);
  await completedJob(db);
  const before = (await db.query('SELECT * FROM pulse.ads ORDER BY ad_id')).rows;
  const mediaBefore = (await snapshot(db)).media_groups;
  const logs: string[] = [], paths: string[] = [];
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  t.mock.method(console, 'info', (line: string) => logs.push(line));
  let changed = false;
  const fetcher: typeof fetch = async (url) => {
    const request = new URL(String(url));
    paths.push(request.hostname === 'graph.facebook.com' ? request.pathname.split('/').at(-1)! : request.hostname);
    if (request.pathname.endsWith(`/act_${account}`)) return response({ currency: 'GBP', timezone_name: 'Europe/London' });
    if (request.pathname.endsWith('/ads')) return response({ data: [{
      id: entry().ad.id, name: 'Invented renamed ad', status: 'PAUSED', effective_status: 'ADSET_PAUSED', created_time: earlier.toISOString(),
      adset: { id: 'invented-set', name: 'Invented UK audience' }, campaign: { id: 'invented-campaign', name: 'Invented campaign' },
      creative: changed
        ? { id: 'invented-creative-revised', image_hash: 'invented-image-revised', body: 'Invented revised copy' }
        : { id: entry().ad.creativeId, effective_object_story_id: 'invented-story', effective_instagram_media_id: 'invented-instagram', body: 'Invented ignored list copy' },
    }] });
    if (request.pathname.endsWith('/insights')) return response({ data: [] });
    if (request.pathname.endsWith('/invented-creative-revised')) return response({
      id: 'invented-creative-revised', image_hash: 'invented-image-revised', body: 'Invented revised copy', title: 'Invented revised headline',
      thumbnail_url: 'https://media.fbcdn.net/invented-revised.jpg',
    });
    if (request.hostname === 'media.fbcdn.net') return new Response(new Uint8Array([0xff, 0xd8, 2]), { headers: { 'content-type': 'image/jpeg' } });
    assert.fail('Unexpected catalogue expansion');
  };
  const options = { fetch: fetcher, sleep: async () => {} };
  const client = new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'), options), options);
  const worker = new CreativeWorker(db, client);
  await worker.run(account, settings(), now);
  assert.deepEqual(paths, [`act_${account}`, 'ads', 'insights']);
  const refreshed = (await db.query('SELECT * FROM pulse.ads ORDER BY ad_id')).rows;
  assert.deepEqual(withoutRefreshFields(refreshed[0]!), withoutRefreshFields(before[0]!));
  assert.equal(refreshed[0]!.name, 'Invented renamed ad');
  assert.equal(refreshed[0]!.effective_status, 'ADSET_PAUSED');
  assert.equal(new Date(refreshed[0]!.last_seen as string).toISOString(), now.toISOString());
  assert.deepEqual(refreshed[1], before[1], 'vanished ads retain their saved details and last seen time');
  assert.deepEqual((await snapshot(db)).media_groups, mediaBefore);
  changed = true;
  paths.length = 0;
  await worker.run(account, settings(), new Date(now.getTime() + 30 * 60_000));
  assert.deepEqual(paths, ['ads', 'invented-creative-revised', 'media.fbcdn.net', 'insights']);
  const updated = (await db.query('SELECT * FROM pulse.ads WHERE ad_id=$1', [entry().ad.id])).rows[0]!;
  assert.equal(updated.creative_id, 'invented-creative-revised');
  assert.equal(updated.body, 'Invented revised copy');
  assert.equal(updated.title, 'Invented revised headline');
  assert.notEqual(updated.media_group_id, before[0]!.media_group_id);
  assert.equal((await db.query('SELECT * FROM pulse.ad_insights_daily')).rowCount, 1, 'creative replacement retains historical insights');
  assert.deepEqual(logs, []);
});

test('daily, nightly and backfill failures retain the failed window and identify the step safely', async (t) => {
  for (const [from, step] of [['2026-10-12', 'insights'], ['2026-10-06', 'insights'], ['2026-08-07', 'backfill']]) {
    await t.test(`${from} at ${step}`, async (subtest) => {
      const db = await createTestDatabase();
      subtest.after(() => db.close());
      const day = from!;
      await saveCatalogue(db, account, [entry()], earlier);
      await saveInsights(db, account, day, day, [insight(day)], earlier);
      const before = (await db.query('SELECT * FROM pulse.ad_insights_daily WHERE day=$1', [day])).rows;
      const logs: string[] = [];
      subtest.mock.method(console, 'error', (line: string) => logs.push(line));
      const source = reader(async (_account, start) => {
        if (start === day) throw new AdError('http', 400, 100, 1815001);
        return [];
      });
      await new CreativeWorker(db, source).run(account, settings(), now);
      assert.deepEqual((await db.query('SELECT * FROM pulse.ad_insights_daily WHERE day=$1', [day])).rows, before);
      const job = (await db.query('SELECT error_code,backfill_next::text FROM pulse.creative_jobs')).rows[0]!;
      assert.equal(job.error_code, `http 400, meta 100/1815001 at ${step}`);
      assert.equal(job.backfill_next, '2026-08-07');
      assert.deepEqual(logs, [`Meta creatives read failed (http 400, meta 100/1815001 at ${step}).`]);
    });
  }
});

test('the existing spend guard skips one tick during a long creative pass and releases after completion', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const env = { META_ACCESS_TOKEN: randomBytes(16).toString('hex') };
  await syncSourceHealth(db, env);
  await db.query('INSERT INTO pulse.settings(values) VALUES($1)', [JSON.stringify(settings())]);
  await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_done) VALUES('meta',$1,true)", [account]);
  await completedJob(db);
  const spendStarted = deferred(), finishSpend = deferred();
  const creativeStarted = deferred(), finishCreative = deferred();
  let spendReads = 0, catalogueReads = 0, clock = now;
  const logs: string[] = [];
  t.mock.method(console, 'info', (line: string) => logs.push(line));
  const source = reader();
  source.readCatalogue = async () => {
    catalogueReads++;
    creativeStarted.resolve();
    await finishCreative.promise;
    return [entry()];
  };
  const worker = new SpendWorker(db, env, {
    clock: () => clock, creativeReader: source,
    readers: { meta: { read: async () => {
      spendReads++;
      spendStarted.resolve();
      await finishSpend.promise;
      return [];
    } } },
  });
  t.after(async () => {
    finishSpend.resolve();
    finishCreative.resolve();
    await worker.stop();
  });
  const first = worker.tick('meta');
  await spendStarted.promise;
  assert.equal(worker.tick('meta'), first);
  assert.deepEqual(logs, [], 'spend work is not reported as an active creative pass');
  finishSpend.resolve();
  await creativeStarted.promise;
  clock = new Date(now.getTime() + 31 * 60_000);
  const overlapping = worker.tick('meta');
  assert.equal(overlapping, first);
  assert.equal(spendReads, 1);
  assert.equal(catalogueReads, 1);
  assert.deepEqual(logs, ['Meta creatives tick skipped: pass still running.']);
  finishCreative.resolve();
  await overlapping;
  assert.equal((await db.query('SELECT * FROM pulse.ads')).rowCount, 1);
  assert.equal((await db.query('SELECT error_code FROM pulse.creative_jobs')).rows[0]!.error_code, null);
  await worker.tick('meta');
  assert.equal(spendReads, 2);
  assert.equal(catalogueReads, 2);
  assert.equal(logs.length, 1, 'a completed pass releases the overlap guard');
});
