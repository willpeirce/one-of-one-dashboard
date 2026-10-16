import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { MetaSpend } from '../src/ad-spend/clients.js';
import { AdError } from '../src/ad-spend/model.js';
import { SpendWorker } from '../src/ad-spend/worker.js';
import { MetaCreativeClient } from '../src/creatives/client.js';
import type { AdInsight, CatalogueEntry, CreativeReader } from '../src/creatives/model.js';
import { creativeHealth, saveCatalogue, saveInsights } from '../src/creatives/store.js';
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
  readCatalogue: async function* () { yield []; }, readInsights, imageBytes: async () => new Uint8Array(), videoFrames: async () => [],
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
  Object.entries(row).filter(([key]) => !['name', 'status', 'effective_status', 'last_seen', 'fetched_at',
    'status_since', 'ad_set_id', 'ad_set_name', 'campaign_id', 'campaign_name', 'owner', 'market'].includes(key)),
);
async function completedJob(db: Database) {
  await db.query('INSERT INTO pulse.creative_jobs(account_id,backfill_done,nightly_day,thruplays_backfilled_at) VALUES($1,true,$2::date,$2::timestamptz)', [account, '2026-10-13']);
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
  await new CreativeWorker(db, client).run(account, settings(), now, false);
  assert.deepEqual(requests, [`act_${account}`, 'ads']);
  assert.equal(frequencyReads, 0, 'the catalogue-only pass does not run frequency');
  assert.deepEqual(await snapshot(db), before);
  const job = (await db.query('SELECT error_code,last_catalogue_at,last_success_at FROM pulse.creative_jobs')).rows[0]!;
  assert.deepEqual(job, { error_code: 'http 400, meta 100/1815001 at catalogue after 0 ads', last_catalogue_at: null, last_success_at: null });
  assert.deepEqual(logs, ['Meta creatives read failed (http 400, meta 100/1815001 at catalogue after 0 ads).']);
  assert.ok(!JSON.stringify([job, logs]).includes(refusal.error.message));
  assert.ok(!JSON.stringify([job, logs]).includes(credential));
});

test('completed catalogue pages remain visible after a later timeout and a fresh client resumes with list-only saved ads', { timeout: 120_000 }, async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const credential = randomBytes(16).toString('hex');
  const env = { META_ACCESS_TOKEN: credential };
  const pageThreeStarted = deferred(), failPageThree = deferred();
  const requests: { path: string; after: string | null; limit: string | null }[] = [], logs: string[] = [];
  const expansions: { kind: string; index: number }[] = [];
  let failing = true;
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  const listed = Array.from({ length: 75 }, (_, offset) => {
    const index = offset + 1;
    return {
      id: `invented-paged-ad-${index}`, name: `Invented paged ad ${index}`, status: 'ACTIVE', effective_status: 'ACTIVE',
      created_time: earlier.toISOString(), adset: { id: 'invented-set', name: 'Invented UK audience' },
      campaign: { id: 'invented-campaign', name: 'Invented UK campaign' }, creative: {
        id: `invented-paged-creative-${index}`, image_hash: `invented-paged-image-${index}`, body: `Invented saved copy ${index}`,
        effective_object_story_id: `invented-paged-story-${index}`, effective_instagram_media_id: `invented-paged-instagram-${index}`,
        thumbnail_url: `https://media.fbcdn.net/invented-paged-media-${index}.jpg`,
      },
    };
  });
  const options = {
    sleep: async () => {},
    timeoutSignal: (_ms: number) => new AbortController().signal,
    fetch: (async (input) => {
      const url = new URL(String(input));
      const path = url.pathname.split('/').at(-1)!;
      requests.push({ path, after: url.searchParams.get('after'), limit: url.searchParams.get('limit') });
      if (path === `act_${account}`) return response({ currency: 'GBP', timezone_name: 'Europe/London' });
      if (path === 'ads') {
        const cursor = url.searchParams.get('after');
        if (cursor === 'invented-page-3' && failing) {
          pageThreeStarted.resolve();
          await failPageThree.promise;
          throw new DOMException(credential, 'AbortError');
        }
        const start = cursor === 'invented-page-3' ? 50 : cursor === 'invented-page-2' ? 25 : 0;
        const next = start === 0 ? 'invented-page-2' : start === 25 ? 'invented-page-3' : null;
        return response({ data: listed.slice(start, start + 25).map(row => failing ? row : { ...row, name: `${row.name} refreshed`, status: 'PAUSED', effective_status: 'PAUSED' }),
          ...(next ? { paging: { next: `https://graph.facebook.com/v25.0/act_${account}/ads?after=${next}`, cursors: { after: next } } } : {}) });
      }
      if (path === 'insights') return response({ data: [] });
      if (path === 'adimages') return response({ data: [{ hash: JSON.parse(url.searchParams.get('hashes')!)[0], width: 600, height: 600 }] });
      const detail = /^invented-paged-(creative|story|instagram|media)-(\d+)(?:\.jpg)?$/.exec(path);
      assert.ok(detail, 'Only invented catalogue enrichment is expected');
      const kind = detail[1]!, index = Number(detail[2]);
      expansions.push({ kind, index });
      if (kind === 'creative') return response({ thumbnail_url: `https://media.fbcdn.net/invented-paged-media-${index}.jpg` });
      if (kind === 'story') return response({ attachments: { data: [] }, permalink_url: `https://www.facebook.com/invented-paged-story-${index}` });
      if (kind === 'instagram') return response({ permalink: `https://www.instagram.com/p/invented-paged-${index}/` });
      return new Response(new Uint8Array([0xff, 0xd8, index]), { headers: { 'content-type': 'image/jpeg' } });
    }) as typeof fetch,
  };
  const client = () => new MetaCreativeClient(new MetaSpend(credential, options), options);
  const firstPass = new CreativeWorker(db, client()).run(account, settings(), now, false);
  try {
    await Promise.race([pageThreeStarted.promise, firstPass.then(() => { throw new Error('Catalogue stopped before requesting its third page'); })]);
    assert.equal((await creativeHealth(db, settings(), env, now)).catalogueCount, 50, 'Source health sees committed pages while page three is still running');
    assert.equal((await db.query('SELECT last_catalogue_at FROM pulse.creative_jobs')).rows[0]!.last_catalogue_at, null);
    assert.equal(requests.filter(request => request.path === 'insights').length, 0);
  } finally {
    failPageThree.resolve();
    await firstPass;
  }
  assert.deepEqual(requests.filter(request => request.path === 'ads' && request.after === 'invented-page-3').map(request => request.limit), ['25', '25', '25', '25', '10', '10', '10', '10']);
  assert.equal((await db.query('SELECT * FROM pulse.ads')).rowCount, 50);
  const job = (await db.query('SELECT error_code,last_catalogue_at,last_success_at,backfill_next::text FROM pulse.creative_jobs')).rows[0]!;
  assert.deepEqual(job, { error_code: 'timeout at catalogue after 50 ads', last_catalogue_at: null, last_success_at: null, backfill_next: '2026-08-07' });
  assert.deepEqual(logs, ['Meta creatives read failed (timeout at catalogue after 50 ads).']);
  assert.ok(!JSON.stringify([job, logs]).includes(credential));
  assert.equal(requests.filter(request => request.path === 'insights').length, 0, 'the catalogue-only pass does not run insights or frequency');
  const savedAd = (await db.query('SELECT * FROM pulse.ads WHERE ad_id=$1', [listed[0]!.id])).rows[0]!;
  const savedMedia = (await db.query('SELECT * FROM pulse.media_groups ORDER BY id')).rows;
  failing = false;
  requests.length = 0;
  expansions.length = 0;
  const later = new Date(now.getTime() + 30 * 60_000);
  await new CreativeWorker(db, client()).run(account, settings(), later);
  assert.deepEqual(requests.filter(request => request.path === 'ads').map(({ after, limit }) => ({ after, limit })), [
    { after: null, limit: '25' }, { after: 'invented-page-2', limit: '25' }, { after: 'invented-page-3', limit: '25' },
  ]);
  for (const kind of ['creative', 'story', 'instagram', 'media']) {
    assert.deepEqual(expansions.filter(read => read.kind === kind).map(read => read.index), Array.from({ length: 25 }, (_, index) => index + 51), `${kind} reads only enrich the unsaved third page`);
  }
  assert.equal((await db.query('SELECT * FROM pulse.ads')).rowCount, 75);
  const refreshed = (await db.query('SELECT * FROM pulse.ads WHERE ad_id=$1', [listed[0]!.id])).rows[0]!;
  assert.deepEqual(withoutRefreshFields(refreshed), withoutRefreshFields(savedAd));
  assert.equal(refreshed.name, `${listed[0]!.name} refreshed`);
  assert.equal(refreshed.status, 'PAUSED');
  assert.equal(new Date(refreshed.last_seen as string).toISOString(), later.toISOString());
  assert.deepEqual((await db.query('SELECT * FROM pulse.media_groups WHERE id=ANY($1::text[]) ORDER BY id', [savedMedia.map(row => row.id)])).rows, savedMedia);
  const completed = (await db.query('SELECT error_code,last_catalogue_at,backfill_next::text FROM pulse.creative_jobs')).rows[0]!;
  assert.equal(completed.error_code, null);
  assert.equal(new Date(completed.last_catalogue_at as string).toISOString(), later.toISOString());
  assert.equal(completed.backfill_next, '2026-09-04');
  const health = await creativeHealth(db, settings(), env, later);
  assert.equal(health.catalogueCount, 75);
  assert.equal(health.lastSuccessAt, later.toISOString());
  assert.ok(health.completedDays > 0);
  assert.equal(health.error, null);
});

test('a failed page transaction is not counted and partial catalogue progress still obeys the media cap', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await db.query('INSERT INTO pulse.creative_jobs(account_id,last_catalogue_at) VALUES($1,$2)', [account, earlier]);
  const logs: string[] = [];
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  let insightReads = 0;
  const source = reader(async () => { insightReads++; return []; });
  source.readCatalogue = async function* () {
    yield [entry()];
    // A repeated primary key with a new media identity fails after the first row in this page.
    yield [entry('rolled-back'), { ...entry('collision'), media: { ...entry('collision').media, id: entry().media.id } }];
  };
  await new CreativeWorker(db, source).run(account, { ...settings(), creativeMediaCapMb: 1 / (1024 * 1024) }, now, false);
  assert.deepEqual((await db.query('SELECT ad_id FROM pulse.ads')).rows, [{ ad_id: entry().ad.id }]);
  assert.deepEqual((await db.query('SELECT id,thumbnail FROM pulse.media_groups')).rows, [{ id: entry().media.id, thumbnail: null }]);
  const job = (await db.query('SELECT error_code,last_catalogue_at FROM pulse.creative_jobs')).rows[0]!;
  assert.equal(job.error_code, 'unknown at catalogue after 1 ads');
  assert.equal(new Date(job.last_catalogue_at as string).toISOString(), earlier.toISOString(), 'a partial pass does not advance the previous complete catalogue time');
  assert.deepEqual(logs, ['Meta creatives read failed (unknown at catalogue after 1 ads).']);
  assert.equal(insightReads, 0);
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
  const placement = { adSetId: 'invented-current-set', adSetName: 'Invented current — US — audience',
    campaignId: 'invented-current-campaign', campaignName: 'Invented current UK campaign', owner: 'ours' as const, market: 'us' as const };
  await saveCatalogue(db, account, [
    { ad: { id: entry().ad.id, name: 'Invented renamed ad', status: 'PAUSED', effectiveStatus: 'CAMPAIGN_PAUSED', lastSeen: now.toISOString(), ...placement }, media: null },
    { ad: { id: 'invented-absent-ad', name: 'Invented absent ad', status: 'ACTIVE', effectiveStatus: 'ACTIVE', lastSeen: now.toISOString(), ...placement }, media: null },
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
    assert.equal(new Date(row.status_since as string).toISOString(), now.toISOString());
    assert.equal(row.ad_set_id, placement.adSetId);
    assert.equal(row.ad_set_name, placement.adSetName);
    assert.equal(row.campaign_id, placement.campaignId);
    assert.equal(row.campaign_name, placement.campaignName);
    assert.equal(row.owner, placement.owner);
    assert.equal(row.market, placement.market);
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
    if (request.pathname.endsWith('/adimages')) return response({ data: [] });
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
  assert.deepEqual([...paths].sort(), [`act_${account}`, 'ads', 'insights'].sort());
  const refreshed = (await db.query('SELECT * FROM pulse.ads ORDER BY ad_id')).rows;
  assert.deepEqual(withoutRefreshFields(refreshed[0]!), withoutRefreshFields(before[0]!));
  assert.equal(refreshed[0]!.name, 'Invented renamed ad');
  assert.equal(refreshed[0]!.effective_status, 'ADSET_PAUSED');
  assert.equal(refreshed[0]!.ad_set_id, 'invented-set');
  assert.equal(refreshed[0]!.ad_set_name, 'Invented UK audience');
  assert.equal(refreshed[0]!.campaign_id, 'invented-campaign');
  assert.equal(refreshed[0]!.campaign_name, 'Invented campaign');
  assert.equal(refreshed[0]!.owner, 'unassigned');
  assert.equal(refreshed[0]!.market, 'unknown');
  assert.equal(new Date(refreshed[0]!.last_seen as string).toISOString(), now.toISOString());
  assert.deepEqual(refreshed[1], before[1], 'vanished ads retain their saved details and last seen time');
  assert.deepEqual((await snapshot(db)).media_groups, mediaBefore);
  changed = true;
  paths.length = 0;
  await worker.run(account, settings(), new Date(now.getTime() + 30 * 60_000));
  assert.deepEqual([...paths].sort(), ['ads', 'invented-creative-revised', 'adimages', 'media.fbcdn.net', 'insights'].sort());
  const updated = (await db.query('SELECT * FROM pulse.ads WHERE ad_id=$1', [entry().ad.id])).rows[0]!;
  assert.equal(updated.creative_id, 'invented-creative-revised');
  assert.equal(updated.body, 'Invented revised copy');
  assert.equal(updated.title, 'Invented revised headline');
  assert.notEqual(updated.media_group_id, before[0]!.media_group_id);
  assert.equal((await db.query('SELECT * FROM pulse.ad_insights_daily')).rowCount, 1, 'creative replacement retains historical insights');
  assert.deepEqual(logs.filter(line=>!line.startsWith('Media facts:')), []);
});

test('stored ads refresh campaign placement from the list and current ownership without creative reads', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const stored = entry();
  stored.ad.owner = 'unassigned';
  stored.ad.campaignName = 'Invented original UK campaign';
  stored.ad.adSetName = 'Invented original — US — audience';
  await saveCatalogue(db, account, [stored], earlier);
  await saveInsights(db, account, '2026-08-07', '2026-08-07', [insight('2026-08-07')], earlier);
  await completedJob(db);
  const before = (await db.query('SELECT * FROM pulse.ads')).rows[0]!;
  const dataBefore = await snapshot(db);
  assert.equal(before.owner, 'unassigned');
  assert.equal(before.market, 'uk');
  const campaign = { id: stored.ad.campaignId, name: 'Invented renamed UK campaign' };
  const adset = { id: 'invented-current-set', name: 'Invented renamed — US — audience' };
  const paths: string[] = [], logs: string[] = [];
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  t.mock.method(console, 'info', (line: string) => logs.push(line));
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    paths.push(url.pathname.split('/').at(-1)!);
    if (url.pathname.endsWith(`/act_${account}`)) return response({ currency: 'GBP', timezone_name: 'Europe/London' });
    if (url.pathname.endsWith('/ads')) return response({ data: [{
      id: stored.ad.id, name: 'Invented current ad', status: 'PAUSED', effective_status: 'PAUSED', campaign, adset,
      creative: { id: stored.ad.creativeId, effective_object_story_id: 'invented-story', effective_instagram_media_id: 'invented-instagram',
        thumbnail_url: 'https://media.fbcdn.net/invented-unused.jpg', body: 'Invented ignored list copy' },
    }] });
    if (url.pathname.endsWith('/insights')) return response({ data: [] });
    assert.fail('Stored creatives must not request detail, post, Instagram or media endpoints');
  };
  const options = { fetch: fetcher, sleep: async () => {} };
  const client = new MetaCreativeClient(new MetaSpend(randomBytes(16).toString('hex'), options), options);
  const worker = new CreativeWorker(db, client);
  await worker.run(account, settings(), now);
  assert.deepEqual([...paths].sort(), [`act_${account}`, 'ads', 'insights'].sort());
  const unassigned = (await db.query('SELECT * FROM pulse.ads')).rows[0]!;
  assert.equal(unassigned.owner, 'unassigned');
  assert.equal(unassigned.market, 'uk', 'unassigned placement continues to use the UK campaign');
  const currentSettings = { ...settings(), metaOwners: [{ campaignId: campaign.id, owner: 'ours' as const }] };
  const later = new Date(now.getTime() + 30 * 60_000);
  paths.length = 0;
  await worker.run(account, currentSettings, later);
  assert.deepEqual([...paths].sort(), ['ads', 'insights'].sort());
  const refreshed = (await db.query('SELECT * FROM pulse.ads')).rows[0]!;
  assert.equal(refreshed.owner, 'ours');
  assert.equal(refreshed.market, 'us', 'the changed local owner rule uses the US ad set with the same creative');
  assert.equal(refreshed.ad_set_id, adset.id);
  assert.equal(refreshed.ad_set_name, adset.name);
  assert.equal(refreshed.campaign_id, campaign.id);
  assert.equal(refreshed.campaign_name, campaign.name);
  assert.equal(refreshed.name, 'Invented current ad');
  assert.equal(refreshed.status, 'PAUSED');
  assert.equal(refreshed.effective_status, 'PAUSED');
  assert.equal(new Date(refreshed.last_seen as string).toISOString(), later.toISOString());
  assert.deepEqual(withoutRefreshFields(refreshed), withoutRefreshFields(before), 'creative, media reference and first-spend history stay unchanged');
  const dataAfter = await snapshot(db);
  assert.deepEqual(dataAfter.media_groups, dataBefore.media_groups);
  assert.deepEqual(dataAfter.ad_insights_daily, dataBefore.ad_insights_daily);
  assert.deepEqual(logs.filter(line=>!line.startsWith('Media facts:')), []);
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

test('the spend guard coalesces pending spend while the creative guard allows later spend polls', async (t) => {
  const db = await createTestDatabase();
  const spendStarted = deferred(), finishSpend = deferred();
  const creativeStarted = deferred(), finishCreative = deferred();
  let worker: SpendWorker | undefined;
  t.after(async () => {
    finishSpend.resolve();
    finishCreative.resolve();
    await worker?.stop();
    await db.close();
  });
  const env = { META_ACCESS_TOKEN: randomBytes(16).toString('hex') };
  await syncSourceHealth(db, env);
  await db.query('INSERT INTO pulse.settings(values) VALUES($1)', [JSON.stringify(settings())]);
  await db.query("INSERT INTO pulse.ad_spend_jobs(source,account_id,backfill_done) VALUES('meta',$1,true)", [account]);
  await completedJob(db);
  let spendReads = 0, catalogueReads = 0, clock = now;
  const logs: string[] = [];
  t.mock.method(console, 'info', (line: string) => logs.push(line));
  const source = reader();
  source.readCatalogue = async function* () {
    catalogueReads++;
    creativeStarted.resolve();
    await finishCreative.promise;
    yield [entry()];
  };
  worker = new SpendWorker(db, env, {
    clock: () => clock, creativeReader: source,
    readers: { meta: { read: async () => {
      spendReads++;
      spendStarted.resolve();
      await finishSpend.promise;
      return [];
    } } },
  });
  const first = worker.tick('meta');
  let spendFinished = false;
  void first.then(() => { spendFinished = true; });
  await spendStarted.promise;
  assert.equal(worker.tick('meta'), first);
  assert.deepEqual(logs, [], 'spend work is not reported as an active creative pass');
  finishSpend.resolve();
  await creativeStarted.promise;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(spendFinished, true, 'spend completes while the creative catalogue is held open');
  await first;
  clock = new Date(now.getTime() + 31 * 60_000);
  const overlapping = worker.tick('meta');
  assert.notEqual(overlapping, first);
  await overlapping;
  assert.equal(spendReads, 2);
  assert.equal(catalogueReads, 1);
  assert.deepEqual(logs, ['Meta creatives tick skipped: pass still running.']);
  finishCreative.resolve();
  await worker.waitForCreatives();
  assert.equal((await db.query('SELECT * FROM pulse.ads')).rowCount, 1);
  assert.equal((await db.query('SELECT error_code FROM pulse.creative_jobs')).rows[0]!.error_code, null);
  clock = new Date(now.getTime() + 62 * 60_000);
  await worker.tick('meta');
  await worker.waitForCreatives();
  assert.equal(spendReads, 3);
  assert.equal(catalogueReads, 2);
  assert.equal(logs.length, 1, 'a completed pass releases the overlap guard');
});
