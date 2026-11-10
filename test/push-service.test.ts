import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import test from 'node:test';
import type { Database } from '../src/db.js';
import { ukToday } from '../src/hero-range.js';
import { morningDeck, type MorningInput, type MorningState } from '../src/morning/model.js';
import { defaultSettings } from '../src/settings.js';
import { morningSummaryPayload, PUSH_SUMMARY_KIND, PushService, summaryWindow } from '../src/push/service.js';
import type { PushTransport } from '../src/push/sender.js';
import { readPushSubscriptions, savePushSubscription } from '../src/push/store.js';
import { tickerState } from '../src/ticker/model.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2032-04-20T07:00:00Z');
const origin = 'https://pulse.example.test';
const quiet = {log: () => {}, sleep: async () => {}};
function morning(count: number, at = now, mode: 'sample' | 'live' = 'live', completed = 0) {
  const input: MorningInput = {mode, needs: Array.from({length: count}, (_, index) => ({id: `invented-need-${index}`,
    state: 'warn', source: 'pulse', title: `Invented task ${index + 1}`, why: 'An invented rule.', link: '/sources'})),
  checks: [], creativeCards: [], settings: defaultSettings(), ticker: tickerState([], [], at, mode),
  activity: [], metaActions: [], sourceReadOk: {'needs:pulse': true}};
  const states = Array.from({length: completed}, (_, index): MorningState => ({mode, cardKey: `invented-completed-${index}`,
    state: 'seen', untilDay: null, factsHash: '0'.repeat(64), answer: null, credentialId: 'invented-credential',
    pressedAt: at.toISOString(), clearedAt: at.toISOString(), title: 'Invented earlier press', kind: 'need',
    subjectId: `invented-completed-${index}`, sourceScope: 'needs:pulse'}));
  return morningDeck(input, states, at);
}
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return {promise, release};
}
async function setEnabled(db: Database, enabled: boolean) {
  await db.query('INSERT INTO pulse.settings(values) VALUES($1) ON CONFLICT(singleton) DO UPDATE SET values=EXCLUDED.values',
    [JSON.stringify({...defaultSettings(), morningSummaryEnabled: enabled})]);
}
async function prepare(db: Database, enabled = true) {
  await setEnabled(db, enabled);
  const pair = createECDH('prime256v1'); pair.generateKeys();
  const raw = {publicKey: pair.getPublicKey().toString('base64url'), privateKey: pair.getPrivateKey().toString('base64url')};
  await db.query('INSERT INTO pulse_private.app_secrets(name,value) VALUES($1,$2)', ['push_key_pair', Buffer.from(JSON.stringify(raw))]);
  return raw;
}
async function subscribe(db: Database, credential: string, id: string, at = now) {
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2) ON CONFLICT DO NOTHING', [credential, randomBytes(32)]);
  const pair = createECDH('prime256v1'); pair.generateKeys();
  const subscription = {endpoint: `https://fcm.googleapis.com/fcm/send/invented-${id}`,
    keys: {p256dh: pair.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url')}};
  await savePushSubscription(db, credential, subscription, at);
  return subscription;
}
async function claims(db: Database): Promise<number> {
  return Number((await db.query<{count: string}>('SELECT count(*)::text FROM pulse.push_sent')).rows[0]!.count);
}

test('summary text uses all ranked open cards, including the more list after the daily cap, and bounds Unicode titles', () => {
  assert.deepEqual(morningSummaryPayload(morning(0)), {kind: 'summary', title: 'All clear this morning', body: '', path: '/morning', day: '2032-04-20'});
  assert.deepEqual(morningSummaryPayload(morning(1)), {kind: 'summary', title: 'Needs you: 1 item', body: '1. Invented task 1', path: '/morning', day: '2032-04-20'});
  const result = morning(9, now, 'live', 7);
  assert.equal(result.snapshot.cards.length, 0); assert.equal(result.snapshot.more, 9);
  assert.deepEqual(morningSummaryPayload(result), {kind: 'summary', title: 'Needs you: 9 items',
    body: '1. Invented task 1\n2. Invented task 2\n3. Invented task 3', path: '/morning', day: '2032-04-20'});
  assert.equal(morningSummaryPayload(morning(0, now, 'sample')).title, 'Sample · All clear this morning');
  assert.equal(morningSummaryPayload(morning(9, now, 'sample')).title, 'Sample · Needs you: 9 items');
  result.openCards[0]!.title = `  ${'𐐀'.repeat(100)}\n   invented suffix `;
  result.openCards[1]!.title = 'Invented\n   title\twith whitespace';
  const payload = morningSummaryPayload(result), first = payload.body.split('\n')[0]!.slice(3);
  assert.equal(Array.from(first).length, 60); assert.ok(first.endsWith('…'));
  assert.match(payload.body, /2\. Invented title with whitespace/);
  assert.equal(payload.body.split('\n').length, 3);
  assert.ok(Buffer.byteLength(JSON.stringify(payload), 'utf8') < 3_000);
});

test('summary window includes 08:00 through 09:59 UK in summer and winter, including both clock-change dates', () => {
  for (const [before, start, last, end] of [
    ['2032-06-10T06:59:00Z', '2032-06-10T07:00:00Z', '2032-06-10T08:59:59Z', '2032-06-10T09:00:00Z'],
    ['2032-12-10T07:59:00Z', '2032-12-10T08:00:00Z', '2032-12-10T09:59:59Z', '2032-12-10T10:00:00Z'],
    ['2026-03-29T06:59:00Z', '2026-03-29T07:00:00Z', '2026-03-29T08:59:59Z', '2026-03-29T09:00:00Z'],
    ['2026-10-25T07:59:00Z', '2026-10-25T08:00:00Z', '2026-10-25T09:59:59Z', '2026-10-25T10:00:00Z'],
  ]) {
    assert.equal(summaryWindow(new Date(before!)), false); assert.equal(summaryWindow(new Date(start!)), true);
    assert.equal(summaryWindow(new Date(last!)), true); assert.equal(summaryWindow(new Date(end!)), false);
  }
});

test('the dedicated minute timer does nothing before start, shares repeated starts and stops cleanly', async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  let reads = 0;
  const db: Database = {query: async () => { reads++; return {rows: [], rowCount: 0}; },
    transaction: async () => { throw new Error('No writes when the default switch is off'); }, close: async () => {}};
  const service = new PushService(db, {origin, clock: () => now, ...quiet,
    loadMorning: async () => { throw new Error('Disabled summaries never read Morning'); }});
  assert.equal(reads, 0); service.start(); service.start(); await service.tick(); assert.equal(reads, 1);
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(59_999); await flush(); assert.equal(reads, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(reads, 2);
  await service.stop(); t.mock.timers.tick(120_000); await flush(); service.start(); await service.tick();
  assert.equal(reads, 2); assert.deepEqual(await service.sendTest('invented-credential'), {status: 'unavailable'});
});

test('two ticks and two service instances share one durable claim before loading the full Morning result', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); await prepare(db);
  await subscribe(db, 'invented-a', 'one'); await subscribe(db, 'invented-b', 'two');
  let loads = 0, deliveries = 0;
  const options = {origin, clock: () => now, ...quiet,
    transport: async () => { deliveries++; return {status: 201}; },
    loadMorning: async (at: Date) => {
      loads++; assert.equal(await claims(db), 1, 'The day is claimed before deck reads');
      const rows = await db.query<{kind: string; day: string}>('SELECT kind,uk_day::text AS day FROM pulse.push_sent');
      assert.deepEqual(rows.rows, [{kind: PUSH_SUMMARY_KIND, day: ukToday(at)}]);
      return morning(9, at, 'sample', 7);
    }};
  const first = new PushService(db, options), second = new PushService(db, options);
  const started = first.tick(); assert.equal(first.tick(), started, 'One instance shares its in-flight tick');
  await Promise.all([started, second.tick()]); assert.equal(loads, 1); assert.equal(deliveries, 2);
  await first.tick(); const restarted = new PushService(db, options); await restarted.tick();
  assert.equal(loads, 1); assert.equal(deliveries, 2); assert.equal(await claims(db), 1);
  for (const row of await readPushSubscriptions(db)) { assert.equal(row.lastSuccessAt, now.toISOString()); assert.equal(row.failures, 0); }
  await Promise.all([first.stop(), second.stop(), restarted.stop()]);
});

test('disabled summaries take no claim; eligible ticks send once and a fresh 09:59 arrival remains eligible in both seasons', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); await prepare(db, false); await subscribe(db, 'invented-a', 'gate');
  let current = now, loads = 0, deliveries = 0;
  const service = new PushService(db, {origin, clock: () => current, ...quiet,
    loadMorning: async at => { loads++; return morning(0, at); }, transport: async () => { deliveries++; return {status: 201}; }});
  await service.tick(); assert.equal(await claims(db), 0); assert.equal(loads, 0); await setEnabled(db, true);
  for (const times of [
    ['2032-06-10T06:59:00Z', '2032-06-10T07:00:00Z', '2032-06-10T08:59:00Z', '2032-06-10T09:00:00Z', '2032-06-11T08:59:00Z'],
    ['2032-12-10T07:59:00Z', '2032-12-10T08:00:00Z', '2032-12-10T09:59:00Z', '2032-12-10T10:00:00Z', '2032-12-11T09:59:00Z'],
  ]) {
    const before = deliveries;
    for (const [index, instant] of times.entries()) {
      current = new Date(instant); await service.tick();
      assert.equal(deliveries, before + (index === 0 ? 0 : index === 4 ? 2 : 1));
    }
  }
  assert.equal(await claims(db), 4); assert.equal(loads, 4); await service.stop();
});

test('a claimed day is never released after deck failure, delivery failure or no subscriptions', async t => {
  for (const scenario of ['deck failure', 'delivery failure', 'no subscriptions'] as const) await t.test(scenario, async st => {
    const db = await createTestDatabase(); st.after(() => db.close()); const raw = await prepare(db);
    const sub = scenario === 'no subscriptions' ? null : await subscribe(db, 'invented-a', scenario.replaceAll(' ', '-'));
    let loads = 0, attempts = 0; const logs: string[] = [];
    const options = {origin, clock: () => now, sleep: async () => {}, log: (line: string) => logs.push(line),
      loadMorning: async () => { loads++; if (scenario === 'deck failure') throw new Error(raw.privateKey); return morning(1); },
      transport: async () => { attempts++; return {status: 503}; }};
    const service = new PushService(db, options); await service.tick(); await service.tick();
    const restarted = new PushService(db, options); await restarted.tick();
    assert.equal(await claims(db), 1); assert.equal(loads, 1); assert.equal(attempts, scenario === 'delivery failure' ? 4 : 0);
    if (scenario === 'delivery failure') assert.equal((await readPushSubscriptions(db))[0]!.failures, 1, 'One failure count per final send, not per retry');
    const output = JSON.stringify(logs);
    for (const secret of [raw.privateKey, raw.publicKey, sub?.endpoint, sub?.keys.auth, sub?.keys.p256dh].filter((value): value is string => !!value))
      assert.ok(!output.includes(secret));
    await service.stop(); await restarted.stop();
  });
});

test('claim storage failures cannot build or send, and diagnostics cannot make the service throw', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); await prepare(db);
  const guarded: Database = {...db, async query(sql, values) {
    if (sql.includes('INSERT INTO pulse.push_sent')) throw new Error('Invented private storage detail');
    return db.query(sql, values);
  }};
  let loads = 0, sends = 0;
  const service = new PushService(guarded, {origin, clock: () => now, log: () => { throw new Error('Invented logger failure'); },
    loadMorning: async () => { loads++; return morning(1); }, transport: async () => { sends++; return {status: 201}; }});
  await assert.doesNotReject(service.tick()); assert.equal(loads, 0); assert.equal(sends, 0); assert.equal(await claims(db), 0);
  await service.stop();
});

test('test sends only target that credential and atomically enforce one attempt per minute', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); const raw = await prepare(db, false);
  const a = await subscribe(db, 'invented-a', 'a'), b = await subscribe(db, 'invented-b', 'b');
  const visited: string[] = [], logs: string[] = []; let current = now;
  const service = new PushService(db, {origin, clock: () => current, log: line => logs.push(line),
    loadMorning: async () => { throw new Error('Manual tests do not read Morning'); },
    transport: async request => { visited.push(request.url); return {status: 201}; }});
  const results = await Promise.all([service.sendTest('invented-a'), service.sendTest('invented-a')]);
  assert.deepEqual(results, [{status: 'sent', sent: 1, failed: 0, gone: 0}, {status: 'rate-limited', retryAfterSeconds: 60}]);
  assert.deepEqual(visited, [a.endpoint]); assert.equal((await service.sendTest('invented-b')).status, 'sent');
  current = new Date(now.getTime() + 59_000); assert.deepEqual(await service.sendTest('invented-a'), {status: 'rate-limited', retryAfterSeconds: 1});
  current = new Date(now.getTime() + 60_000); assert.equal((await service.sendTest('invented-a')).status, 'sent');
  assert.deepEqual(visited, [a.endpoint, b.endpoint, a.endpoint]); assert.equal(await claims(db), 0);
  assert.deepEqual(await service.sendTest('invented-empty'), {status: 'unavailable'});
  for (const secret of [a.endpoint, a.keys.auth, a.keys.p256dh, raw.privateKey, raw.publicKey])
    assert.ok(!JSON.stringify({results, logs}).includes(secret));
  await service.stop();
});

test('summary and manual tests share one delivery queue, with no overlapping transport calls', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); await prepare(db);
  await subscribe(db, 'invented-a', 'a'); await subscribe(db, 'invented-b', 'b');
  const entered = barrier(), release = barrier(); let calls = 0, active = 0, maximum = 0;
  const transport: PushTransport = async () => {
    calls++; active++; maximum = Math.max(maximum, active);
    if (calls === 1) { entered.release(); await release.promise; }
    active--; return {status: 201};
  };
  const service = new PushService(db, {origin, clock: () => now, ...quiet, loadMorning: async () => morning(1), transport});
  const summary = service.tick(); await entered.promise;
  const a = service.sendTest('invented-a'), b = service.sendTest('invented-b');
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(calls, 1);
  release.release(); await summary; assert.equal((await a).status, 'sent'); assert.equal((await b).status, 'sent');
  assert.equal(calls, 4); assert.equal(maximum, 1); await service.stop();
});

test('404 and 410 remove subscriptions; final failures update once; zero delivered returns unavailable', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); await prepare(db, false);
  await subscribe(db, 'invented-a', 'gone404'); await subscribe(db, 'invented-a', 'gone410');
  await subscribe(db, 'invented-a', 'failed');
  let calls = 0;
  const service = new PushService(db, {origin, clock: () => now, ...quiet, loadMorning: async () => morning(0),
    transport: async request => { calls++; return {status: request.url.endsWith('gone404') ? 404 : request.url.endsWith('gone410') ? 410 : 500}; }});
  assert.deepEqual(await service.sendTest('invented-a'), {status: 'unavailable'}); assert.equal(calls, 6);
  const remaining = await readPushSubscriptions(db); assert.equal(remaining.length, 1);
  assert.ok(remaining[0]!.endpoint.endsWith('failed')); assert.equal(remaining[0]!.failures, 1); assert.equal(remaining[0]!.lastSuccessAt, null);
  await service.stop();
});

test('stop drains the active send but starts neither another subscription nor a queued test', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); await prepare(db);
  await subscribe(db, 'invented-a', 'a'); await subscribe(db, 'invented-b', 'b');
  const entered = barrier(), release = barrier(); let calls = 0, stopped = false;
  const service = new PushService(db, {origin, clock: () => now, ...quiet, loadMorning: async () => morning(1),
    transport: async () => { calls++; entered.release(); await release.promise; return {status: 201}; }});
  const summary = service.tick(); await entered.promise;
  const queued = service.sendTest('invented-a'), stop = service.stop().then(() => { stopped = true; });
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(stopped, false);
  release.release(); await Promise.all([summary, stop]);
  assert.deepEqual(await queued, {status: 'unavailable'}); assert.equal(calls, 1); assert.equal(await claims(db), 1);
  await service.tick(); assert.equal(calls, 1);
});


test('a device revoked after the batch was loaded is not sent a queued summary', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); await prepare(db);
  await subscribe(db, 'invented-first', 'first');
  const revoked = await subscribe(db, 'invented-second', 'second', new Date(+now + 1));
  const urls: string[] = [];
  const service = new PushService(db, {origin, ...quiet, clock: () => now, loadMorning: async () => morning(1), transport: async request => {
    urls.push(request.url);
    await db.query('DELETE FROM pulse.push_subscriptions WHERE endpoint=$1', [revoked.endpoint]);
    return {status: 201};
  }}); t.after(() => service.stop());
  await service.tick(); assert.equal(urls.length, 1); assert.ok(!urls.includes(revoked.endpoint));
});
