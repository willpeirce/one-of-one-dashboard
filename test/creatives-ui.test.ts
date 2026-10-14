import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Auth } from '../src/auth.js';
import { readRuntime } from '../src/runtime.js';
import { defaultSettings, readSettings, saveSettings } from '../src/settings.js';
import type { CreativeReader } from '../src/creatives/model.js';
import type { CreativeSheet, CreativeView } from '../src/creatives/presentation-types.js';
import { buildCreativeSheet, buildCreativeView, registerCreatives } from '../src/creatives/routes.js';
import { sampleCreativeData } from '../src/creatives/sample.js';
import { adsManagerLink, creativeCardsHtml, creativePanelHtml, creativeSheetHtml, safeCreativeLink } from '../src/creatives/view.js';
import { createTestDatabase } from './helpers/database.js';
import { creativeAd, creativeGroup, creativeInsight } from './helpers/creatives.js';
import { saveCatalogue, saveInsights } from '../src/creatives/store.js';
import { frequencyMembershipKey } from '../src/creatives/frequency.js';

const account = '424242';
const storedImage = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x49, 0x4e, 0x56, 0xff, 0xd9]);

async function harness(t: TestContext, live = false) {
  const db = await createTestDatabase();
  const config = readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_creatives_test', APP_ORIGIN: 'https://pulse.example.test' });
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const auth = await Auth.create(db, config);
  const credential = randomBytes(32).toString('base64url');
  const token = randomBytes(32).toString('base64url');
  const secret = (await db.query<{ value: Uint8Array }>("SELECT value FROM pulse_private.app_secrets WHERE name = 'session_hmac'")).rows[0]!;
  await db.query('INSERT INTO pulse_private.credentials(id, public_key) VALUES ($1, $2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash, credential_id, expires_at) VALUES ($1, $2, now() + interval '30 days')",
    [createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex'), credential]);
  const settings = await readSettings(db);
  await saveSettings(db, { ...settings, values: { ...settings.values, metaAdAccountId: account } }, credential);
  let now = new Date('2026-10-13T11:00:00Z');
  let signedUrl = 'https://video.example.test/invented.mp4?signature=invented-expiring-signature';
  let refused = false;
  let sourceReads = 0;
  let imageReads = 0;
  const inventedToken = randomBytes(24).toString('hex');
  const reader: CreativeReader = {
    async readCatalogue() { return []; }, async readInsights() { return []; },
    async videoSource() { sourceReads++; if (refused) throw new Error(`Refused ${inventedToken}`); return signedUrl; },
    async imageBytes() { imageReads++; return storedImage; }, async videoFrames() { return []; },
  };
  registerCreatives(app, db, auth, live ? { META_ACCESS_TOKEN: inventedToken } : {}, () => now,
    async () => ({ count: 9, mode: 'sample' as const }), async () => {}, reader);
  t.after(async () => { await app.close(); await db.close(); });
  const headers = { cookie: `__Host-pulse_session=${token}`, origin: config.origin, 'content-type': 'application/json' };
  return { app, db, headers, inventedToken, credential,
    setNow(value: Date) { now = value; }, refuse() { refused = true; }, setSignedUrl(value: string) { signedUrl = value; },
    sourceReads: () => sourceReads, imageReads: () => imageReads };
}

test('creative links are rendered only when buildable and never carry credentials', () => {
  assert.equal(adsManagerLink('', '101'), null);
  assert.equal(adsManagerLink(account, 'sample-ad'), null);
  assert.equal(adsManagerLink('act_424242', '101'), 'https://adsmanager.facebook.com/adsmanager/manage/ads?act=424242&selected_ad_ids=101');
  for (const unsafe of ['javascript:alert(1)', 'http://example.test/post', 'https://user:pass@example.test/post',
    'https://example.test/post?access_token=invented', 'https://example.test/post?authorization=invented']) {
    assert.equal(safeCreativeLink(unsafe), null);
  }
  assert.equal(safeCreativeLink('https://www.instagram.com/p/invented/'), 'https://www.instagram.com/p/invented/');
});

test('missing exact frequency is visible on the panel and sheet without a healthy fading claim', async () => {
  const settings = defaultSettings(), today = '2026-10-13';
  const data = sampleCreativeData(settings, new Date(`${today}T12:00:00Z`));
  data.mode = 'live'; data.frequencyReads = [];
  for (const row of data.insights) row.linkClicks = 40;
  const view = buildCreativeView(data, settings, today);
  assert.ok(view.performance.frequencyUnavailable > 0);
  const panel = creativePanelHtml(view);
  assert.match(panel, /frequency report pending or unavailable/);
  assert.doesNotMatch(panel, /Nothing fading|daily reach proxy/);
  const sheet = await buildCreativeSheet(data, settings, today, 'sample-video-2', {}, async () => ({ count: 9, mode: 'live' }));
  assert.ok(sheet);
  assert.match(creativeSheetHtml(sheet), /Seven-day Meta frequency report pending or unavailable/);
  assert.doesNotMatch(creativeSheetHtml(sheet), /summed daily reach/);
});

test('stored creative media and video redirects require a signed-in session; refusals do not expose the Meta token', async t => {
  const h = await harness(t, true);
  for (const [id, kind] of [['invented-image', 'image'], ['invented-video', 'video']] as const) {
    await h.db.query(`INSERT INTO pulse.media_groups
      (id,mode,source_id,account_id,kind,media_key,title,first_seen,fetched_at,thumbnail)
      VALUES ($1,'live',$1,$2,$3,$1,'Invented purple picture',$4,$4,$5)`, [id, account, kind, '2026-10-13T11:00:00Z', storedImage]);
  }
  await h.db.query(`INSERT INTO pulse.ads
    (mode,source_id,account_id,ad_id,name,status,effective_status,created_at,ad_set_id,ad_set_name,campaign_id,campaign_name,
      owner,market,creative_id,creative_type,media_group_id,body,title,call_to_action,last_seen,fetched_at)
    VALUES ('live','101',$1,'101','Invented clip ad','ACTIVE','ACTIVE',$2,'202','Invented UK set','303','Invented campaign',
      'ours','uk','404','video','invented-video','Invented copy','Invented clip','SHOP_NOW',$2,$2)`, [account, '2026-10-13T11:00:00Z']);
  await h.db.query(`INSERT INTO pulse.media_groups
    (id,mode,source_id,account_id,kind,media_key,title,first_seen,fetched_at,thumbnail)
    VALUES ('other-account-image','live','other-account-image','989898','image','other-account-image','Invented other account',$1,$1,$2)`,
    ['2026-10-13T11:00:00Z', storedImage]);
  assert.equal((await h.app.inject('/api/creatives')).statusCode, 401);
  assert.equal((await h.app.inject('/creatives')).headers.location, '/login');
  for (const path of ['/media/invented-image', '/media/invented-video?play=1']) {
    assert.equal((await h.app.inject(path)).statusCode, 401);
  }
  assert.equal(h.sourceReads(), 0, 'A signed-out video request never calls Meta');
  assert.equal((await h.app.inject({ url: '/media/other-account-image', headers: h.headers })).statusCode, 404);
  assert.equal((await h.app.inject({ url: '/api/creatives/other-account-image', headers: h.headers })).statusCode, 404);
  const thumbnail = await h.app.inject({ url: '/media/invented-image', headers: h.headers });
  assert.equal(thumbnail.statusCode, 200);
  assert.match(String(thumbnail.headers['content-type']), /^image\//);
  assert.deepEqual(thumbnail.rawPayload, storedImage);
  for (let read = 0; read < 2; read++) {
    const full = await h.app.inject({ url: '/media/invented-image?full=1', headers: h.headers });
    assert.equal(full.statusCode, 200);
    assert.deepEqual(full.rawPayload, storedImage);
  }
  assert.equal(h.imageReads(), 1, 'A full image is fetched on request and served from the cache afterwards');
  const playing = await h.app.inject({ url: '/media/invented-video?play=1', headers: h.headers });
  assert.equal(playing.statusCode, 302);
  assert.equal(playing.headers.location, 'https://video.example.test/invented.mp4?signature=invented-expiring-signature');
  assert.equal(h.sourceReads(), 1);
  assert.ok(!JSON.stringify({ headers: playing.headers, body: playing.body }).includes(h.inventedToken));
  const stored = await h.db.query<{ data: string }>("SELECT row_to_json(media_groups)::text AS data FROM pulse.media_groups WHERE id='invented-video'");
  assert.doesNotMatch(stored.rows[0]!.data, /invented-expiring-signature/);
  h.setSignedUrl(`https://video.example.test/invented.mp4?access_token=${h.inventedToken}`);
  const unsafe = await h.app.inject({ url: '/media/invented-video?play=1', headers: h.headers });
  assert.equal(unsafe.statusCode, 403);
  assert.equal(unsafe.headers.location, undefined);
  assert.ok(!unsafe.body.includes(h.inventedToken));
  h.refuse();
  const logs: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logs.push(args.map(String).join(' ')));
  const refused = await h.app.inject({ url: '/media/invented-video?play=1', headers: h.headers });
  assert.equal(refused.statusCode, 403);
  assert.match(refused.body, /Meta would not give the video/);
  assert.match(refused.body, /adsmanager\.facebook\.com/);
  assert.ok(!JSON.stringify({ headers: refused.headers, body: refused.body, logs }).includes(h.inventedToken));
});

test('a sheet omits refused and unsafe social links and places a buildable Ads Manager link last', async () => {
  const settings = { ...defaultSettings(), metaAdAccountId: account };
  const data = sampleCreativeData(settings, new Date('2026-10-13T12:00:00Z'));
  data.mode = 'live';
  const ad = data.ads[0]!;
  ad.id = '101'; ad.accountId = account;
  ad.instagramUrl = 'https://www.instagram.com/p/invented/';
  ad.facebookUrl = 'https://www.facebook.com/invented?access_token=do-not-render';
  const sheet = await buildCreativeSheet(data, settings, '2026-10-13', ad.mediaGroupId, { window: '3d' }, async () => ({ count: 9, mode: 'sample' }));
  assert.ok(sheet);
  assert.deepEqual(sheet.links.map(link => link.label), ['Instagram', 'Ads Manager']);
  assert.equal(sheet.links.at(-1)!.url, adsManagerLink(account, ad.id));
  assert.doesNotMatch(creativeSheetHtml(sheet), /do-not-render|>Facebook<\/a>/);
  ad.instagramUrl = null; settings.metaAdAccountId = '';
  const withoutLinks = await buildCreativeSheet(data, settings, '2026-10-13', ad.mediaGroupId, {}, async () => ({ count: 9, mode: 'sample' }));
  assert.deepEqual(withoutLinks!.links, []);
});

test('sample sheets show the account comparison and only available post links, with an Ads Manager fallback', async t => {
  const h = await harness(t);
  const response = await h.app.inject({ url: '/api/creatives', headers: h.headers });
  assert.equal(response.statusCode, 200);
  const view = response.json<CreativeView>();
  const row = view.groups.find(group => group.group.kind === 'video')!;
  assert.ok(row);
  const detail = await h.app.inject({ url: `/api/creatives/${encodeURIComponent(row.group.id)}?window=3d`, headers: h.headers });
  assert.equal(detail.statusCode, 200);
  const sheet = detail.json<CreativeSheet>();
  const manager = adsManagerLink(account, '101')!;
  sheet.links = [{ label: 'Instagram', url: 'https://www.instagram.com/p/invented/' }, { label: 'Ads Manager', url: manager }];
  const html = creativeSheetHtml(sheet);
  assert.match(html, /<video[^>]*playsinline[^>]*src="\/media\/[^\"]+\?play=1"/);
  assert.match(html, /Meta says \d[\d,]* purchases in this window; Shopify saw 9 orders in the same window/);
  assert.match(html, /Meta would not give the video; <a[^>]*>open in Ads Manager/);
  assert.match(html, />Instagram<\/a>/);
  assert.doesNotMatch(html, />Facebook<\/a>/);
  assert.doesNotMatch(html, /preview_shareable_link|adspreview|Scan now/);
  assert.equal(sheet.windows.length, 4);
  assert.deepEqual(sheet.windows.map(window => window.window), ['24h', '3d', '7d', 'lifetime']);
});

test('sample Watch and Decide cards render; snoozing a Watch persists for exactly seven days', async t => {
  const h = await harness(t);
  const read = async () => (await h.app.inject({ url: '/api/creatives', headers: h.headers })).json<CreativeView>();
  const before = await read();
  const watch = before.cards.find(card => card.kind === 'watch')!;
  assert.ok(watch);
  assert.ok(before.cards.some(card => card.kind === 'decide'));
  const html = creativeCardsHtml(before.cards);
  assert.match(html, /Snooze 7 days/);
  assert.match(html, /Make more like this/);
  assert.match(html, /<img/);
  assert.match(creativePanelHtml(before), /New this week.*of 7/);
  const snooze = await h.app.inject({ method: 'POST', url: '/api/creatives/cards', headers: h.headers,
    payload: { cardId: watch.id, action: 'snooze' } });
  assert.equal(snooze.statusCode, 200);
  assert.ok(!(await read()).cards.some(card => card.id === watch.id));
  const state = await h.db.query<{ snoozed_until: Date | string; updated_by: string }>(
    'SELECT snoozed_until,updated_by FROM pulse.creative_card_states WHERE card_id=$1', [watch.id]);
  assert.equal(new Date(state.rows[0]!.snoozed_until).toISOString(), '2026-10-20T11:00:00.000Z');
  assert.equal(state.rows[0]!.updated_by, h.credential);
  h.setNow(new Date('2026-10-20T10:59:59Z'));
  assert.ok(!(await read()).cards.some(card => card.id === watch.id));
  h.setNow(new Date('2026-10-20T11:00:00Z'));
  assert.ok((await read()).cards.some(card => card.id === watch.id));
});


test('a UK-only fading Watch accepts Done and Snooze even while whole-account frequency is healthy', async t => {
  const h = await harness(t, true);
  const group = creativeGroup('invented-shared-parent');
  const ads = [
    creativeAd('invented-uk-ad', group.id, { accountId: account, campaignId: '811', campaignName: 'Invented UK campaign' }),
    creativeAd('invented-us-ad', group.id, { accountId: account, campaignId: '812', campaignName: 'Invented US campaign', adSetName: 'Invented US set', market: 'us' }),
  ];
  await saveCatalogue(h.db, account, ads.map(ad => ({ ad, media: {
    ...group, thumbnail: storedImage, poster: storedImage, frames: [],
  } })), new Date('2026-10-13T11:00:00Z'));
  const addDays = async (first: number, last: number) => {
    const rows = Array.from({ length: last - first + 1 }, (_, index) => first + index).flatMap(day => ads.map(ad =>
      creativeInsight(ad.id, { adSetId: ad.adSetId, day: `2026-10-${String(day).padStart(2, '0')}` })));
    await saveInsights(h.db, account, rows[0]!.day, rows.at(-1)!.day, rows, new Date('2026-10-13T11:00:00Z'));
  };
  const frequencies = async (from: string, to: string) => {
    for (const [ids, frequency] of [[ads.map(ad => ad.id), 2], [[ads[0]!.id], 3.4]] as const) {
      await h.db.query(`INSERT INTO pulse.creative_frequencies(account_id,membership_key,ad_ids,from_day,to_day,frequency,fetched_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [account, frequencyMembershipKey(ids), JSON.stringify(ids), from, to, frequency, `${to}T10:00:00Z`]);
    }
  };
  const read = async (market = 'all') => (await h.app.inject({ url: `/api/creatives?market=${market}`, headers: h.headers })).json<CreativeView>();
  const cardId = `fading:${group.id}`;
  const act = async (action: string, id = cardId) => h.app.inject({ method: 'POST', url: '/api/creatives/cards', headers: h.headers, payload: { cardId: id, action } });
  await addDays(1, 13);
  await frequencies('2026-10-07', '2026-10-13');
  assert.equal((await read()).cards.length, 0, 'The deduplicated whole-account audience is healthy');
  assert.ok((await read('uk')).cards.some(card => card.id === cardId));
  assert.equal((await act('done')).statusCode, 200);
  assert.ok(!(await read('uk')).cards.some(card => card.id === cardId));
  assert.equal((await act('undo')).statusCode, 200);
  assert.ok((await read('uk')).cards.some(card => card.id === cardId));
  assert.equal((await act('snooze')).statusCode, 200);
  assert.ok(!(await read('uk')).cards.some(card => card.id === cardId));
  assert.equal((await act('done', 'fading:invented-other-account-parent')).statusCode, 400);
  const stored = (await h.db.query<{ snoozed_until: Date | string }>('SELECT snoozed_until FROM pulse.creative_card_states WHERE card_id=$1', [cardId])).rows[0]!;
  assert.equal(new Date(stored.snoozed_until).toISOString(), '2026-10-20T11:00:00.000Z');
  await addDays(14, 20);
  await frequencies('2026-10-14', '2026-10-20');
  h.setNow(new Date('2026-10-20T10:59:59Z'));
  assert.ok(!(await read('uk')).cards.some(card => card.id === cardId));
  h.setNow(new Date('2026-10-20T11:00:00Z'));
  assert.ok((await read('uk')).cards.some(card => card.id === cardId));
});


test('every creative sheet explains UK-day counts and Meta account-day reach and frequency', async () => {
  const settings = defaultSettings();
  const data = sampleCreativeData(settings, new Date('2026-10-13T12:00:00Z'));
  for (const mode of ['sample', 'live'] as const) {
    data.mode = mode;
    for (const id of ['sample-video-1', 'sample-image-1']) {
      const sheet = await buildCreativeSheet(data, settings, '2026-10-13', id, {}, async () => ({ count: 9, mode }));
      assert.ok(sheet);
      const html = creativeSheetHtml(sheet);
      assert.match(html, /data-creative-day-boundaries/);
      assert.match(html, /Spend, impressions, clicks, purchases, purchase value and video-play counts use UK days/);
      assert.match(html, /hourly reports are aligned to Europe\/London/);
      assert.match(html, /Reach, frequency and average play time keep Meta account days, including the separate seven-day frequency report/);
      assert.match(html, /For a GMT account during British Summer Time, those day boundaries differ by one hour/);
      assert.match(html, /24h means the last complete UK day plus today so far/);
    }
  }
});
