import assert from 'node:assert/strict';
import {createHmac, randomBytes} from 'node:crypto';
import test, {type TestContext} from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import {Auth} from '../src/auth.js';
import {readRuntime} from '../src/runtime.js';
import {readSettings, saveSettings} from '../src/settings.js';
import type {Database} from '../src/db.js';
import type {CreativeReader} from '../src/creatives/model.js';
import type {CreativeLibrary, CreativeSelection} from '../src/creatives/presentation-types.js';
import {buildCreativeSheet, buildCreativeView, registerCreatives} from '../src/creatives/routes.js';
import {readLiveCreativeData} from '../src/creatives/store.js';
import {creativeGalleryHtml} from '../src/creatives/view.js';
import {createTestDatabase} from './helpers/database.js';

const now = new Date('2034-07-18T12:00:00Z'), today = '2034-07-18', account = '120000000000090001';

/** Entirely invented, bulk seeded so the 6,000-ad regression stays inexpensive. */
async function seedLibrary(db: Database, groupCount = 300, adsPerGroup = 20): Promise<void> {
  const groups = Array.from({length: groupCount}, (_, index) => ({id: `invented-group-${String(index).padStart(3, '0')}`,
    kind: index % 2 ? 'image' : 'video', title: `Invented scene ${index + 1}`,
    first_seen: `2034-07-${String(index % 17 + 1).padStart(2, '0')}T09:00:00Z`}));
  const ads = groups.flatMap((group, index) => Array.from({length: adsPerGroup}, (_, position) => ({
    id: String(120000000000000n + BigInt(index * adsPerGroup + position)), group_id: group.id,
    name: `Invented ad ${index + 1}-${position + 1}`, kind: group.kind,
    ad_set_id: `invented-set-${index}-${position % 4}`, ad_set_name: `Invented ${position % 2 ? 'US' : 'UK'} set`,
    campaign_id: String(910001 + index % 3), campaign_name: `Invented ${position % 2 ? 'US' : 'UK'} campaign`,
    owner: ['ours', 'freelancer', 'unassigned'][index % 3], market: position % 2 ? 'us' : 'uk',
    status: position % 4 ? 'ACTIVE' : 'PAUSED',
    body: `Invented copy for scene ${index + 1}, variation ${position + 1}. ` + 'An invented kit shown in a studio. '.repeat(12),
  })));
  await db.transaction(async tx => {
    await tx.query(`INSERT INTO pulse.media_groups(id,mode,source_id,account_id,kind,media_key,title,
      length_seconds,width,height,first_seen,fetched_at)
      SELECT id,'live',id,$1,kind,id,title,CASE WHEN kind='video' THEN 12 ELSE NULL END,600,800,first_seen,$3
      FROM jsonb_to_recordset($2::jsonb) AS x(id text,kind text,title text,first_seen timestamptz)`,
    [account, JSON.stringify(groups), now]);
    await tx.query(`INSERT INTO pulse.ads(mode,source_id,account_id,ad_id,name,status,effective_status,created_at,
      ad_set_id,ad_set_name,campaign_id,campaign_name,owner,market,creative_id,creative_type,media_group_id,
      body,title,call_to_action,first_spend_day,last_seen,fetched_at)
      SELECT 'live',id,$1,id,name,status,status,$3,ad_set_id,ad_set_name,campaign_id,campaign_name,owner,market,
        'invented-creative-'||id,kind,group_id,body,'Invented kit','SHOP_NOW',$4::date,$3,$3
      FROM jsonb_to_recordset($2::jsonb) AS x(id text,group_id text,name text,kind text,ad_set_id text,ad_set_name text,
        campaign_id text,campaign_name text,owner text,market text,status text,body text)`,
    [account, JSON.stringify(ads), now, today]);
    await tx.query(`INSERT INTO pulse.ad_insights_daily(mode,source_id,account_id,ad_id,ad_set_id,day,spend,
      impressions,reach,frequency,link_clicks,three_second_plays,three_second_source,plays,thru_plays,
      plays_25,plays_50,plays_75,plays_100,average_play_time,adds_to_cart,purchases,purchase_value,fetched_at)
      SELECT 'live',ad_id,$1,ad_id,ad_set_id,$2,4,100,80,1.25,10,30,'video_view',40,20,30,25,20,15,4,3,1,16,$3
      FROM pulse.ads WHERE mode='live' AND account_id=$1`, [account, today, now]);
  });
}

async function harness(t: TestContext, groupCount = 300, adsPerGroup = 20) {
  const db = await createTestDatabase(), app = Fastify({logger: false});
  t.after(async () => {await app.close(); await db.close();});
  await app.register(cookie);
  const config = readRuntime({DATABASE_URL: 'postgresql://localhost/invented_library', APP_ORIGIN: 'https://pulse.example.test'});
  const auth = await Auth.create(db, config);
  const credential = randomBytes(32).toString('base64url'), token = randomBytes(32).toString('base64url');
  const secret = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex'), credential]);
  const original = await readSettings(db);
  const {values: settings} = await saveSettings(db, {...original, values: {...original.values,
    metaAdAccountId: account, metaOwners: [{campaignId: '910001', owner: 'ours'}, {campaignId: '910002', owner: 'freelancer'}]}}, credential);
  await seedLibrary(db, groupCount, adsPerGroup);
  let sourceCalls = 0, dataReads = 0;
  const forbidden = async (): Promise<never> => {sourceCalls++; throw new Error('A stored Library read must not call a source');};
  const reader: CreativeReader = {readCatalogue: async function* () {await forbidden();}, readInsights: forbidden,
    imageBytes: forbidden, videoFrames: forbidden, videoSource: forbidden};
  const routeDb: Database = {...db, query: (sql, values) => {
    if (/FROM pulse\.(ads|media_groups)\b/.test(sql)) dataReads++;
    return db.query(sql, values);
  }};
  registerCreatives(app, routeDb, auth, {META_ACCESS_TOKEN: randomBytes(24).toString('hex')}, () => now,
    async () => ({count: null, mode: 'live'}), async () => {}, reader);
  const headers = {cookie: `__Host-pulse_session=${token}`};
  return {app, db, settings, headers, sourceCalls: () => sourceCalls, dataReads: () => dataReads};
}

test('300 groups of 20 ads keep the first Library response below 300 KB without changing its order, filters or counts', async t => {
  const h = await harness(t), {app, db, settings, headers} = h;
  assert.equal((await app.inject('/api/creatives')).statusCode, 401);
  const response = await app.inject({url: '/api/creatives', headers});
  assert.equal(response.statusCode, 200);
  const bytes = Buffer.byteLength(response.body, 'utf8');
  assert.ok(bytes < 300_000, `The initial response is ${bytes} bytes; its limit is 300,000`);
  const view = response.json<CreativeLibrary>();
  assert.equal(view.groups.length, 300);
  assert.equal((await db.query('SELECT 1 FROM pulse.ads WHERE account_id=$1', [account])).rowCount, 6000);
  for (const group of [...view.groups, ...view.top.groups]) assert.equal(Object.hasOwn(group, 'ads'), false);
  assert.doesNotMatch(response.body, /Invented copy for scene/, 'No per-ad copy reaches the initial response');
  const data = await readLiveCreativeData(db, settings);
  const full = buildCreativeView(data, settings, today, {}, [], []);
  const fullBytes = Buffer.byteLength(JSON.stringify(full), 'utf8');
  assert.ok(fullBytes > 3_000_000, 'The fixture exercises the previous several-megabyte response');
  assert.deepEqual(view.groups.map(row => row.group.id), full.groups.map(row => row.group.id));
  assert.deepEqual(view.performance, full.performance);
  assert.equal(creativeGalleryHtml(view), creativeGalleryHtml({...full, scan: view.scan}));
  for (const selection of [{owner: 'ours', market: 'us', kind: 'image', live: false}] as CreativeSelection[]) {
    const query = new URLSearchParams(Object.entries(selection).map(([key, value]) => [key, String(value)]));
    const filteredResponse = await app.inject({url: `/api/creatives?${query}`, headers});
    assert.equal(filteredResponse.statusCode, 200);
    const filtered = filteredResponse.json<CreativeLibrary>(), expected = buildCreativeView(data, settings, today, selection, [], []);
    assert.deepEqual(filtered.groups.map(row => row.group.id), expected.groups.map(row => row.group.id));
    assert.deepEqual(filtered.performance, expected.performance);
    assert.equal(creativeGalleryHtml(filtered), creativeGalleryHtml({...expected, scan: filtered.scan}));
  }
  assert.equal(h.sourceCalls(), 0);
  t.diagnostic(`Invented 300 × 20 Library fixture: initial ${bytes} bytes; full ${fullBytes} bytes.`);
});

test('Library ad details page only stored ads, authenticate first and reject stale or unbounded requests', async t => {
  const h = await harness(t, 1, 121), {app, db, settings, headers} = h;
  const groupId = 'invented-group-000';
  assert.equal((await app.inject(`/api/creatives/${groupId}/ads?offset=50&version=${'a'.repeat(43)}`)).statusCode, 401);
  assert.equal(h.dataReads(), 0, 'The signed-out request never reads the catalogue');
  const detail = await app.inject({url: `/api/creatives/${groupId}`, headers});
  assert.equal(detail.statusCode, 200);
  const sheet = detail.json<{ads: {id: string}[]; group: {ads: {id: string}[]};
    adPage: {total: number; adSetCount: number; nextOffset: number | null; version: string}}>();
  assert.equal(sheet.ads.length, 50); assert.equal(sheet.group.ads.length, 50);
  assert.equal(sheet.adPage.total, 121); assert.equal(sheet.adPage.adSetCount, 4); assert.equal(sheet.adPage.nextOffset, 50);
  assert.match(sheet.adPage.version, /^[A-Za-z0-9_-]{43}$/);
  const ids = sheet.ads.map(ad => ad.id);
  for (const [offset, count, next] of [[50, 50, 100], [100, 21, null]] as const) {
    const page = await app.inject({url: `/api/creatives/${groupId}/ads?offset=${offset}&version=${sheet.adPage.version}`, headers});
    assert.equal(page.statusCode, 200);
    const payload = page.json<{groupId: string; mode: string; accountId: string; ads: {id: string}[]; nextOffset: number | null; version: string}>();
    assert.equal(payload.ads.length, count); assert.equal(payload.nextOffset, next);
    assert.equal(payload.version, sheet.adPage.version); assert.equal(payload.groupId, groupId);
    assert.equal(payload.mode, 'live'); assert.equal(payload.accountId, account);
    ids.push(...payload.ads.map(ad => ad.id));
  }
  const data = await readLiveCreativeData(db, settings);
  const full = await buildCreativeSheet(data, settings, today, groupId, {}, async () => ({count: null, mode: 'live'}));
  assert.ok(full);
  assert.deepEqual(ids, full.ads.map(ad => ad.id), 'Every ad appears once, in the original full sheet order');
  assert.equal(new Set(ids).size, 121);
  for (const query of [`offset=-1&version=${sheet.adPage.version}`, `offset=1.5&version=${sheet.adPage.version}`,
    `offset=50&version=${sheet.adPage.version}&limit=999999`, `offset=50&version=${sheet.adPage.version}&extra=1`,
    `offset=150&version=${sheet.adPage.version}`, `offset=50&offset=100&version=${sheet.adPage.version}`,
    `offset=50&version=${sheet.adPage.version}&version=${sheet.adPage.version}`]) {
    assert.equal((await app.inject({url: `/api/creatives/${groupId}/ads?${query}`, headers})).statusCode, 400);
  }
  assert.equal((await app.inject({url: `/api/creatives/invented-missing/ads?offset=50&version=${sheet.adPage.version}`, headers})).statusCode, 404);
  await db.query(`INSERT INTO pulse.media_groups(id,mode,source_id,account_id,kind,media_key,title,first_seen,fetched_at)
    VALUES('invented-parent','live','invented-parent',$1,'video','invented-parent','Invented parent',$2,$2)`, [account, now]);
  await db.query("UPDATE pulse.media_groups SET merged_into_id='invented-parent' WHERE id=$1", [groupId]);
  assert.equal((await app.inject({url: `/api/creatives/${groupId}/ads?offset=50&version=${sheet.adPage.version}`, headers})).statusCode, 409,
    'A merged parent cannot continue the previous group page');
  await db.query('UPDATE pulse.media_groups SET merged_into_id=NULL WHERE id=$1', [groupId]);
  await db.query("UPDATE pulse.ads SET body='Changed invented copy' WHERE account_id=$1 AND ad_id=$2", [account, ids[0]]);
  assert.equal((await app.inject({url: `/api/creatives/${groupId}/ads?offset=50&version=${sheet.adPage.version}`, headers})).statusCode, 409,
    'A changed group cannot mix old and new pages');
  assert.equal(h.sourceCalls(), 0, 'Neither initial nor lazy Library reads call Meta');
});
