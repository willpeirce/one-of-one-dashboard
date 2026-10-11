import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { JudgeMeClient, JudgeMeReadError } from '../src/judgeme/client.js';
import { cleanReview, waitingReviews } from '../src/judgeme/model.js';
import { readReviews, saveReviews } from '../src/judgeme/store.js';
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
  assert.deepEqual(waitingReviews(clean).map(r => r.id), ['900101', '900102', '900103']);
  const serialized = JSON.stringify(clean);
  for (const privateValue of ['Invented Reviewer', 'reviewer@example.test', '203.0.113.8', 'phone', 'reviewer', 'ip_address']) assert.ok(!serialized.includes(privateValue));
  assert.equal(clean[0].market, null);
  assert.equal(clean[0].verifiedBuyer, true);
  assert.equal(clean[0].photoCount, 1);
  assert.equal(clean[3].published, true);
  assert.equal(clean[4].hidden, true);
  assert.equal(clean[5].hidden, true, 'curated spam is hidden even if the separate flag is false');
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
    return Response.json({ current_page: calls.length, per_page: 100, reviews: calls.length === 1
      ? Array.from({ length: 100 }, (_, i) => ({ ...fixture.reviews[0], id: 901000 + i })) : [fixture.reviews[1]] });
  } });
  const rows = await client.reviews();
  assert.equal(rows.length, 101); assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(u => u.searchParams.get('page')), ['1', '2']);
  assert.deepEqual(Object.getOwnPropertyNames(JudgeMeClient.prototype).sort(), ['constructor', 'reviews']);
  assert.doesNotMatch(JSON.stringify(rows), /Invented Reviewer|reviewer@example.test|203\.0\.113\.8/);
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
  assert.deepEqual((await readReviews(db, now)).rows.map(r => r.id), ['900101', '900102', '900103']);
  const stored = JSON.stringify((await db.query('SELECT * FROM pulse.judgeme_reviews')).rows);
  assert.doesNotMatch(stored, /Invented Reviewer|reviewer@example.test|203\.0\.113\.8|reviewer|ip_address/);
  const next = fixture.reviews.map((r: any) => ({ ...r, ...(r.id === 900101 ? { curated: 'ok' } : r.id === 900102 ? { hidden: true } : {}) }));
  await saveReviews(db, next.map(cleanReview), new Date(now.getTime() + REVIEW_POLL_MS));
  assert.deepEqual((await readReviews(db, now)).rows.map(r => r.id), ['900103']);
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
  let panel = await readReviews(db, clock); assert.equal(panel.status, 'live'); assert.equal(panel.rows.length, 3);
  clock = new Date(now.getTime() + REVIEW_POLL_MS); fail = true; await worker.tick();
  panel = await readReviews(db, clock); assert.equal(panel.status, 'unavailable'); assert.equal(panel.rows.length, 3);
  assert.deepEqual(logs, ['Judge.me poll failed (status: 403, code: http).']);
  clock = new Date(clock.getTime() + REVIEW_POLL_MS); await worker.tick();
  const failedHealth = await readSourceHealth(db);
  assert.equal(failedHealth.find(row => row.source === 'judgeme')!.consecutiveFailures, 2);
  const facts: Facts = { mode: 'live', sample: false, jobs: [], records: [], counts: {}, pendingWebhooks: 0, notices: [], noticeDetails: [] };
  assert.deepEqual(evaluateWatchdogs(facts, clock, defaultSettings(), blankObservation(), [], failedHealth),
    evaluateWatchdogs(facts, clock, defaultSettings(), blankObservation(), [], []), 'repeated review failures cannot change any watchdog or its alarm card');
  clock = new Date(clock.getTime() + REVIEW_POLL_MS); fail = false; await worker.tick();
  const health = (await readSourceHealth(db)).find(row => row.source === 'judgeme')!;
  assert.equal(health.status, 'healthy'); assert.equal(health.consecutiveFailures, 0);
  assert.match(sourceHealthPage([health]), />Live<\/td>/);
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

test('an unset review URL template sends every Open and Read action to the Judge.me dashboard', () => {
  assert.equal(appConfig.judgeme.reviewUrlTemplate, '');
  const panel = sampleReviews();
  assert.equal(reviewLink('900201'), 'https://app.judge.me/index');
  assert.equal(reviewLink('900201', '   '), 'https://app.judge.me/index');
  for (const html of [reviewsPanelHtml(panel), ...panel.rows.map(row => reviewSheetHtml(row, panel))]) {
    const links = [...html.matchAll(/data-review-link href="([^"]+)"/g)];
    assert.ok(links.length > 0);
    for (const [, href] of links) assert.equal(href, 'https://app.judge.me/index');
  }
});

test('a configured review URL template replaces and encodes shop and review ID placeholders', () => {
  // Invented template for substitution coverage, not a claimed Judge.me merchant route.
  const template = 'https://app.judge.me/example-review/{review_id}?shop={shop}&review={review_id}';
  assert.equal(reviewLink('900201', template, 'sample-shop.myshopify.com'),
    'https://app.judge.me/example-review/900201?shop=sample-shop.myshopify.com&review=900201');
  assert.equal(reviewLink('sample/id', template, 'sample shop&extra'),
    'https://app.judge.me/example-review/sample%2Fid?shop=sample%20shop%26extra&review=sample%2Fid');
});

test('reviews share sample/live rendering, safely escape full text, disable Publish and supply greeting/empty state', () => {
  const panel = sampleReviews(), row = panel.rows[0]!;
  assert.equal(panel.publishEnabled, false); assert.equal(appConfig.judgeme.publishEnabled, false);
  assert.equal(reviewsGreeting(panel), '3 sample reviews, 1 needs reading first');
  const html = reviewsPanelHtml(panel), sheet = reviewSheetHtml(row, panel);
  assert.match(html, /id="review-publish"[^>]*disabled/); assert.match(html, /Verified buyer/); assert.match(html, /1 photo/);
  assert.ok(sheet.indexOf('Read in Judge.me') < sheet.indexOf('Open in Judge.me'));
  assert.equal((sheet.match(/data-review-link/g) ?? []).length, 2); assert.ok(sheet.includes(reviewLink(row.id)));
  assert.match(sheet, /Sample data/); assert.match(sheet, new RegExp(row.body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /data-state="alarm"|Not built yet|reviewer/);
  row.body = '<script>sample attack</script>'; assert.ok(!reviewSheetHtml(row, panel).includes(row.body));
  const live = { ...panel, mode: 'live' as const, status: 'live' as const };
  assert.equal(reviewsGreeting(live), '3 new reviews, 1 needs reading first');
  live.rows = []; assert.equal(reviewsGreeting(live), 'All caught up'); assert.doesNotMatch(reviewsPanelHtml(live), /class="rv"/);
  const dashboard = getSampleDashboard(); const rendered = dashboardPage(dashboard);
  assert.match(rendered, /data-review-open="900101"/); assert.match(rendered, /data-rv>3 sample reviews, 1 needs reading first/);
});
