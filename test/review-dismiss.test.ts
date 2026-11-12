import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Auth } from '../src/auth.js';
import { readRuntime } from '../src/runtime.js';
import { registerReviewRoutes } from '../src/judgeme/routes.js';
import { dismissReviews, dismissedReviewIds, readReviews, saveReviews, withoutDismissed } from '../src/judgeme/store.js';
import { reviewsPanelHtml, reviewSheetHtml } from '../src/judgeme/presentation.js';
import { sampleReviews } from '../src/judgeme/sample.js';
import type { Review } from '../src/judgeme/model.js';
import { createTestDatabase } from './helpers/database.js';

const review = (id: string, rating = 5): Review => ({ id, rating, productTitle: 'Invented Kit', productHandle: 'invented-kit', market: null,
  verifiedBuyer: false, photoCount: 0, body: `Invented review ${id}`, createdAt: '2026-11-10T09:00:00Z', published: false, hidden: false,
  flagged: false, source: 'web', curated: 'ok' });

async function harness(t: TestContext) {
  const db = await createTestDatabase();
  const config = readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_reviews_test', APP_ORIGIN: 'https://pulse.example.test' });
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const auth = await Auth.create(db, config);
  const credential = randomBytes(32).toString('base64url'), token = randomBytes(32).toString('base64url');
  const secret = (await db.query<{ value: Uint8Array }>("SELECT value FROM pulse_private.app_secrets WHERE name = 'session_hmac'")).rows[0]!;
  await db.query('INSERT INTO pulse_private.credentials(id, public_key) VALUES ($1, $2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash, credential_id, expires_at) VALUES ($1, $2, now() + interval '30 days')",
    [createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex'), credential]);
  let published = 0;
  registerReviewRoutes(app, db, auth, () => { published += 1; });
  t.after(async () => { await app.close(); await db.close(); });
  const headers = { cookie: `${auth.sessionCookie}=${token}`, origin: config.origin, 'content-type': 'application/json' };
  return { db, app, headers, published: () => published };
}

test('Dismiss hides a review on Home, Undo brings it back, and Judge.me rows are untouched', async t => {
  const h = await harness(t);
  await saveReviews(h.db, [review('101', 2), review('102'), review('103')], new Date('2026-11-12T08:00:00Z'));
  const dismiss = (payload: unknown, headers: Record<string, string> = h.headers) => h.app.inject({ method: 'POST', url: '/api/reviews/dismiss', headers, payload: payload as object });
  assert.equal((await dismiss({ ids: ['101'], action: 'dismiss' })).statusCode, 200);
  assert.equal(h.published(), 1, 'A dismissal refreshes Home');
  assert.deepEqual((await readReviews(h.db, new Date('2026-11-12T08:00:00Z'))).rows.map(row => row.id).sort(), ['102', '103']);
  assert.equal((await h.db.query('SELECT * FROM pulse.judgeme_reviews')).rows.length, 3, 'Dismiss never deletes the stored review');
  assert.equal((await dismiss({ ids: ['101'], action: 'dismiss' })).statusCode, 200, 'A repeat tap is harmless');
  assert.equal((await dismiss({ ids: ['102', '103'], action: 'dismiss' })).statusCode, 200);
  assert.equal((await readReviews(h.db, new Date('2026-11-12T08:00:00Z'))).rows.length, 0);
  assert.equal((await dismiss({ ids: ['102', '103'], action: 'undo' })).statusCode, 200);
  assert.deepEqual((await readReviews(h.db, new Date('2026-11-12T08:00:00Z'))).rows.map(row => row.id).sort(), ['102', '103']);
  assert.deepEqual([...await dismissedReviewIds(h.db)], ['101']);
});

test('Dismiss refuses other sites, signed-out taps and malformed ids', async t => {
  const h = await harness(t);
  const send = (payload: unknown, headers: Record<string, string>) => h.app.inject({ method: 'POST', url: '/api/reviews/dismiss', headers, payload: JSON.stringify(payload) });
  assert.equal((await send({ ids: ['1'], action: 'dismiss' }, { ...h.headers, origin: 'https://elsewhere.example.test' })).statusCode, 403);
  assert.equal((await send({ ids: ['1'], action: 'dismiss' }, { ...h.headers, 'content-type': 'text/plain' })).statusCode, 415);
  assert.equal((await send({ ids: ['1'], action: 'dismiss' }, { origin: h.headers.origin, 'content-type': 'application/json' })).statusCode, 401);
  for (const bad of [{ ids: [], action: 'dismiss' }, { ids: ['1'], action: 'publish' }, { ids: ['1; DROP'], action: 'dismiss' }, { ids: [7], action: 'dismiss' },
    { ids: Array.from({ length: 501 }, (_, index) => String(index)), action: 'dismiss' }])
    assert.equal((await send(bad, h.headers)).statusCode, 400, JSON.stringify(bad).slice(0, 60));
  assert.equal(h.published(), 0);
  assert.equal((await dismissedReviewIds(h.db)).size, 0);
});

test('sample reviews can be dismissed too, so the screen works before keys', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const sample = sampleReviews(), first = sample.rows[0]!.id;
  await dismissReviews(db, [first]);
  assert.equal(withoutDismissed(sample, await dismissedReviewIds(db)).rows.some(row => row.id === first), false);
  assert.equal(withoutDismissed(sample, new Set()).rows.length, sample.rows.length);
});

test('the review panel offers Dismiss per row and Dismiss all, never Publish', () => {
  const panel = { ...sampleReviews(), rows: [review('201', 2), review('202')] };
  const html = reviewsPanelHtml(panel);
  assert.doesNotMatch(html, /review-publish|>Publish</);
  assert.match(html, /id="review-dismiss-all"[^>]*>Dismiss all</);
  assert.equal(html.match(/data-review-dismiss="/g)?.length, 2);
  assert.doesNotMatch(html, /<button[^>]*data-review-open[^>]*>(?:(?!<\/button>)[\s\S])*<button/, 'Dismiss is never nested inside the open button');
  assert.doesNotMatch(reviewsPanelHtml({ ...panel, rows: [] }), /review-dismiss-all/);
  const sheet = reviewSheetHtml(panel.rows[0]!, panel);
  assert.match(sheet, /data-review-dismiss="201"/);
  assert.match(sheet, /Dismiss only takes it off this list/);
});
