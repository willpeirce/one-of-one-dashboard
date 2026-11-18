import assert from 'node:assert/strict';
import {createHmac, randomBytes} from 'node:crypto';
import test from 'node:test';
import {createApp} from '../src/app.js';
import type {Database} from '../src/db.js';
import {saveReviews, dismissReviews} from '../src/judgeme/store.js';
import type {Review} from '../src/judgeme/model.js';
import {readRuntime} from '../src/runtime.js';
import {createTestDatabase} from './helpers/database.js';

const now = new Date('2032-04-07T12:00:00Z');
const runtime = () => readRuntime({DATABASE_URL: 'postgresql://localhost/invented_issues', APP_ORIGIN: 'https://pulse.example.test'});
async function signedIn(db: Database) {
  const key = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  const token = randomBytes(32).toString('base64url'), credential = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(key.value)).update(token).digest('hex'), credential]);
  return {cookie: `__Host-pulse_session=${token}`};
}

for (const liveShopify of [false, true]) test(`Issues authenticates before reading and ${liveShopify ? 'excludes sample cases beside live Shopify' : 'shows labelled sample cases on Handover'}`, async t => {
  const db = await createTestDatabase();
  let issueReads = 0;
  const guarded: Database = {...db, query: (sql, values) => {
    if (sql.includes('pulse.judgeme_reviews') || sql.includes('pulse.gorgias_tickets')) issueReads++;
    return db.query(sql, values);
  }};
  const env = liveShopify ? {SHOPIFY_CLIENT_ID: randomBytes(16).toString('hex'), SHOPIFY_CLIENT_SECRET: randomBytes(32).toString('hex')} : {};
  const app = await createApp(guarded, runtime(), env, {clock: () => now}, {}, {}, {}, {clock: () => now});
  t.after(async () => {await app.close(); await db.close();});
  assert.equal(issueReads, 0, 'Issues performs no work before listen or authentication');
  assert.equal((await app.inject('/api/issues/scratched%20slab')).statusCode, 401);
  assert.equal((await app.inject('/handover')).statusCode, 302);
  assert.equal(issueReads, 0);
  const headers = await signedIn(db);
  const page = await app.inject({url: '/handover', headers});
  assert.equal(page.statusCode, 200);
  assert.ok(page.body.indexOf('id="handover-customer-service"') < page.body.indexOf('id="handover-waiting-on"'));
  assert.ok(page.body.indexOf('id="handover-waiting-on"') < page.body.indexOf('id="handover-issues"'));
  const response = await app.inject({url: '/api/issues/scratched%20slab', headers});
  assert.equal(response.statusCode, 200);
  const cases = response.json();
  assert.equal(cases.mode, liveShopify ? 'live' : 'sample');
  assert.equal(cases.current, liveShopify ? 0 : 3);
  assert.equal(cases.previous, liveShopify ? 0 : 1);
  assert.equal(cases.status, liveShopify ? 'pending' : 'ready');
  if (liveShopify) assert.deepEqual(cases.cases, []);
  else assert.equal(cases.cases.length, 4);
  const dashboard = (await app.inject({url: '/api/dashboard', headers})).json();
  assert.equal(dashboard.shopify.needs.some((need: {readScope?: string}) => need.readScope === 'needs:issues'), false);
  assert.deepEqual(Object.keys(dashboard.issuesRead).sort(), ['checkedAt', 'ok']);
  assert.equal(dashboard.issuesRead.ok, !liveShopify);
});

test('live Issues counts published, hidden and dismissed low-star reviews without importing sample tickets or reviewer fields', async t => {
  const db = await createTestDatabase();
  const app = await createApp(db, runtime(), {JUDGEME_API_TOKEN: randomBytes(32).toString('hex')},
    {clock: () => now}, {}, {}, {}, {clock: () => now});
  t.after(async () => {await app.close(); await db.close();});
  const review = (index: number, month: string): Review => ({id: String(92000 + index), rating: 2,
    productTitle: 'Box A', productHandle: 'box-a', market: null, verifiedBuyer: false, photoCount: 0,
    body: `Scratched slab in order #${42000 + index}. ${'Invented detail. '.repeat(20)}`,
    createdAt: `2032-${month}-02T12:00:00Z`, published: index === 1, hidden: index === 2,
    flagged: false, source: null, curated: 'ok'});
  await saveReviews(db, [review(1, '04'), review(2, '04'), review(3, '04'), review(4, '03')], now);
  await dismissReviews(db, ['92003']);
  const headers = await signedIn(db);
  const cases = (await app.inject({url: '/api/issues/scratched%20slab', headers})).json();
  assert.equal(cases.mode, 'live'); assert.equal(cases.current, 3); assert.equal(cases.previous, 1);
  assert.equal(cases.cases.length, 4);
  for (const row of cases.cases) {
    assert.deepEqual(row.sources, ['judgeme']);
    assert.equal(row.ticketHref, null);
    assert.ok(Array.from(row.quote as string).length <= 120);
    assert.equal(Object.hasOwn(row, 'reviewer'), false);
    assert.equal(Object.hasOwn(row, 'customer'), false);
    assert.equal(Object.hasOwn(row, 'body'), false);
  }
  const dashboard = (await app.inject({url: '/api/dashboard', headers})).json();
  const needs = dashboard.shopify.needs.filter((need: {readScope?: string}) => need.readScope === 'needs:issues');
  assert.equal(needs.length, 1); assert.equal(needs[0].sourceMode, 'live'); assert.equal(needs[0].state, 'warn');
  assert.equal(dashboard.issuesRead.ok, true);
  const page = await app.inject({url: '/handover', headers});
  const section = page.body.slice(page.body.indexOf('id="handover-issues"'));
  assert.match(section, /No sample replacement costs are mixed with live cases/);
  assert.doesNotMatch(section, /Sample data · invented cases|Invented detail/);
});
