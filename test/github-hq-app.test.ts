import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { readRuntime } from '../src/runtime.js';
import { saveHQMonth, saveHQRegister } from '../src/github-hq/store.js';
import type { HQTestRow } from '../src/github-hq/model.js';
import type { MorningSnapshot } from '../src/morning/model-types.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2032-04-07T08:05:00Z');
const config = readRuntime({DATABASE_URL: 'postgresql://localhost/pulse_hq_app_test', APP_ORIGIN: 'https://pulse.example.test'});
const liveEnv = () => ({SHOPIFY_CLIENT_ID: randomBytes(16).toString('hex'), SHOPIFY_CLIENT_SECRET: randomBytes(32).toString('hex')});

test('live Home and Morning share stored HQ facts and audited calls without reading or writing a source', async t => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Page reads and local answers must not call a source'); });
  const db = await createTestDatabase();
  const app = await createApp(db, config, {...liveEnv(), GITHUB_HQ_TOKEN: randomBytes(32).toString('hex')}, {}, {}, {}, {}, {clock: () => now});
  t.after(async () => { await app.close(); await db.close(); });
  const credential = randomBytes(32).toString('base64url'), token = randomBytes(32).toString('base64url');
  const secret = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex'), credential]);
  const headers = {cookie: `__Host-pulse_session=${token}`, origin: config.origin, 'content-type': 'application/json'};
  const home = async () => {
    const response = await app.inject({url: '/?from=morning', headers});
    assert.equal(response.statusCode, 200, response.body.slice(0, 100)); return response.body;
  };
  const morning = async () => {
    const response = await app.inject({url: '/api/morning', headers});
    assert.equal(response.statusCode, 200, response.body.slice(0, 100)); return response.json<MorningSnapshot>();
  };
  assert.match(await home(), /Tests: waiting for the register/);
  assert.equal((await morning()).brief?.status, 'missing');
  await saveHQMonth(db, {kind: 'month', month: '2032-04', ref: 'main'}, [{day: '2032-04-06', runLabel: 'run 7 Apr 07:41',
    status: 'needs', count: 1, items: [{text: 'Review: an invented experiment.', label: 'Review'}], firstLines: []}], '"invented-month"', now);
  const row: HQTestRow = {id: 'I501', section: 'live', cells: ['I501 invented button test', 'Site', 'Which invented button works?',
    'A blue; B green', 'Invented order rate', '2032-03-30', 'After enough mornings', 'Invented register reading',
    'Reading 2032-04-06: A 3% n=40; B 2% n=40; ahead A; sure 97%; mornings 2']};
  await saveHQRegister(db, {readable: true, rows: [row], skippedRows: 0}, '"invented-register"', now);
  const before = (await db.query('SELECT * FROM pulse.github_hq_tests')).rows;
  const deck = await morning(), card = deck.cards.find(card => card.kind === 'test-call')!;
  assert.ok(card); assert.equal(card.callAnswer, 'a'); assert.equal(deck.brief?.count, 1);
  assert.match(await home(), /I501 invented button test/);
  const call = await app.inject({method: 'POST', url: '/api/morning/press', headers, payload: {cardKey: card.key, action: 'call', answer: 'a'}});
  assert.equal(call.statusCode, 200, call.body.slice(0, 100));
  assert.equal(call.json<MorningSnapshot>().answers[0]?.answer, 'a');
  assert.match(await home(), /Called A · waiting for the write-up/);
  assert.deepEqual((await db.query('SELECT * FROM pulse.github_hq_tests')).rows, before, 'Calls never edit the read register');
  assert.equal((await db.query("SELECT 1 FROM pulse.audit_log WHERE event LIKE 'Morning called A:%'")).rowCount, 1);
  const undo = await app.inject({method: 'POST', url: '/api/morning/press', headers, payload: {cardKey: card.key, action: 'undo'}});
  assert.equal(undo.statusCode, 200); assert.ok((await morning()).cards.some(item => item.key === card.key));
  await saveHQRegister(db, {readable: true, rows: [{id: row.id, section: 'history', cells: [row.cells[0]!, row.cells[2]!, 'A wins', 'Invented rule', 'Invented evidence']}], skippedRows: 0}, '"invented-history"', now);
  assert.equal((await morning()).cards.some(item => item.kind === 'new-verdict'), false, 'New verdicts leave the decision deck');
  assert.match(await home(), /A wins/, 'The stored verdict remains available in Home history');
});

test('live app without the HQ key shows a key reminder and waiting tests, with no invented test cards', async t => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Missing-key views must not call a source'); });
  const db = await createTestDatabase();
  const app = await createApp(db, config, liveEnv(), {}, {}, {}, {}, {clock: () => now});
  t.after(async () => { await app.close(); await db.close(); });
  const credential = randomBytes(32).toString('base64url'), token = randomBytes(32).toString('base64url');
  const secret = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex'), credential]);
  const headers = {cookie: `__Host-pulse_session=${token}`};
  const response = await app.inject({url: '/api/morning', headers});
  assert.equal(response.statusCode, 200);
  const deck = response.json<MorningSnapshot>();
  assert.equal(deck.mode, 'live'); assert.equal(deck.brief?.status, 'key'); assert.equal(deck.brief?.href, '/sources');
  assert.ok(!deck.cards.some(card => card.kind === 'test-call' || card.kind === 'new-verdict'));
  const home = await app.inject({url: '/?from=morning', headers});
  assert.equal(home.statusCode, 200); assert.match(home.body, /Tests: waiting for the register/);
});
