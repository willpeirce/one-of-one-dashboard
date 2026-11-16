import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import type {Database} from '../src/db.js';
import {readSettings} from '../src/settings.js';
import {syncSourceHealth} from '../src/sources.js';
import {GorgiasReadError} from '../src/gorgias/client.js';
import {GORGIAS_POLL_MS, type GorgiasPollInput, type GorgiasPollResult, type GorgiasTicket} from '../src/gorgias/model.js';
import {gorgiasScope} from '../src/gorgias/scope.js';
import {readGorgiasFacts, readGorgiasHistory, readGorgiasSync, saveGorgiasPoll} from '../src/gorgias/store.js';
import {GorgiasWorker} from '../src/gorgias/worker.js';
import {createTestDatabase} from './helpers/database.js';

const initial = new Date('2032-04-07T12:00:00Z');
const domain = `invented-${randomBytes(6).toString('hex')}`, email = `reader-${randomBytes(6).toString('hex')}@example.invalid`;
const blankCredential = ' '.repeat(2);
const env = () => ({GORGIAS_DOMAIN: domain, GORGIAS_EMAIL: email, GORGIAS_API_KEY: randomBytes(32).toString('hex')});
const ticket: GorgiasTicket = {id: '81001', status: 'open', channel: 'email', tags: ['ai_handover'], inHandover: true, viewId: null,
  createdAt: '2032-04-06T10:00:00.000Z', updatedAt: initial.toISOString(), lastCustomerMessageAt: null,
  customer: 'Invented F.', subject: 'Invented missing slab'};
const result = (): GorgiasPollResult => ({tickets: [{...ticket}], closedThisWeek: 0});

test('Gorgias construction and sample ticks do no I/O; live ticks are single-flight, every two minutes and stop safely', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(); await syncSourceHealth(db, source); await readSettings(db);
  let reads = 0, writes = 0, now = initial, release!: () => void, entered!: () => void;
  const inside = new Promise<void>(resolve => {entered = resolve;});
  const gate = new Promise<void>(resolve => {release = resolve;});
  const inputs: GorgiasPollInput[] = [];
  const worker = new GorgiasWorker(db, source, {clock: () => now, onWrite: () => {writes++;}, reader: {async readHandover(input) {
    inputs.push(input); reads++; entered(); if (reads === 1) await gate; return result();
  }}});
  t.after(() => worker.stop());
  const forbidden: Database = {query: async () => {assert.fail('Construction/sample mode must not read storage');},
    transaction: async () => {assert.fail('Construction/sample mode must not write storage');}, close: async () => {}};
  const sample = new GorgiasWorker(forbidden, {...source, GORGIAS_API_KEY: blankCredential});
  sample.start(); await sample.tick(); await sample.stop();
  const constructedOnly = new GorgiasWorker(forbidden, source); await constructedOnly.stop();
  assert.equal(reads, 0);
  const first = worker.tick(), second = worker.tick(); assert.equal(first, second);
  await inside; assert.equal(reads, 1); assert.equal(writes, 0);
  release(); await first; assert.equal(writes, 1);
  await worker.tick(); assert.equal(reads, 1, 'A repeated tick inside the interval does not poll again');
  now = new Date(initial.getTime() + GORGIAS_POLL_MS); await worker.tick(); assert.equal(reads, 2); assert.equal(writes, 2);
  assert.deepEqual(inputs[0]?.knownTickets, []);
  assert.deepEqual(inputs[1]?.knownTickets, [{id: ticket.id, status: 'open', inHandover: true}]);
  assert.equal(inputs[0]?.weekStart, '2032-04-04T23:00:00.000Z');
  const facts = await readGorgiasFacts(db, source, (await readSettings(db)).values, now);
  assert.equal(facts.status, 'live'); assert.equal(facts.tickets.length, 1);
  await worker.stop(); now = new Date(now.getTime() + GORGIAS_POLL_MS); await worker.tick(); worker.start();
  assert.equal(reads, 2, 'Stopped workers cannot be restarted accidentally');
});

test('failed Gorgias reads retain the last complete list, log only fixed diagnostics and honor durable Retry-After after restart', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(); await syncSourceHealth(db, source); const selection = (await readSettings(db)).values;
  let now = initial, calls = 0, notifications = 0;
  const retryAt = initial.getTime() + 400 * 86_400_000, logs: string[] = [];
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  const worker = new GorgiasWorker(db, source, {clock: () => now, onWrite: () => {notifications++;}, reader: {async readHandover() {
    calls++; if (calls > 1) throw new GorgiasReadError('rate_limit', 429, retryAt); return result();
  }}});
  await worker.tick(); now = new Date(initial.getTime() + GORGIAS_POLL_MS); await assert.doesNotReject(worker.tick());
  let facts = await readGorgiasFacts(db, source, selection, now);
  assert.equal(facts.status, 'unavailable'); assert.equal(facts.checkedAt, initial.toISOString()); assert.equal(facts.tickets.length, 1);
  assert.equal(notifications, 2, 'A failed poll also publishes the changed health');
  assert.equal((await readGorgiasSync(db, gorgiasScope(source.GORGIAS_DOMAIN, selection)))?.nextRunAt, new Date(retryAt).toISOString());
  await worker.stop(); await syncSourceHealth(db, source);
  let restartedCalls = 0;
  const restarted = new GorgiasWorker(db, source, {clock: () => now, reader: {async readHandover() {restartedCalls++; return result();}}});
  t.after(() => restarted.stop());
  await restarted.tick(); assert.equal(restartedCalls, 0);
  facts = await readGorgiasFacts(db, source, selection, now); assert.equal(facts.status, 'unavailable');
  const health = (await db.query<{status: string; consecutive_failures: number}>("SELECT status,consecutive_failures FROM pulse.source_health WHERE source='gorgias'")).rows[0]!;
  assert.equal(health.status, 'error'); assert.equal(health.consecutive_failures, 1);
  now = new Date(retryAt); await restarted.tick(); assert.equal(restartedCalls, 1);
  assert.equal((await readGorgiasFacts(db, source, selection, now)).status, 'live');
  assert.deepEqual(logs, ['Gorgias poll failed (status: 429, code: rate_limit).']);
  assert.ok(logs.every(line => !line.includes(source.GORGIAS_API_KEY) && !line.includes(source.GORGIAS_EMAIL)));
});

test('a broken diagnostic logger or clock never makes a Gorgias background tick reject', async t => {
  const source = env();
  const failed: Database = {query: async () => {throw new Error('Invented storage failure');},
    transaction: async () => {throw new Error('Invented transaction failure');}, close: async () => {}};
  t.mock.method(console, 'error', () => {throw new Error('Invented diagnostic failure');});
  const worker = new GorgiasWorker(failed, source, {clock: () => initial});
  await assert.doesNotReject(worker.tick()); await assert.doesNotReject(worker.stop());
  const brokenClock = new GorgiasWorker(failed, source, {clock: () => {throw new Error('Invented clock failure');}});
  await assert.doesNotReject(brokenClock.tick()); await assert.doesNotReject(brokenClock.stop());
});

test('Gorgias ignores a completed old selection and reads the new view without publishing the obsolete list', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(); await syncSourceHealth(db, source); const before = (await readSettings(db)).values;
  let release!: () => void, entered!: () => void, calls = 0, writes = 0;
  const inside = new Promise<void>(resolve => {entered = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const worker = new GorgiasWorker(db, source, {clock: () => initial, onWrite: () => {writes++;}, reader: {async readHandover(input) {
    calls++; if (calls === 1) {entered(); await gate;} else assert.equal(input.viewId, '71002');
    return {tickets: [{...ticket, viewId: input.viewId || null}], closedThisWeek: 0};
  }}});
  t.after(() => worker.stop());
  const running = worker.tick(); await inside;
  await db.query("UPDATE pulse.settings SET values=jsonb_set(values,'{gorgiasHandoverViewId}','\"71002\"')");
  release(); await running; assert.equal(writes, 0);
  assert.equal((await readGorgiasHistory(db, source, before, initial)).tickets.length, 0);
  await worker.tick(); assert.equal(calls, 2); assert.equal(writes, 1);
  assert.equal((await readGorgiasFacts(db, source, (await readSettings(db)).values, initial)).tickets.length, 1);
});

test('Gorgias contains storage and notification errors without throwing or turning a good source read into failure', async t => {
  const logs: string[] = []; t.mock.method(console, 'error', (line: string) => logs.push(line));
  const source = env();
  const failed: Database = {query: async () => {throw new Error(source.GORGIAS_API_KEY);},
    transaction: async () => {throw new Error(source.GORGIAS_EMAIL);}, close: async () => {}};
  const unavailable = new GorgiasWorker(failed, source, {clock: () => initial});
  await assert.doesNotReject(unavailable.tick()); await unavailable.stop();
  assert.deepEqual(logs, ['Gorgias poll failed (status: 0, code: storage).', 'Gorgias health update failed (code: storage).']);
  const db = await createTestDatabase(); t.after(() => db.close()); await syncSourceHealth(db, source);
  const worker = new GorgiasWorker(db, source, {clock: () => initial, reader: {readHandover: async () => result()},
    onWrite: async () => {throw new Error(source.GORGIAS_API_KEY);}});
  t.after(() => worker.stop());
  await assert.doesNotReject(worker.tick());
  assert.equal((await readGorgiasFacts(db, source, (await readSettings(db)).values, initial)).status, 'live');
  assert.equal(logs.at(-1), 'Gorgias dashboard refresh failed (code: notification).');
  assert.ok(logs.every(line => !line.includes(source.GORGIAS_API_KEY) && !line.includes(source.GORGIAS_EMAIL)));
});

test('an old selection failure cannot replace the current selection health or delay its next read', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(); await syncSourceHealth(db, source); const before = (await readSettings(db)).values;
  let release!: () => void, entered!: () => void, calls = 0, now = initial;
  const inside = new Promise<void>(resolve => {entered = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const worker = new GorgiasWorker(db, source, {clock: () => now, reader: {async readHandover(input) {
    calls++; if (calls === 1) {entered(); await gate; throw new GorgiasReadError('rate_limit', 429, now.getTime() + 3_600_000);}
    assert.equal(input.viewId, '71002'); return result();
  }}});
  t.after(() => worker.stop()); t.mock.method(console, 'error', () => {});
  const running = worker.tick(); await inside;
  await db.query("UPDATE pulse.settings SET values=jsonb_set(values,'{gorgiasHandoverViewId}','\"71002\"')");
  const current = (await readSettings(db)).values, scope = gorgiasScope(source.GORGIAS_DOMAIN, current);
  await saveGorgiasPoll(db, scope, result(), {weekStart: '2032-04-04T23:00:00.000Z', finishedAt: now,
    nextRun: new Date(now.getTime() + GORGIAS_POLL_MS)});
  release(); await running;
  assert.equal((await readGorgiasSync(db, gorgiasScope(source.GORGIAS_DOMAIN, before)))?.lastError, 'rate_limit');
  const health = (await db.query<{status: string; consecutive_failures: number}>("SELECT status,consecutive_failures FROM pulse.source_health WHERE source='gorgias'")).rows[0]!;
  assert.equal(health.status, 'healthy'); assert.equal(health.consecutive_failures, 0);
  now = new Date(initial.getTime() + GORGIAS_POLL_MS); await worker.tick(); assert.equal(calls, 2);
});

test('the commit checks selection inside its transaction, after the last outside read', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const source = env(); await syncSourceHealth(db, source); const before = (await readSettings(db)).values;
  let switched = false, notified = 0;
  const racing: Database = {...db, transaction: fn => db.transaction(async tx => {
    // Present the transaction with a Settings change after any outside-transaction eligibility check.
    if (!switched) {
      switched = true;
      await tx.query("UPDATE pulse.settings SET values=jsonb_set(values,'{gorgiasHandoverViewId}','\"71002\"')");
    }
    return fn(tx);
  })};
  const worker = new GorgiasWorker(racing, source, {clock: () => initial, reader: {readHandover: async () => result()},
    onWrite: () => {notified++;}});
  t.after(() => worker.stop());
  await worker.tick(); assert.equal(switched, true); assert.equal(notified, 0);
  assert.equal((await readGorgiasHistory(db, source, before, initial)).tickets.length, 0);
  assert.equal((await readGorgiasSync(db, gorgiasScope(source.GORGIAS_DOMAIN, before))), null);
  assert.equal((await db.query<{status: string}>("SELECT status FROM pulse.source_health WHERE source='gorgias'")).rows[0]?.status, 'not_implemented');
});
