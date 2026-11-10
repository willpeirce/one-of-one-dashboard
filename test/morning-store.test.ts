import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Auth } from '../src/auth.js';
import type { Database } from '../src/db.js';
import { addDays, ukToday } from '../src/hero-range.js';
import { morningFacts, morningKey } from '../src/morning/model.js';
import type { MorningCard, MorningInput, MorningSnapshot, MorningState } from '../src/morning/model-types.js';
import { registerMorning } from '../src/morning/routes.js';
import { pressMorning, readMorning, type MorningPress } from '../src/morning/store.js';
import { readRuntime } from '../src/runtime.js';
import { defaultSettings } from '../src/settings.js';
import { tickerState } from '../src/ticker/model.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2032-04-06T10:00:00Z');
function card(id = 'invented-decision', overrides: Partial<MorningCard> = {}): MorningCard {
  const kind = overrides.kind ?? 'meta-kill', state = overrides.state ?? 'decide';
  return { key: morningKey(kind, id), kind, subjectId: id, sourceScope: 'needs:shopify',
    factsHash: morningFacts(kind, id, state, 'invented-rule'), ruleId: 'invented-rule',
    state, tier: 1, order: 0, title: 'Invented decision', lane: 'Meta', source: 'meta',
    figure: {kind: 'plain', value: '3 days', label: 'Invented cover'}, why: 'Invented reason', rule: 'Invented rule',
    sourceLine: 'Invented stored observation', primary: {kind: 'link', label: 'Open source', href: '/sources'},
    secondary: {kind: 'save', target: 'morning', label: 'Not today', action: 'park'},
    menu: [{kind: 'save', target: 'morning', label: 'Stop showing this', action: 'hide'}], allowedPresses: ['park', 'hide'], ...overrides };
}
function input(cards: MorningCard[] = [card()]): MorningInput {
  return {mode: 'live', needs: [], checks: [], creativeCards: [], ticker: tickerState([], [], now, 'live'), settings: defaultSettings(),
    activity: [], metaActions: [], sourceReadOk: {'needs:shopify': true, adsets: true, ticker: true, tests: true}, extensions: cards, liveTestIds: []};
}
async function harness(t: TestContext, initial = input()) {
  const db = await createTestDatabase(), app = Fastify({logger: false}); await app.register(cookie);
  const config = readRuntime({DATABASE_URL: 'postgresql://localhost/pulse_morning_test', APP_ORIGIN: 'https://pulse.example.test'});
  const auth = await Auth.create(db, config), credential = randomBytes(32).toString('base64url'), token = randomBytes(32).toString('base64url');
  const secret = (await db.query<{value: Uint8Array}>("SELECT value FROM pulse_private.app_secrets WHERE name='session_hmac'")).rows[0]!;
  await db.query('INSERT INTO pulse_private.credentials(id,public_key) VALUES($1,$2)', [credential, randomBytes(32)]);
  await db.query("INSERT INTO pulse_private.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [createHmac('sha256', Buffer.from(secret.value)).update(token).digest('hex'), credential]);
  let instant = now, current = initial, loads = 0;
  const load = async () => { loads++; return current; };
  const service = registerMorning(app, db, auth, load, () => instant);
  t.after(async () => { await app.close(); await db.close(); });
  const headers = {cookie: `__Host-pulse_session=${token}`, origin: config.origin, 'content-type': 'application/json'};
  const read = async () => {
    const response = await app.inject({url: '/api/morning', headers});
    assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
    return response.json<MorningSnapshot>();
  };
  const press = async (action: MorningPress['action'], key = card().key, answer?: 'a' | 'b' | 'draw') => {
    const response = await app.inject({method: 'POST', url: '/api/morning/press', headers,
      payload: {cardKey: key, action, ...(answer ? {answer} : {})}});
    assert.equal(response.statusCode, 200, response.body); return response.json<MorningSnapshot>();
  };
  return {db, app, headers, credential, read, press, service, load, get loads() { return loads; },
    setNow(value: Date) { instant = value; }, setInput(value: MorningInput) { current = value; }};
}

test('Morning routes require a session, local JSON, an exact body and a small payload before loading inputs', async t => {
  const h = await harness(t), payload = {cardKey: card().key, action: 'park'}, url = '/api/morning/press';
  const anonymous = await h.app.inject('/api/morning');
  assert.equal(anonymous.statusCode, 401); assert.equal(anonymous.headers['cache-control'], 'no-store');
  assert.equal((await h.app.inject({method: 'POST', url, payload})).statusCode, 403);
  assert.equal((await h.app.inject({method: 'POST', url, headers: {...h.headers, origin: 'https://other.example.test'}, payload})).statusCode, 403);
  assert.equal((await h.app.inject({method: 'POST', url, headers: {...h.headers, 'content-type': 'text/plain'}, payload: '{}'})).statusCode, 415);
  assert.equal((await h.app.inject({method: 'POST', url, headers: {origin: h.headers.origin, 'content-type': 'application/json'}, payload})).statusCode, 401);
  assert.equal((await h.app.inject({method: 'POST', url, headers: h.headers, payload: {...payload, cardKey: 'x'.repeat(600)}})).statusCode, 413);
  for (const body of [{}, [], null, {...payload, cardKey: ''}, {...payload, action: 'unknown'}, {...payload, until: '2032-04-08'},
    {...payload, answer: 'a'}, {...payload, action: 'call'}, {...payload, action: 'call', answer: 'hold'}]) {
    assert.equal((await h.app.inject({method: 'POST', url, headers: h.headers, payload: JSON.stringify(body)})).statusCode, 400);
  }
  assert.equal(h.loads, 0);
  for (const action of ['park', 'undo']) assert.equal((await h.app.inject({method: 'POST', url, headers: h.headers,
    payload: {cardKey: 'need:invented-missing', action}})).statusCode, 404);
  assert.equal((await h.db.query('SELECT 1 FROM pulse.morning_card_states')).rows.length, 0);
  assert.equal((await h.db.query('SELECT 1 FROM pulse.audit_log')).rows.length, 0);
});

test('Morning offers all nine decisions, persists answers and puts a decision back on Undo', async t => {
  const cards = Array.from({length: 9}, (_, index) => card(`invented-${index}`, {order: index}));
  const h = await harness(t, input(cards));
  assert.equal((await h.read()).cards.length, 9); assert.equal((await h.read()).more, 0);
  for (let index = 0; index < 9; index++) {
    const state = await h.press('park', cards[index]!.key);
    assert.equal(state.completed, index + 1); assert.equal(state.cards.length, 8 - index); assert.equal(state.more, 0);
    assert.equal(state.total, 9);
    assert.equal(state.presses.at(-1)!.untilDay, '2032-04-07');
  }
  assert.equal((await h.read()).cards.length, 0, 'Reloading keeps all nine answers');
  const summary = await h.service.summary();
  assert.equal(summary.snapshot.cards.length, 0);
  assert.deepEqual(summary.openCards, []);
  const repeated = await h.app.inject({method: 'POST', url: '/api/morning/press', headers: h.headers,
    payload: {cardKey: cards[8]!.key, action: 'park'}});
  assert.equal(repeated.statusCode, 409, 'An answered card cannot be pressed twice');
  assert.equal((await h.db.query('SELECT 1 FROM pulse.audit_log')).rows.length, 9);
  const undone = await h.press('undo', cards[3]!.key);
  assert.equal(undone.completed, 8); assert.equal(undone.cards.length, 1); assert.equal(undone.cards[0]!.key, cards[3]!.key);
  assert.equal(undone.parked.length, 8);
  const audits = (await h.db.query<{event: string; credential_id: string}>('SELECT event,credential_id FROM pulse.audit_log ORDER BY id')).rows;
  assert.equal(audits.length, 10); assert.ok(audits.every(row => row.credential_id === h.credential));
  assert.match(audits.at(-1)!.event, /^Morning put back:/);
  h.setNow(new Date('2032-04-07T10:00:00Z'));
  const tomorrow = await h.read(); assert.equal(tomorrow.completed, 0); assert.equal(tomorrow.cards.length, 9);
  assert.equal((await h.db.query('SELECT 1 FROM pulse.morning_card_states')).rows.length, 0);
});

test('Morning refuses excluded and unavailable presses and keeps server-owned seen, hold and call dates', async t => {
  const alarm = card('invented-alarm', {kind: 'need', state: 'alarm', tier: 0, allowedPresses: ['ack']});
  const date = card('invented-date', {kind: 'date', state: 'info', eventDate: '2032-04-16', allowedPresses: ['remind', 'park', 'hide']});
  const held = card('invented-step', {kind: 'meta-step', sourceScope: 'adsets', state: 'decide', allowedPresses: ['hold', 'park']});
  const verdict = card('invented-verdict', {kind: 'new-verdict', state: 'info', seenUntilDay: '2032-04-09', allowedPresses: ['ack']});
  const call = card('invented-test', {kind: 'test-call', sourceScope: 'tests', callAnswer: 'a', allowedPresses: ['call', 'park']});
  const data = {...input([alarm, date, held, verdict, call]), liveTestIds: [call.subjectId]};
  const h = await harness(t, data), url = '/api/morning/press';
  for (const action of ['park', 'hide', 'hold']) assert.equal((await h.app.inject({method: 'POST', url, headers: h.headers,
    payload: {cardKey: alarm.key, action}})).statusCode, 409);
  const seen = (await h.press('ack', alarm.key)).presses.find(row => row.cardKey === alarm.key)!;
  assert.equal(seen.untilDay, '2032-04-07');
  for (const [excluded, action] of [[date, 'remind'], [verdict, 'ack']] as const)
    assert.equal((await h.app.inject({method: 'POST', url, headers: h.headers, payload: {cardKey: excluded.key, action}})).statusCode, 409);
  const hold = (await h.press('hold', held.key)).answers.find(row => row.cardKey === held.key)!;
  assert.equal(hold.answer, 'hold'); assert.equal(hold.untilDay, '2032-04-13');
  assert.equal((await h.app.inject({method: 'POST', url, headers: h.headers, payload: {cardKey: call.key, action: 'call', answer: 'b'}})).statusCode, 409);
  const called = (await h.press('call', call.key, 'a')).answers.find(row => row.cardKey === call.key)!;
  assert.equal(called.answer, 'a'); assert.equal(called.untilDay, null);
  assert.equal((await h.app.inject({method: 'POST', url, headers: h.headers, payload: {cardKey: held.key, action: 'hold'}})).statusCode, 409);
  h.setInput({...data, liveTestIds: []});
  const afterWriteup = await h.read(); assert.ok(!afterWriteup.answers.some(row => row.cardKey === call.key));
  assert.ok(afterWriteup.presses.find(row => row.cardKey === call.key)!.clearedAt, 'A cleared answer retains today’s slot');
});

test('stored reminders and verdict acknowledgements still load and expire without entering decision progress', async t => {
  const date = card('invented-old-date', {kind: 'date', state: 'info', eventDate: '2032-04-16'});
  const verdict = card('invented-old-verdict', {kind: 'new-verdict', state: 'info', seenUntilDay: '2032-04-09'});
  const h = await harness(t, input([date, verdict]));
  for (const [item, state, until] of [[date, 'parked', '2032-04-13'], [verdict, 'seen', '2032-04-09']] as const) {
    await h.db.query(`INSERT INTO pulse.morning_card_states(mode,card_key,state,until_day,facts_hash,answer,credential_id,
      pressed_at,title,card_kind,subject_id,source_scope) VALUES('live',$1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10)`,
    [item.key, state, until, item.factsHash, h.credential, now, item.title, item.kind, item.subjectId, item.sourceScope]);
  }
  const loaded = await h.read();
  assert.equal(loaded.cards.length, 0); assert.equal(loaded.completed, 0); assert.equal(loaded.total, 0);
  assert.equal(loaded.parked[0]!.untilDay, '2032-04-13');
  assert.equal(loaded.presses.find(row => row.cardKey === verdict.key)!.untilDay, '2032-04-09');
  await h.press('undo', date.key);
  assert.equal((await h.read()).parked.length, 0, 'An old reminder can still be put back');
  h.setNow(new Date('2032-04-09T10:00:00Z'));
  assert.equal((await h.read()).presses.length, 0);
  assert.equal((await h.db.query('SELECT 1 FROM pulse.morning_card_states')).rowCount, 0);
});

test('Home and Morning can confirm a ready test after seven alarms, while parked, answered and wrong calls stay refused', async t => {
  const alarms = Array.from({length: 7}, (_, index) => card(`invented-urgent-${index}`, {kind: 'need', state: 'alarm', tier: 0, order: index, allowedPresses: ['ack']}));
  const call = card('invented-overflow-test', {kind: 'test-call', state: 'decide', tier: 1, sourceScope: 'tests',
    callAnswer: 'a', allowedPresses: ['call', 'park']});
  const data = {...input([...alarms, call]), liveTestIds: [call.subjectId]};
  const h = await harness(t, data), initial = await h.read();
  assert.equal(initial.cards.length, 8); assert.equal(initial.more, 0);
  assert.equal(initial.cards.at(-1)!.key, call.key);
  const post = (action: string, answer?: string) => h.app.inject({method: 'POST', url: '/api/morning/press', headers: h.headers,
    payload: {cardKey: call.key, action, ...(answer ? {answer} : {})}});
  assert.equal((await post('call', 'b')).statusCode, 409);
  const called = await h.press('call', call.key, 'a');
  assert.equal(called.answers.find(row => row.cardKey === call.key)?.answer, 'a');
  assert.equal(called.completed, 1); assert.equal(called.cards.length, 7);
  assert.equal((await post('call', 'a')).statusCode, 409, 'An answered call cannot be repeated');
  assert.equal((await h.db.query('SELECT 1 FROM pulse.audit_log')).rowCount, 1);
  await h.press('undo', call.key);
  h.setInput({...data, extensions: [call]});
  await h.press('park', call.key);
  h.setInput(data);
  assert.equal((await post('call', 'a')).statusCode, 409, 'An effective parked answer also applies on Home');
  await h.press('undo', call.key);
  h.setInput({...data, extensions: [...alarms, {...call, allowedPresses: [], callAnswer: undefined}]});
  assert.equal((await post('call', 'a')).statusCode, 409, 'The current rule must still offer the call');
});

test('Morning hidden state survives changed figures and failed reads, then clears safely', async t => {
  const original = card(), data = input([original]), h = await harness(t, data);
  await h.press('hide');
  h.setInput(input([{...original, figure: {kind: 'plain', value: '2 days', label: 'Invented cover'}}]));
  assert.equal((await h.read()).hidden.length, 1);
  h.setInput({...input([]), sourceReadOk: {'needs:shopify': false}});
  assert.equal((await h.read()).hidden.length, 1, 'A failed source cannot clear a hidden answer');
  h.setInput(input([]));
  const cleared = await h.read(); assert.equal(cleared.hidden.length, 0); assert.equal(cleared.completed, 1);
  assert.ok(cleared.presses[0]!.clearedAt);
  h.setInput(data);
  assert.equal((await h.read()).cards[0]!.key, original.key, 'A rule that returns after clearing is shown again');
  await h.press('undo');
  assert.equal((await h.read()).completed, 0);
  await h.press('hide');
  h.setInput(input([{...original, ruleId: 'invented-worse-rule', factsHash: morningFacts('need', original.subjectId, 'warn', 'invented-worse-rule')} ]));
  assert.equal((await h.read()).hidden.length, 0);
  h.setNow(new Date('2032-04-07T10:00:00Z'));
  await h.read(); assert.equal((await h.db.query('SELECT 1 FROM pulse.morning_card_states')).rows.length, 0);
});

test('Morning holds survive absent or changed proposals and end only on their server-owned UK day', async t => {
  const step = card('invented-held-set', {kind: 'meta-step', sourceScope: 'adsets', allowedPresses: ['hold']});
  const h = await harness(t, input([step])); await h.press('hold', step.key);
  h.setInput(input([])); h.setNow(new Date('2032-04-08T10:00:00Z'));
  assert.equal((await h.read()).answers[0]!.answer, 'hold');
  h.setInput(input([{...step, factsHash: morningFacts('meta-step', step.subjectId, 'decide', 'another-proposal')} ]));
  assert.equal((await h.read()).cards.length, 0);
  h.setNow(new Date('2032-04-13T10:00:00Z'));
  assert.equal((await h.read()).cards[0]!.key, step.key); assert.equal((await h.read()).answers.length, 0);
});

test('Morning sample and live rows cannot see or undo each other and its table is private', async t => {
  const data = input(), h = await harness(t, {...data, mode: 'sample'});
  await h.press('park');
  h.setInput(data); assert.equal((await h.read()).parked.length, 0);
  assert.equal((await h.app.inject({method: 'POST', url: '/api/morning/press', headers: h.headers, payload: {cardKey: card().key, action: 'undo'}})).statusCode, 404);
  await h.press('hide');
  assert.equal((await h.db.query('SELECT 1 FROM pulse.morning_card_states')).rows.length, 2);
  h.setInput({...data, mode: 'sample'}); await h.press('undo');
  h.setInput(data); assert.equal((await h.read()).hidden.length, 1);
  const permissions = await h.db.query(`SELECT 1 FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl
    WHERE c.oid='pulse.morning_card_states'::regclass AND acl.grantee=0`);
  assert.equal(permissions.rows.length, 0);
});

test('Morning presses around UK midnight use the right day in summer and winter', async t => {
  const h = await harness(t);
  for (const [before, after] of [['2032-06-14T22:59:00Z', '2032-06-14T23:01:00Z'], ['2032-12-14T23:59:00Z', '2032-12-15T00:01:00Z']]) {
    h.setNow(new Date(before!));
    const parked = await h.press('park');
    assert.equal(parked.day, ukToday(new Date(before!)));
    assert.equal(parked.parked[0]!.untilDay, addDays(parked.day, 1));
    h.setNow(new Date(after!));
    const returned = await h.read(); assert.equal(returned.day, ukToday(new Date(after!))); assert.equal(returned.completed, 0);
    const again = await h.press('park'); assert.equal(again.presses.length, 1); assert.equal(again.presses[0]!.pressedAt, new Date(after!).toISOString());
    await h.press('undo');
  }
});

test('Morning loads inputs outside sequential state transactions, audits once, and rolls back a failed audit', async t => {
  const long = card('invented-long-title', {title: `Invented ${'🌱'.repeat(100)}`}), data = input([long]);
  const h = await harness(t, data), writes: string[] = [];
  let inTransaction = false, pending = false;
  const inspect = (db: Database): Database => ({
    async query(sql, values) {
      assert.equal(pending, false, 'Queries on a transaction client remain sequential'); pending = true;
      try {
        for (const match of sql.matchAll(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(pulse\.[a-z_]+)/gi)) writes.push(match[1]!);
        return await db.query(sql, values);
      } finally { pending = false; }
    },
    transaction: fn => db.transaction(async tx => { inTransaction = true; try { return await fn(inspect(tx)); } finally { inTransaction = false; } }),
    close: async () => {},
  });
  const db = inspect(h.db), load = async () => { assert.equal(inTransaction, false); return data; };
  await readMorning(db, load, now); assert.deepEqual(writes, []);
  await pressMorning(db, load, {cardKey: long.key, action: 'park'}, h.credential, now);
  assert.deepEqual(writes, ['pulse.morning_card_states', 'pulse.audit_log']);
  const audit = (await h.db.query<{event: string}>('SELECT event FROM pulse.audit_log')).rows[0]!;
  assert.equal(Array.from(audit.event).length, 80);
  await pressMorning(db, load, {cardKey: long.key, action: 'undo'}, h.credential, now);
  await h.db.query("ALTER TABLE pulse.audit_log ADD CONSTRAINT morning_audit_test_failure CHECK(event NOT LIKE 'Morning parked:%') NOT VALID");
  await assert.rejects(pressMorning(db, load, {cardKey: long.key, action: 'park'}, h.credential, now));
  assert.equal((await readMorning(h.db, load, now)).completed, 0);
  assert.equal((await h.db.query('SELECT 1 FROM pulse.audit_log')).rows.length, 2);
});

test('lazy cleanup failures roll back to a savepoint while reads and audited presses still succeed', async t => {
  const original = card(), h = await harness(t, input([original])); await h.press('hide');
  const logs: string[] = []; t.mock.method(console, 'warn', (line: string) => logs.push(line));
  await h.db.query(`CREATE FUNCTION pulse.reject_morning_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF TG_OP='DELETE' OR NEW.cleared_at IS DISTINCT FROM OLD.cleared_at THEN RAISE EXCEPTION 'Invented cleanup failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_cleanup BEFORE UPDATE OR DELETE ON pulse.morning_card_states FOR EACH ROW EXECUTE FUNCTION pulse.reject_morning_cleanup()`);
  const changed = {...original, factsHash: morningFacts('need', original.subjectId, 'warn', 'changed-rule')}, second = card('invented-second');
  h.setInput(input([changed, second]));
  assert.equal((await h.read()).cards[0]!.key, original.key);
  assert.equal((await h.press('park', second.key)).parked[0]!.stateRow.cardKey, second.key);
  h.setNow(new Date('2032-04-07T10:00:00Z'));
  assert.equal((await h.read()).cards.length, 2);
  assert.ok(logs.length >= 3); assert.ok(logs.every(line => line === 'Morning state cleanup failed; using the current projection.'));
  assert.equal((await h.db.query('SELECT 1 FROM pulse.audit_log')).rowCount, 2, 'Cleanup errors do not roll back the successful audited press');
});

test('hold accepts only three or seven days with exact keys and a three-day hold returns on the fourth day', async t => {
  const held = card('invented-short-hold', {allowedPresses: ['hold', 'park']});
  const h = await harness(t, input([held])), url = '/api/morning/press';
  const base = {cardKey: held.key, action: 'hold'};
  for (const payload of [
    ...[0, 1, 2, 4, 6, 8, -3, 3.5, '3', null, true].map(days => ({...base, days})),
    {...base, days: 3, extra: 'invented'}, {...base, action: 'park', days: 3},
    {...base, action: 'undo', days: 7}, {...base, days: 7, answer: 'a'},
  ]) assert.equal((await h.app.inject({method: 'POST', url, headers: h.headers, payload})).statusCode, 400);
  assert.equal(h.loads, 0, 'Bad durations and extra keys are refused before any input read');
  const three = await h.app.inject({method: 'POST', url, headers: h.headers, payload: {...base, days: 3}});
  assert.equal(three.statusCode, 200);
  assert.equal(three.json<MorningSnapshot>().answers[0]!.untilDay, '2032-04-09');
  h.setNow(new Date('2032-04-08T22:59:59Z'));
  assert.equal((await h.read()).cards.length, 0);
  h.setNow(new Date('2032-04-08T23:00:00Z'));
  assert.equal((await h.read()).cards[0]!.key, held.key, 'Fourth UK day begins at BST midnight');
  const seven = await h.app.inject({method: 'POST', url, headers: h.headers, payload: {...base, days: 7}});
  assert.equal(seven.statusCode, 200);
  assert.equal(seven.json<MorningSnapshot>().answers[0]!.untilDay, '2032-04-16');
  await h.press('undo', held.key);
  assert.equal((await h.press('hold', held.key)).answers[0]!.untilDay, '2032-04-16', 'Omitted days still means seven');
});
