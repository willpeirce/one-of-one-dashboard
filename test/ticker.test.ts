import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Auth } from '../src/auth.js';
import type { Database } from '../src/db.js';
import { addDays, ukToday } from '../src/hero-range.js';
import { readRuntime } from '../src/runtime.js';
import { readSettings, saveSettings } from '../src/settings.js';
import { sampleKeyDates, tickerEventKey, tickerState, type KeyDate, type TickerSnapshot } from '../src/ticker/model.js';
import { changeTicker, readTicker } from '../src/ticker/store.js';
import { registerTicker } from '../src/ticker/routes.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2032-04-06T10:00:00Z');
const row = (name = 'Invented launch', date = '2032-04-07'): KeyDate => ({ name, date, note: '', kind: 'spark' });

test('ticker chips cover every day boundary and format the UK year', () => {
  for (const [days, chip] of [[-2, '2 days late'], [-1, '1 day late'], [0, 'today'], [1, 'tomorrow'], [2, 'in 2 days'], [60, 'in 60 days'], [61, 'in 9 weeks']] as const) {
    const state = tickerState([row('Invented date', addDays(ukToday(now), days))], [], now, 'live');
    assert.equal(state.current!.days, days); assert.equal(state.current!.chip, chip);
  }
  assert.equal(tickerState([row()], [], now, 'live').current!.dateLabel, 'Wed 7 Apr');
  assert.equal(tickerState([row('Invented next year', '2033-04-07')], [], now, 'live').current!.dateLabel, 'Thu 7 Apr 2033');
});

test('ticker uses UK calendar days across the autumn clock change, never elapsed 24-hour periods', () => {
  const event = row('Invented clock-change deadline', '2026-10-26');
  for (const instant of ['2026-10-24T23:30:00Z', '2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z', '2026-10-25T23:30:00Z']) {
    assert.equal(tickerState([event], [], new Date(instant), 'live').current!.chip, 'tomorrow');
  }
  assert.equal(tickerState([event], [], new Date('2026-10-26T00:00:00Z'), 'live').current!.chip, 'today');
});

test('normalised event keys, stable late items, current/then sorting, passed timestamps and orphan keys', () => {
  assert.equal(tickerEventKey(row('  Invented   LAUNCH  ')), 'invented launch|2032-04-07');
  const rows = [row('Invented Zebra', '2032-04-07'), row('Invented Late', '2032-04-05'), row('Invented Alpha', '2032-04-07'), row('Invented Later', '2032-05-01')];
  const first = tickerState(rows, [], now, 'live');
  assert.equal(first.current!.name, 'Invented Late');
  assert.deepEqual(first.then.map(item => item.name), ['Invented Alpha', 'Invented Zebra']);
  assert.equal(tickerState(rows, [], new Date('2032-05-03T10:00:00Z'), 'live').current!.name, 'Invented Late');
  const passed = [{ event_key: tickerEventKey(rows[1]!), passed_at: '2032-04-06T09:00:00Z' },
    { event_key: tickerEventKey(rows[3]!), passed_at: '2032-04-06T09:01:00Z' },
    { event_key: 'invented orphan|2032-04-04', passed_at: '2032-04-06T09:02:00Z' }];
  const next = tickerState(rows, passed, now, 'live');
  assert.equal(next.current!.name, 'Invented Alpha'); assert.equal(next.ahead.length, 2);
  assert.deepEqual(next.passed.map(item => item.name), ['Invented Later', 'Invented Late']);
  assert.equal(next.passed[0]!.passed_at, '2032-04-06T09:01:00.000Z');
  assert.equal(tickerState([{...rows[1]!, name: 'Invented edited name'}], passed, now, 'live').ahead.length, 1);
  assert.equal(tickerState([{...rows[1]!, date: '2032-04-06'}], passed, now, 'live').ahead.length, 1);
  assert.deepEqual(tickerState([], passed, now, 'live'), {mode: 'live', current: null, then: [], ahead: [], passed: []});
});

test('sample dates are invented, move with the UK day and start with no passed rows', () => {
  const sample = sampleKeyDates(now);
  assert.deepEqual(tickerState(sample, [], now, 'sample').ahead.map(item => item.days), [-1, 0, 1, 7, 30, 70]);
  assert.ok(sample.every(item => item.name.startsWith('Sample ') && item.note.includes('Sample data')));
  const later = sampleKeyDates(new Date('2032-04-07T10:00:00Z'));
  assert.ok(later.every((item, index) => item.date === addDays(sample[index]!.date, 1)));
  assert.equal(tickerState(sample, [], now, 'sample').passed.length, 0);
});

async function harness(t: TestContext, mode: 'sample' | 'live' = 'live') {
  const db = await createTestDatabase();
  const app = Fastify({logger: false}); await app.register(cookie);
  const config = readRuntime({DATABASE_URL: 'postgresql://localhost/pulse_ticker_test', APP_ORIGIN: 'https://pulse.example.test'});
  const auth = await Auth.create(db, config);
  const credential = randomBytes(32).toString('base64url'), token = randomBytes(32).toString('base64url');
  const secret = (await db.query<{ value: Uint8Array }>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex'), credential]);
  let instant = now;
  registerTicker(app, db, auth, mode, () => instant);
  t.after(async () => { await app.close(); await db.close(); });
  const headers = {cookie: `__Host-pulse_session=${token}`, origin: config.origin, 'content-type': 'application/json'};
  const setDates = async (rows: KeyDate[]) => {
    const settings = await readSettings(db);
    await saveSettings(db, {...settings, values: {...settings.values, keyDates: rows}}, credential);
  };
  return {db, app, credential, headers, setDates, setNow(value: Date) { instant = value; }};
}

test('ticker routes enforce session, origin, JSON, strict payload and the 512-byte limit', async t => {
  const h = await harness(t); await h.setDates([row()]);
  const key = tickerEventKey(row());
  const anonymous = await h.app.inject('/api/ticker');
  assert.equal(anonymous.statusCode, 401); assert.equal(anonymous.headers['cache-control'], 'no-store');
  for (const action of ['next', 'restore']) {
    const url = `/api/ticker/${action}`;
    assert.equal((await h.app.inject({method: 'POST', url, payload: {eventKey: key}})).statusCode, 403);
    assert.equal((await h.app.inject({method: 'POST', url, headers: {...h.headers, origin: 'https://other.example.test'}, payload: {eventKey: key}})).statusCode, 403);
    assert.equal((await h.app.inject({method: 'POST', url, headers: {...h.headers, 'content-type': 'text/plain'}, payload: key})).statusCode, 415);
    assert.equal((await h.app.inject({method: 'POST', url, headers: {origin: h.headers.origin, 'content-type': 'application/json'}, payload: {eventKey: key}})).statusCode, 401);
    assert.equal((await h.app.inject({method: 'POST', url, headers: h.headers, payload: {eventKey: 'x'.repeat(600)}})).statusCode, 413);
    for (const payload of [{}, {eventKey: ''}, {eventKey: 1}, {eventKey: key, extra: true}, []])
      assert.equal((await h.app.inject({method: 'POST', url, headers: h.headers, payload})).statusCode, 400);
    assert.equal((await h.app.inject({method: 'POST', url, headers: h.headers, payload: {eventKey: 'invented missing|2032-04-07'}})).statusCode, 404);
  }
  assert.equal((await h.db.query('SELECT 1 FROM pulse.ticker_passed')).rows.length, 0);
});

test('Next and restore persist idempotently, act on the submitted item and audit every press', async t => {
  const h = await harness(t);
  const rows = [row('Invented first', '2032-04-06'), row('Invented second', '2032-04-07'), row('Invented third', '2032-04-08')];
  await h.setDates(rows);
  const settingsBefore = await readSettings(h.db);
  const initial = await h.app.inject({url: '/api/ticker', headers: h.headers});
  assert.equal(initial.statusCode, 200); assert.equal(initial.headers['cache-control'], 'no-store');
  assert.equal(initial.json<TickerSnapshot>().current!.name, rows[0]!.name);
  const press = async (action: string, key: string) => {
    const response = await h.app.inject({method: 'POST', url: `/api/ticker/${action}`, headers: h.headers, payload: {eventKey: key}});
    assert.equal(response.statusCode, 200); return response.json<TickerSnapshot>();
  };
  const first = await press('next', tickerEventKey(rows[0]!));
  assert.equal(first.current!.name, rows[1]!.name); assert.equal(first.passed.length, 1);
  h.setNow(new Date(now.getTime() + 60_000));
  const duplicate = await press('next', tickerEventKey(rows[0]!));
  assert.equal(duplicate.passed[0]!.passed_at, first.passed[0]!.passed_at);
  const stale = await press('next', tickerEventKey(rows[2]!));
  assert.equal(stale.current!.name, rows[1]!.name, 'A stale screen passes the submitted item, not the current one');
  assert.deepEqual(stale.passed.map(item => item.name), [rows[2]!.name, rows[0]!.name]);
  const reread = (await h.app.inject({url: '/api/ticker', headers: h.headers})).json<TickerSnapshot>();
  assert.deepEqual(reread, stale);
  assert.equal((await press('restore', tickerEventKey(rows[0]!))).current!.name, rows[0]!.name);
  assert.equal((await press('restore', tickerEventKey(rows[0]!))).current!.name, rows[0]!.name);
  const audit = (await h.db.query<{event: string; credential_id: string}>("SELECT event,credential_id FROM pulse.audit_log WHERE event LIKE 'Next up %' ORDER BY id")).rows;
  assert.deepEqual(audit.map(item => item.event), ['Next up passed: Invented first', 'Next up passed: Invented first', 'Next up passed: Invented third', 'Next up put back: Invented first', 'Next up put back: Invented first']);
  assert.ok(audit.every(item => item.credential_id === h.credential));
  assert.deepEqual(await readSettings(h.db), settingsBefore, 'Next never rewrites Settings');
});

test('sample/live passes cannot see or change one another, and orphan Settings keys disappear from reads', async t => {
  const h = await harness(t, 'sample');
  const rows = sampleKeyDates(now); await h.setDates(rows);
  const key = tickerEventKey(rows[0]!);
  await changeTicker(h.db, 'sample', key, 'next', h.credential, now);
  assert.equal((await readTicker(h.db, 'sample', now)).passed.length, 1);
  assert.equal((await readTicker(h.db, 'live', now)).passed.length, 0);
  await changeTicker(h.db, 'live', key, 'next', h.credential, now);
  await changeTicker(h.db, 'sample', key, 'restore', h.credential, now);
  assert.equal((await readTicker(h.db, 'sample', now)).passed.length, 0);
  assert.equal((await readTicker(h.db, 'live', now)).passed.length, 1);
  await h.setDates(rows.slice(1));
  assert.equal((await readTicker(h.db, 'live', now)).passed.length, 0);
  assert.equal((await h.db.query('SELECT 1 FROM pulse.ticker_passed')).rows.length, 1, 'Orphans are ignored, never destructively cleaned');
});

test('audit captions are capped at 80 characters and a failed audit rolls back the pass', async t => {
  const h = await harness(t);
  const long = row(`Invented ${'launch '.repeat(12)}`.trim());
  await h.setDates([long]);
  await changeTicker(h.db, 'live', tickerEventKey(long), 'next', h.credential, now);
  const audit = (await h.db.query<{event: string}>("SELECT event FROM pulse.audit_log WHERE event LIKE 'Next up %'")).rows[0]!;
  assert.equal(audit.event.length, 80); assert.ok(audit.event.startsWith('Next up passed: Invented'));
  await changeTicker(h.db, 'live', tickerEventKey(long), 'restore', h.credential, now);
  await h.db.query("ALTER TABLE pulse.audit_log ADD CONSTRAINT ticker_test_audit_failure CHECK (event NOT LIKE 'Next up passed:%') NOT VALID");
  await assert.rejects(changeTicker(h.db, 'live', tickerEventKey(long), 'next', h.credential, now));
  assert.equal((await readTicker(h.db, 'live', now)).passed.length, 0);
});

test('ticker reads never initialise Settings and presses write only passed dates and audit, even with no Settings row', async t => {
  const h = await harness(t);
  await h.db.query('DELETE FROM pulse.settings');
  const writes: string[] = [];
  const inspect = (db: Database): Database => ({
    query(sql, values) {
      for (const match of sql.matchAll(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(pulse\.[a-z_]+)/gi)) writes.push(match[1]!);
      return db.query(sql, values);
    },
    transaction: fn => db.transaction(tx => fn(inspect(tx))),
    close: async () => {},
  });
  const db = inspect(h.db);
  assert.equal((await readTicker(db, 'live', now)).current, null);
  await assert.rejects(changeTicker(db, 'live', tickerEventKey(row()), 'next', h.credential, now));
  assert.deepEqual(writes, [], 'The no-row fallback is read-only');
  const sample = (await readTicker(db, 'sample', now)).current!;
  await changeTicker(db, 'sample', sample.key, 'next', h.credential, now);
  await changeTicker(db, 'sample', sample.key, 'restore', h.credential, now);
  assert.equal((await h.db.query('SELECT 1 FROM pulse.settings')).rows.length, 0);
  assert.deepEqual(writes, ['pulse.ticker_passed', 'pulse.audit_log', 'pulse.ticker_passed', 'pulse.audit_log']);
  await h.setDates([row()]);
  writes.length = 0;
  await readTicker(db, 'live', now);
  assert.deepEqual(writes, []);
  await changeTicker(db, 'live', tickerEventKey(row()), 'next', h.credential, now);
  await changeTicker(db, 'live', tickerEventKey(row()), 'restore', h.credential, now);
  assert.deepEqual(writes, ['pulse.ticker_passed', 'pulse.audit_log', 'pulse.ticker_passed', 'pulse.audit_log']);
});
