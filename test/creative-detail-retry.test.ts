import assert from 'node:assert/strict';
import test from 'node:test';
import { MetaSpend } from '../src/ad-spend/clients.js';
import { MetaCreativeClient } from '../src/creatives/client.js';
import { CreativeWorker } from '../src/creatives/worker.js';
import { creativeHealth, mergeMediaGroups, reducedDetailCount, saveCatalogue, saveInsights } from '../src/creatives/store.js';
import type { AdInsight, CatalogueEntry } from '../src/creatives/model.js';
import { defaultSettings } from '../src/settings.js';
import { createTestDatabase } from './helpers/database.js';

// All names, identifiers, images, figures and credentials are invented.
const account = 'invented-retry-account';
const inventedCredential = 'invented-retry-key';
const started = new Date('2026-10-14T12:00:00Z');
const atHour = (hour: number) => new Date(started.getTime() + hour * 3_600_000);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const small = new Uint8Array([0xff, 0xd8, 1]), large = new Uint8Array([0xff, 0xd8, 2]);
const historic: AdInsight = { adId: 'invented-retry-first', adSetId: 'invented-set', day: '2026-09-01', spend: 24,
  impressions: 100, reach: 80, frequency: 1.25, linkClicks: 6, threeSecondPlays: 30, threeSecondSource: 'video_view',
  plays: 40, thruPlays: 10, plays25: 20, plays50: 15, plays75: 10, plays100: 5, averagePlayTime: 4,
  addsToCart: 3, purchases: 2, purchaseValue: 60 };

test('reduced groups retry daily, recover in place, preserve history and expose their remaining count', { timeout: 120_000 }, async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const settings = { ...defaultSettings(), metaAdAccountId: account };
  const info: string[] = [], paths: string[] = [], errors: string[] = [];
  t.mock.method(console, 'info', (line: string) => info.push(line));
  t.mock.method(console, 'error', (line: string) => errors.push(line));
  let recovered = false, listedName = 'Invented original ad', listedCopy = 'Invented original copy';
  const options = { sleep: async () => {}, timeoutSignal: () => new AbortController().signal, log: () => {}, fetch: (async input => {
    const url = new URL(String(input)), path = url.pathname.split('/').at(-1)!;
    paths.push(path);
    if (path === `act_${account}`) return json({ currency: 'GBP', timezone_name: 'Europe/London' });
    if (path === 'ads') return json({ data: ['first', 'second'].map(label => ({
      id: `invented-retry-${label}`, name: listedName, status: 'PAUSED', effective_status: 'PAUSED', created_time: '2026-09-01T10:00:00Z',
      adset: { id: 'invented-set', name: 'Invented UK set' }, campaign: { id: 'invented-campaign', name: 'Invented UK campaign' },
      creative: { id: `invented-creative-${label}`, video_id: 'invented-video', body: listedCopy, thumbnail_url: 'https://media.fbcdn.net/invented-small.jpg' },
    })) });
    if (path.startsWith('invented-creative-')) return recovered
      ? json({ video_id: 'invented-video', thumbnail_url: 'https://media.fbcdn.net/invented-large.jpg', body: 'Invented expanded copy' })
      : json({ error: { code: 200 } }, 403);
    if (path === 'invented-video') return json({ title: 'Invented shared video', length: recovered ? 14 : 12, format: [{ width: recovered ? 600 : 64, height: recovered ? 800 : 80 }] });
    if (path === 'thumbnails') return json({data:[{uri:'https://media.fbcdn.net/invented-frame.jpg',width:recovered?600:64,height:recovered?800:80}]});
    if (path === 'insights') return json({ data: [] });
    if (url.hostname === 'media.fbcdn.net') return new Response(path === 'invented-large.jpg' ? large : small, { headers: { 'content-type': 'image/jpeg' } });
    throw new Error('Unexpected invented read');
  }) as typeof fetch };
  const run = async (hour: number) => {
    paths.length = 0; info.length = 0;
    const client = new MetaCreativeClient(new MetaSpend('invented-retry-key', options), options);
    await new CreativeWorker(db, client).run(account, settings, atHour(hour));
  };
  await db.query('INSERT INTO pulse.creative_jobs(account_id,backfill_done,nightly_day) VALUES($1,true,$2)', [account, '2026-10-14']);
  await run(0);
  const original = (await db.query<any>('SELECT * FROM pulse.media_groups WHERE account_id=$1', [account])).rows[0]!;
  const groupId = original.id;
  assert.equal((await db.query('SELECT * FROM pulse.media_groups')).rowCount, 1);
  assert.equal(paths.filter(path => path.startsWith('invented-creative-')).length, 1, 'Two ads share one reduced media group');
  assert.deepEqual(new Uint8Array(original.thumbnail), small);
  assert.equal(new Date(original.detail_reduced_at).toISOString(), started.toISOString());
  assert.deepEqual(info, ['1 creatives read at reduced detail']);
  assert.equal((await creativeHealth(db, settings, { META_ACCESS_TOKEN: inventedCredential }, started)).reducedCount, 1);

  await saveInsights(db, account, historic.day, historic.day, [historic], started);
  await db.query(`INSERT INTO pulse.media_attributes(id,mode,account_id,media_group_id,attribute_key,value,source,recorded_at)
    VALUES('invented-will-tag','live',$1,$2,'hookType','"unboxing"','will',$3)`, [account, groupId, started]);
  const savedAd = (await db.query<any>('SELECT * FROM pulse.ads WHERE ad_id=$1', [historic.adId])).rows[0]!;
  const parent: CatalogueEntry = { ad: { ...savedAd, id: 'invented-parent-ad', accountId: account, name: 'Invented parent ad', status: 'PAUSED', effectiveStatus: 'PAUSED',
    createdAt: started.toISOString(), adSetId: 'invented-set', adSetName: 'Invented UK set', campaignId: 'invented-campaign', campaignName: 'Invented UK campaign',
    owner: 'unassigned', market: 'uk', creativeId: 'invented-parent-creative', creativeType: 'video', body: '', title: '', callToAction: '', linkUrl: null,
    utmContent: null, lastSeen: started.toISOString(), facebookUrl: null, instagramUrl: null, objectStoryId: null, instagramMediaId: null },
    media: { id: 'invented-parent-group', kind: 'video', key: 'invented-parent-video', title: 'Invented distinct parent', lengthSeconds: 60, width: 600, height: 800,
      firstSeen: started.toISOString(), thumbnail: large, poster: large, frames: [], alternates: [] } };
  await saveCatalogue(db, account, [parent], started);
  await mergeMediaGroups(db, account, groupId, 'invented-parent-group', 'invented-actor', started);
  const snapshots = async () => ({ tags: (await db.query("SELECT * FROM pulse.media_attributes WHERE source='will'")).rows,
    insights: (await db.query('SELECT * FROM pulse.ad_insights_daily WHERE day=$1', [historic.day])).rows,
    merges: (await db.query('SELECT * FROM pulse.media_merges')).rows });
  const preserved = await snapshots();
  listedName = 'Invented refreshed ad'; listedCopy = 'Invented ignored list copy';
  await run(23);
  assert.equal(paths.filter(path => path.startsWith('invented-creative-')).length, 0);
  assert.deepEqual(info, ['1 creatives read at reduced detail']);

  await run(25);
  assert.equal(paths.filter(path => path.startsWith('invented-creative-')).length, 1, 'A repeated refusal is attempted once for the shared group');
  assert.equal(paths.filter(path => path === 'invented-video' || path.endsWith('.jpg')).length, 0, 'A repeated refusal returns only the list refresh');
  let group = (await db.query<any>('SELECT * FROM pulse.media_groups WHERE id=$1', [groupId])).rows[0]!;
  assert.equal(new Date(group.detail_reduced_at).toISOString(), started.toISOString());
  assert.equal(new Date(group.detail_retry_after).toISOString(), atHour(49).toISOString());
  assert.deepEqual(new Uint8Array(group.thumbnail), small);
  const refusedAd = (await db.query<any>('SELECT * FROM pulse.ads WHERE ad_id=$1', [historic.adId])).rows[0]!;
  assert.equal(refusedAd.name, listedName); assert.equal(refusedAd.body, 'Invented original copy');
  assert.deepEqual(await snapshots(), preserved);
  await run(25.5);
  assert.equal(paths.filter(path => path.startsWith('invented-creative-')).length, 0, 'Retaining the first refusal time must not cause a retry every half hour');

  recovered = true;
  await run(50);
  assert.equal(paths.filter(path => path.startsWith('invented-creative-')).length, 1);
  group = (await db.query<any>('SELECT * FROM pulse.media_groups WHERE id=$1', [groupId])).rows[0]!;
  assert.equal(group.id, groupId); assert.equal(group.merged_into_id, 'invented-parent-group');
  assert.deepEqual(new Uint8Array(group.thumbnail), large); assert.deepEqual(new Uint8Array(group.poster), large);
  assert.equal(Number(group.width), 600); assert.equal(Number(group.height), 800); assert.equal(Number(group.length_seconds), 14);
  assert.equal(group.detail_reduced_at, null); assert.equal(group.detail_retry_after, null);
  assert.deepEqual(await snapshots(), preserved);
  assert.equal((await db.query<any>('SELECT media_group_id FROM pulse.ads WHERE ad_id=$1', [historic.adId])).rows[0]!.media_group_id, groupId);
  assert.deepEqual(info, []); assert.deepEqual(errors, []);
  assert.equal((await creativeHealth(db, settings, { META_ACCESS_TOKEN: inventedCredential }, atHour(50))).reducedCount, 0);

  // A newly revealed key upgrades its original row, rather than orphaning its tags and merges.
  await saveCatalogue(db, account, [{ ...parent, retryGroupId: groupId, ad: { ...parent.ad, id: historic.adId, creativeId: 'invented-creative-first' },
    media: { ...parent.media, key: 'invented-revealed-video', title: 'Invented revealed video', detailReducedAt: null } }], atHour(51));
  assert.equal((await db.query<any>('SELECT media_key FROM pulse.media_groups WHERE id=$1', [groupId])).rows[0]!.media_key, 'invented-revealed-video');
  assert.deepEqual(await snapshots(), preserved);

  // Reduced counts and scan attempts cannot cross the current mode/account.
  await db.query('UPDATE pulse.media_groups SET detail_reduced_at=$2 WHERE id=$1', ['invented-parent-group', started]);
  assert.equal(await reducedDetailCount(db, account), 1);
  assert.equal(await reducedDetailCount(db, account, 'sample'), 0);
  assert.equal(await reducedDetailCount(db, 'invented-other-account'), 0);
  const scanSql = `INSERT INTO pulse.creative_scans(id,mode,account_id,media_group_id,model_id,status,raw_response,requested_at,finished_at)
    VALUES($1,$2,$3,$4,'invented-model','done',$5,$6,$6)`;
  await db.query(scanSql, ['invented-scan','live',account,groupId,'x'.repeat(20_480),started]);
  await assert.rejects(db.query(scanSql, ['invented-too-large','live',account,groupId,'é'.repeat(10_241),started]));
  await assert.rejects(db.query(scanSql, ['invented-wrong-scope','sample',account,groupId,'',started]));
});
