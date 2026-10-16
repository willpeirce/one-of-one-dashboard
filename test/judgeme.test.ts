import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { JudgeMeClient, JudgeMeReadError } from '../src/judgeme/client.js';
import { cleanReview, waitingReviews } from '../src/judgeme/model.js';
import { readReviews, saveReviews, readReviewHealth } from '../src/judgeme/store.js';
import { ReviewsWorker, REVIEW_POLL_MS } from '../src/judgeme/worker.js';
import { reviewLink, reviewsGreeting, reviewsPanelHtml, reviewSheetHtml } from '../src/judgeme/presentation.js';
import { sampleReviews } from '../src/judgeme/sample.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { dashboardPage } from '../src/dashboard-view.js';
import { sourceHealthPage } from '../src/views.js';
import { getSourceStates, readSourceHealth, syncSourceHealth } from '../src/sources.js';
import { createTestDatabase } from './helpers/database.js';
import { appConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { readRuntime } from '../src/runtime.js';
import { ShopifyWorker } from '../src/shopify/worker.js';
import { blankObservation, evaluateWatchdogs } from '../src/shopify/watchdogs.js';
import type { Facts } from '../src/shopify/metrics.js';
import { defaultSettings } from '../src/settings.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/judgeme/reviews.json', import.meta.url), 'utf8'));
const now = new Date('2026-09-30T12:00:00Z');
const token = () => randomBytes(24).toString('hex');

test('v1 review projection excludes identity and IP, filters moderation state, and puts low stars before newest', () => {
  const clean = fixture.reviews.map(cleanReview);
  assert.deepEqual(waitingReviews(clean).map(r => r.id), ['900101', '900102', '900103', '900107', '900106']);
  const serialized = JSON.stringify(clean);
  for (const privateValue of ['Invented Reviewer', 'reviewer@example.test', '203.0.113.8', 'phone', 'reviewer', 'ip_address']) assert.ok(!serialized.includes(privateValue));
  assert.equal(clean[0].market, null);
  assert.equal(clean[0].verifiedBuyer, true);
  assert.equal(clean[0].photoCount, 1);
  assert.equal(clean[3].published, true);
  assert.equal(clean[4].hidden, true);
  assert.equal(clean[5].hidden, false); assert.equal(clean[5].flagged, true);
});

test('GET-only client sends documented pagination/auth fields, walks all pages and drops raw fields', async () => {
  const credential = token(), calls: URL[] = [];
  const client = new JudgeMeClient(credential, { sleep: async () => {}, fetch: async (input, init) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
    assert.equal(url.origin, 'https://api.judge.me'); assert.equal(url.pathname, '/api/v1/reviews');
    assert.equal(url.searchParams.get('api_token'), credential);
    assert.equal(url.searchParams.get('shop_domain'), appConfig.shopify.storeDomain);
    assert.equal(url.searchParams.get('per_page'), '100');
    assert.equal(url.searchParams.has('published'), false);
    return Response.json({ current_page: calls.length, per_page: 100, reviews: calls.length === 1
      ? Array.from({ length: 100 }, (_, i) => ({ ...fixture.reviews[0], id: 901000 + i })) : [fixture.reviews[1]] });
  } });
  const { rows, unreadCount } = await client.reviews();
  assert.equal(unreadCount, 0);
  assert.equal(rows.length, 101); assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(u => u.searchParams.get('page')), ['1', '2']);
  assert.deepEqual(Object.getOwnPropertyNames(JudgeMeClient.prototype).sort(), ['constructor', 'reviews']);
  assert.doesNotMatch(JSON.stringify(rows), /Invented Reviewer|reviewer@example.test|203\.0\.113\.8/);
});

test('published and hidden use only their own explicit fields', () => {
  const waiting = cleanReview(fixture.reviews.find((r: any) => r.id === 900107))!;
  assert.equal(waiting.curated, 'ok'); assert.equal(waiting.published, false);
  assert.deepEqual(waitingReviews([waiting]).map(r => r.id), ['900107']);
  assert.equal(cleanReview({ ...fixture.reviews[0], published: true })!.published, true);
  assert.equal(cleanReview(fixture.reviews[0])!.published, false);
  assert.equal(cleanReview(fixture.reviews[3])!.published, true);
  for (const published of [null, 'false', 0]) assert.equal(cleanReview({ ...fixture.reviews[0], published }), null);
});

test('malformed JSON values and text unsupported by Postgres are unreadable without throwing', () => {
  for (const row of [null, 1, '', {},
    { ...fixture.reviews[0], curated: { toString: null, valueOf: null } },
    { ...fixture.reviews[0], curated: 'unexpected' },
    { ...fixture.reviews[0], pictures: null },
    { ...fixture.reviews[0], created_at: 'not a date' },
    { ...fixture.reviews[0], created_at: '0000-01-01T00:00:00Z' },
    ...['body', 'product_title', 'product_handle'].flatMap(field => ['\u0000', '\uD800', '\uDC00'].map(value =>
      ({ ...fixture.reviews[0], [field]: `Invented ${value} text` }))),
  ]) assert.equal(cleanReview(row), null);
  assert.equal(cleanReview({ ...fixture.reviews[0], body: 'Invented emoji review \uD83D\uDE00' })!.body, 'Invented emoji review \uD83D\uDE00');
});

test('bad rows are counted without truncating full pages, including an entirely unreadable page', async () => {
  let calls = 0;
  const client = new JudgeMeClient(token(), { sleep: async () => {}, fetch: async () => {
    calls++;
    return Response.json({ current_page: calls, reviews: calls === 1
      ? [null, ...Array.from({ length: 99 }, (_, i) => ({ ...fixture.reviews[0], id: 902000 + i }))]
      : calls === 2 ? Array.from({ length: 100 }, () => ({ private_field: 'Invented unreadable value' }))
      : [fixture.reviews[1]] });
  } });
  const result = await client.reviews();
  assert.equal(calls, 3); assert.equal(result.unreadCount, 101); assert.equal(result.rows.length, 100);
  assert.equal(result.rows.at(-1)!.id, '900102');
  assert.doesNotMatch(JSON.stringify(result), /private_field|Invented unreadable value/);
});

test('Retry-After seconds and dates cannot postpone a retry by more than 60 seconds', async () => {
  for (const retry of ['3600', new Date(Date.now() + 3_600_000).toUTCString(), '9'.repeat(400)]) {
    const waits: number[] = []; let calls = 0;
    const client = new JudgeMeClient(token(), { sleep: async ms => { waits.push(ms); }, fetch: async () => {
      calls++;
      return calls === 1 ? new Response('', { status: 429, headers: { 'retry-after': retry } }) : Response.json(fixture);
    } });
    assert.equal((await client.reviews()).unreadCount, 0);
    assert.deepEqual(waits, [60_000]);
  }
});

test('failing reads expose only fixed status/code diagnostics; URL, token and response errors never escape', async () => {
  const credential = token(), captured: unknown[] = [], waits: number[] = [];
  let requests = 0;
  const client = new JudgeMeClient(credential, { log: entry => captured.push(entry), sleep: async ms => { waits.push(ms); }, fetch: async input => {
    requests++;
    if (requests === 1) throw new Error(`Private URL ${String(input)}`);
    return new Response(JSON.stringify({ error: credential, request_url: String(input) }), { status: 503, headers: { 'retry-after': '2' } });
  } });
  await assert.rejects(client.reviews(), error => {
    assert.ok(error instanceof JudgeMeReadError); assert.equal(error.status, 503); assert.equal(error.code, 'http');
    assert.doesNotMatch(String(error), /https?:|api_token|shop_domain/); assert.ok(!String(error).includes(credential)); return true;
  });
  assert.equal(requests, 4, 'initial request plus three retries');
  assert.deepEqual(captured, [{ status: 0, code: 'network' }, ...Array.from({ length: 3 }, () => ({ status: 503, code: 'http' }))]);
  assert.deepEqual(waits, [1000, 2000, 4000]);
  const serialized = JSON.stringify(captured); assert.ok(!serialized.includes(credential)); assert.doesNotMatch(serialized, /http[s]?:|api_token|shop_domain/);
});

test('complete polls upsert panel-only fields, remove published/hidden/deleted rows and retain nothing identifying', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await syncSourceHealth(db, { JUDGEME_API_TOKEN: token() });
  await saveReviews(db, fixture.reviews.map(cleanReview), now);
  assert.deepEqual((await readReviews(db, now)).rows.map(r => r.id), ['900101', '900102', '900103', '900107', '900106']);
  const stored = JSON.stringify((await db.query('SELECT * FROM pulse.judgeme_reviews')).rows);
  assert.doesNotMatch(stored, /Invented Reviewer|reviewer@example.test|203\.0\.113\.8|reviewer|ip_address/);
  const next = fixture.reviews.map((r: any) => ({ ...r, ...(r.id === 900101 ? { published: true } : r.id === 900102 ? { hidden: true } : {}) }));
  await saveReviews(db, next.map(cleanReview), new Date(now.getTime() + REVIEW_POLL_MS));
  assert.deepEqual((await readReviews(db, now)).rows.map(r => r.id), ['900103', '900107', '900106']);
  await saveReviews(db, [], now);
  assert.equal((await db.query('SELECT * FROM pulse.judgeme_reviews')).rows.length, 0);
  assert.equal(reviewsGreeting(await readReviews(db, now)), 'All caught up');
});

test('live worker polls once per five minutes, shares in-flight runs and recovers without source writes', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const env = { JUDGEME_API_TOKEN: token() }; await syncSourceHealth(db, env);
  let clock = now, count = 0, fail = false;
  const logs: string[] = []; t.mock.method(console, 'error', (s: string) => logs.push(s));
  const worker = new ReviewsWorker(db, env, { clock: () => clock, sleep: async () => {}, fetch: async () => {
    count++; return fail ? new Response('private body', { status: 403 }) : Response.json(fixture);
  } });
  t.after(() => worker.stop());
  const first = worker.tick(); assert.equal(worker.tick(), first); await first;
  await worker.tick(); assert.equal(count, 1);
  let panel = await readReviews(db, clock); assert.equal(panel.status, 'live'); assert.equal(panel.rows.length, 5);
  clock = new Date(now.getTime() + REVIEW_POLL_MS); fail = true; await worker.tick();
  panel = await readReviews(db, clock); assert.equal(panel.status, 'unavailable'); assert.equal(panel.rows.length, 5);
  assert.deepEqual(logs, ['Judge.me poll failed (status: 403, code: http).']);
  clock = new Date(clock.getTime() + REVIEW_POLL_MS); await worker.tick();
  const failedHealth = await readSourceHealth(db);
  assert.equal(failedHealth.find(row => row.source === 'judgeme')!.consecutiveFailures, 2);
  const facts: Facts = { mode: 'live', sample: false, jobs: [], records: [], counts: {}, pendingWebhooks: 0, geoNotice: null, notices: [], noticeDetails: [] };
  assert.deepEqual(evaluateWatchdogs(facts, clock, defaultSettings(), blankObservation(), [], failedHealth),
    evaluateWatchdogs(facts, clock, defaultSettings(), blankObservation(), [], []), 'repeated review failures cannot change any watchdog or its alarm card');
  clock = new Date(clock.getTime() + REVIEW_POLL_MS); fail = false; await worker.tick();
  const health = (await readSourceHealth(db)).find(row => row.source === 'judgeme')!;
  assert.equal(health.status, 'healthy'); assert.equal(health.consecutiveFailures, 0);
  assert.match(sourceHealthPage([health]), />Live<\/td>/);
});

test('one bad row keeps good reviews live, logs only its count and clears one durable notice on a clean poll', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const env = { JUDGEME_API_TOKEN: token() }; await syncSourceHealth(db, env);
  const logs: string[] = []; t.mock.method(console, 'warn', (s: string) => logs.push(s));
  t.mock.method(console, 'error', () => {});
  let clock = now, fail = false, response = { ...fixture, reviews: [fixture.reviews[0],
    { ...fixture.reviews[2], curated: { toString: null, valueOf: null }, body: 'Invented unreadable value' }, fixture.reviews[1]] };
  const worker = new ReviewsWorker(db, env, { clock: () => clock, sleep: async () => {}, fetch: async () =>
    fail ? new Response('', { status: 403 }) : Response.json(response) });
  t.after(() => worker.stop());
  await worker.tick();
  let panel = await readReviews(db, clock);
  assert.equal(panel.status, 'live'); assert.equal(panel.unreadCount, 1);
  assert.deepEqual(panel.rows.map(r => r.id), ['900101', '900102']);
  assert.deepEqual(logs, ['Judge.me: 1 reviews could not be read.']);
  assert.equal((reviewsPanelHtml(panel).match(/data-review-notice/g) ?? []).length, 1);
  assert.match(reviewsPanelHtml(panel), /1 reviews could not be read/);
  assert.deepEqual((await db.query('SELECT unread_count FROM pulse.judgeme_sync')).rows, [{ unread_count: 1 }]);
  assert.doesNotMatch(JSON.stringify((await db.query('SELECT * FROM pulse.judgeme_reviews')).rows), /Invented unreadable value/);
  // A failed request does not clear the last partial-poll notice.
  clock = new Date(clock.getTime() + REVIEW_POLL_MS); fail = true; await worker.tick();
  assert.equal((await readReviews(db, clock)).unreadCount, 1);
  // A second partial poll updates good rows without deleting an unreadable cached row.
  clock = new Date(clock.getTime() + REVIEW_POLL_MS); fail = false;
  response = { ...fixture, reviews: [{ ...fixture.reviews[0], body: 'Invented \u0000 text' }, { ...fixture.reviews[1], rating: 4 }] };
  await worker.tick(); panel = await readReviews(db, clock);
  assert.deepEqual(panel.rows.map(r => r.id), ['900101', '900102']);
  assert.equal(panel.rows[1]!.rating, 4); assert.equal(panel.unreadCount, 1);
  assert.equal((reviewsPanelHtml(panel).match(/data-review-notice/g) ?? []).length, 1);
  clock = new Date(clock.getTime() + REVIEW_POLL_MS);
  response = { ...fixture, reviews: [fixture.reviews[1]] }; await worker.tick();
  panel = await readReviews(db, clock);
  assert.equal(panel.status, 'live'); assert.equal(panel.unreadCount, 0);
  assert.deepEqual(panel.rows.map(r => r.id), ['900102']);
  assert.doesNotMatch(reviewsPanelHtml(panel), /data-review-notice|reviews could not be read/);
  assert.deepEqual((await db.query('SELECT unread_count FROM pulse.judgeme_sync')).rows, [{ unread_count: 0 }]);
});

test('review polling starts only after listen and a failed poll cannot fail startup or health', async t => {
  const db = await createTestDatabase();
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let calls = 0;
  t.mock.method(console, 'error', () => {});
  t.mock.method(ShopifyWorker.prototype, 'start', () => {});
  const config = readRuntime({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/pulse_test', APP_ORIGIN: 'http://localhost:3000' });
  const env = { SHOPIFY_CLIENT_ID: token(), SHOPIFY_CLIENT_SECRET: token(), JUDGEME_API_TOKEN: token() };
  const app = await createApp(db, config, env, {}, {}, { sleep: async () => {}, fetch: async () => {
    calls++; entered(); await blocked; return new Response('', { status: 403 });
  } });
  t.after(async () => { release(); await app.close(); await db.close(); });
  assert.equal(calls, 0); await app.listen({ host: '127.0.0.1', port: 0 }); assert.equal(calls, 0);
  const background = app.startBackgroundWork(); await started;
  assert.equal((await app.inject('/health')).statusCode, 200);
  release(); await background;
  assert.equal((await app.inject('/health')).statusCode, 200);
});

test('without a token Judge.me waits for keys and its sample worker never reads externally', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); await syncSourceHealth(db, {});
  const worker = new ReviewsWorker(db, {}, { fetch: async () => { throw new Error('must not fetch'); } });
  worker.start(); await worker.tick(); await worker.stop();
  assert.equal(worker.mode, 'sample'); assert.equal(getSourceStates({}).find(s => s.source === 'judgeme')!.status, 'waiting_for_keys');
  const row = (await readSourceHealth(db)).find(s => s.source === 'judgeme')!;
  assert.match(sourceHealthPage([row]), /Waiting for keys/); assert.equal(row.lastAttemptAt, null);
});

test('every Open and Read action uses the final Judge.me reviews dashboard URL', () => {
  const panel = sampleReviews();
  assert.equal(reviewLink(), 'https://app.judge.me/index');
  for (const html of [reviewsPanelHtml(panel), ...panel.rows.map(row => reviewSheetHtml(row, panel))]) {
    const links = [...html.matchAll(/data-review-link href="([^"]+)"/g)];
    assert.ok(links.length > 0);
    for (const [, href] of links) assert.equal(href, 'https://app.judge.me/index');
  }
});

test('reviews share sample/live rendering, safely escape full text, disable Publish and supply greeting/empty state', () => {
  const panel = sampleReviews(), row = panel.rows[0]!;
  assert.equal(panel.publishEnabled, false); assert.equal(appConfig.judgeme.publishEnabled, false);
  assert.equal(reviewsGreeting(panel), '3 sample reviews, 1 needs reading first');
  const html = reviewsPanelHtml(panel), sheet = reviewSheetHtml(row, panel);
  assert.match(html, /id="review-publish"[^>]*disabled/); assert.match(html, /Verified buyer/); assert.match(html, /1 photo/);
  assert.ok(sheet.indexOf('Read in Judge.me') < sheet.indexOf('Open in Judge.me'));
  assert.equal((sheet.match(/data-review-link/g) ?? []).length, 2); assert.ok(sheet.includes(reviewLink()));
  assert.match(sheet, /Sample data/); assert.match(sheet, new RegExp(row.body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /data-state="alarm"|Not built yet|reviewer/);
  row.body = '<script>sample attack</script>'; assert.ok(!reviewSheetHtml(row, panel).includes(row.body));
  const live = { ...panel, mode: 'live' as const, status: 'live' as const };
  assert.equal(reviewsGreeting(live), '3 new reviews, 1 needs reading first');
  live.rows = []; assert.equal(reviewsGreeting(live), 'All caught up'); assert.doesNotMatch(reviewsPanelHtml(live), /class="rv"/);
  const dashboard = getSampleDashboard(); const rendered = dashboardPage(dashboard);
  assert.match(rendered, /data-review-open="900101"/); assert.match(rendered, /data-rv>3 sample reviews, 1 needs reading first/);
});

test('empty reviews use only the title chip and preserve pending, unavailable and unreadable states', () => {
  const empty = { ...sampleReviews(), mode: 'live' as const, rows: [], unreadCount: 0 };
  for (const [status, unreadCount, label] of [
    ['live', 0, 'All caught up'], ['pending', 0, 'Reviews: first sync pending'],
    ['unavailable', 0, 'Reviews unavailable'], ['live', 2, 'Some reviews could not be read'],
  ] as const) {
    const html = reviewsPanelHtml({ ...empty, status, unreadCount });
    assert.ok(html.includes(`class="chip info" id="rvcount">${label}</span>`));
    assert.match(html, /<div class="rvlist"><\/div>/);
    assert.doesNotMatch(html, /<p class="note">All caught up<\/p>/);
    assert.equal((html.match(/data-review-notice/g) ?? []).length, unreadCount ? 1 : 0);
  }
});


test('waiting reviews retain email flags last, use only explicit hidden/published fields and report source counts', async t => {
  const db=await createTestDatabase();t.after(()=>db.close());await syncSourceHealth(db,{JUDGEME_API_TOKEN:token()});
  const raw=[
    {...fixture.reviews[0],id:903001,published:true,curated:'ok'},
    {...fixture.reviews[0],id:903002,published:false,curated:'ok',rating:5,source:'web'},
    {...fixture.reviews[0],id:903003,published:false,curated:'spam',rating:1,source:'email'},
    {...fixture.reviews[0],id:903004,published:false,curated:'spam',hidden:true},
  ];
  const cleaned=raw.map(cleanReview).filter(r=>r!==null);assert.equal(cleaned.length,4);
  assert.deepEqual(waitingReviews(cleaned).map(r=>[r.id,r.flagged,r.source]),[['903002',false,'web'],['903003',true,'email']]);
  await saveReviews(db,cleaned,now);
  const panel=await readReviews(db,now);
  assert.deepEqual(panel.rows,waitingReviews(cleaned));
  const html=reviewsPanelHtml(panel);assert.match(html,/Flagged by Judge.me/);assert.match(html,/Email request/);assert.match(html,/>Web</);
  assert.equal((html.match(/Flagged by Judge.me/g)??[]).length,1);assert.doesNotMatch(html,/903001|903004|Invented Reviewer|reviewer@example.test|203\.0\.113\.8/);
  const health=await readReviewHealth(db);assert.deepEqual(health,{read:4,waiting:2,flagged:1,last:now.toISOString(),mode:'live'});
  const snapshot=getSampleDashboard();
  const shopify={...snapshot.shopify,checks:[] } as NonNullable<Parameters<typeof sourceHealthPage>[4]>['shopify'];
  assert.match(sourceHealthPage([],undefined,undefined,undefined,{summary:'Invented sources',shopify,checkedAt:now.toISOString(),reviewHealth:health}),/Reviews: 4 read, 2 waiting, 1 flagged, last/);
  const {published,...missing}=raw[0]!;assert.equal(cleanReview(missing),null);
});
