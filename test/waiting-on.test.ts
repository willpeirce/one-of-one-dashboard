import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type {Auth} from '../src/auth.js';
import {ukToday} from '../src/hero-range.js';
import {parseWaiting} from '../src/github-hq/parse-waiting.js';
import {WAITING_CONTACT_LIMIT, WAITING_SUBJECT_LIMIT, WaitingValidationError, validateWaitingInput,
  waitingDays, waitingDoneUntil, waitingTextSafe, type WaitingView} from '../src/waiting-on/model.js';
import {addWaitingItem, changeWaitingItem, readWaitingView, replaceWaitingFile, waitingIdentity} from '../src/waiting-on/store.js';
import {waitingNeeds} from '../src/waiting-on/needs.js';
import {registerWaitingOn} from '../src/waiting-on/routes.js';
import {createTestDatabase} from './helpers/database.js';

const now = new Date('2037-10-26T12:00:00Z');
const row = {contact: 'A supplier', subject: 'Invented proof approval', since: '2037-10-18'};
const source = (rows = [row]) => '# Waiting on others\nUpdated: 2037-10-26 12:00 UK\n\n| Contact | Subject | Since |\n| --- | --- | --- |\n'
  + rows.map(item => `| ${item.contact} | ${item.subject} | ${item.since} |`).join('\n');

test('waiting text uses bounded plain business summaries and refuses contact details without echoing values', () => {
  const accepted = validateWaitingInput({contact: ` ${row.contact} `, subject: ` ${row.subject} `, since: row.since}, now);
  assert.deepEqual(accepted, row);
  assert.equal(validateWaitingInput({...row, contact: '界'.repeat(WAITING_CONTACT_LIMIT), subject: '𐐀'.repeat(WAITING_SUBJECT_LIMIT)}, now).subject.length, 480);
  assert.equal(waitingTextSafe('Invented order #123456, quote £80.00'), true);
  for (const value of ['invented@example.test', '界@example.test', '+44 1234 000000', '01234 000000', '(555) 123-4567', '5551234567',
    'https://example.test/private', 'www.example.test', 'AB1 2CD', 'ZIP 12345', '12345-6789',
    '12 Invented Fern Road', '25 Invented-Cedar Court', 'PO Box 456', 'Invented City XY 12345', 'bad\0text', 'bad\ntext']) {
    assert.equal(waitingTextSafe(value), false, value);
    for (const field of ['contact', 'subject']) assert.throws(() => validateWaitingInput({...row, [field]: value}, now),
      (error: unknown) => error instanceof WaitingValidationError && !error.message.includes(value));
  }
  for (const invalid of [null, [], {}, {...row, extra: true}, {...row, contact: ''}, {...row, subject: 'x'.repeat(241)},
    {...row, since: '2037-02-30'}, {...row, since: '2037-10-27'}, {...row, since: '37-10-18'}])
    assert.throws(() => validateWaitingInput(invalid, now), WaitingValidationError);
});

test('waiting days and Done expiry use UK date labels across the invented 25 October clock change', () => {
  assert.equal(waitingDays('2037-10-24', new Date('2037-10-24T23:30:00Z')), 1);
  assert.equal(waitingDays('2037-10-24', new Date('2037-10-25T23:30:00Z')), 1);
  assert.equal(waitingDays('2037-10-24', new Date('2037-10-26T00:00:00Z')), 2);
  assert.equal(waitingDays('2037-10-28', now), 0);
  assert.equal(waitingDoneUntil('2037-09-25T10:00:00Z'), '2037-10-25');
  assert.equal(ukToday(new Date('2037-10-24T23:00:00Z')), '2037-10-25');
});

test('manual rows are local across HQ modes; repeated Add, Done and Put back are audited only once', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const id = await addWaitingItem(db, row, 'invented-device', now);
  assert.equal(await addWaitingItem(db, row, 'invented-device', now), id);
  for (const mode of ['sample', 'live'] as const) {
    const view = await readWaitingView(db, mode, now);
    assert.equal(view.rows.length, 1); assert.equal(view.rows[0]!.source, 'manual'); assert.equal(view.rows[0]!.days, 8);
  }
  assert.equal((await readWaitingView(db, 'sample', now)).status, 'waiting_for_keys');
  await changeWaitingItem(db, 'sample', id, 'done', 'invented-device', now);
  await changeWaitingItem(db, 'sample', id, 'done', 'invented-device', new Date(+now + 1000));
  const hidden = await readWaitingView(db, 'live', now);
  assert.equal(hidden.rows.length, 0); assert.equal(hidden.done.length, 1); assert.equal(hidden.done[0]!.doneAt, now.toISOString());
  await changeWaitingItem(db, 'sample', id, 'restore', 'invented-device', now);
  await changeWaitingItem(db, 'sample', id, 'restore', 'invented-device', now);
  assert.equal((await readWaitingView(db, 'sample', now)).rows.length, 1);
  const audit = (await db.query<{event: string}>('SELECT event FROM pulse.audit_log ORDER BY id')).rows.map(item => item.event);
  assert.deepEqual(audit, ['Waiting item added', 'Waiting item done', 'Waiting item put back']);
  assert.doesNotMatch(JSON.stringify(audit), /supplier|proof|2037|hq:|manual:/u);
});

test('the imported file keeps its first sixty rows without preventing more hand-added local rows', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const imports = Array.from({length: 61}, (_, index) => ({...row, subject: `Invented import ${index}`}));
  await replaceWaitingFile(db, parseWaiting(source(imports)), now);
  for (let index = 0; index < 61; index++) await addWaitingItem(db, {...row, subject: `Invented manual ${index}`}, 'invented-device', now);
  const view = await readWaitingView(db, 'live', now);
  assert.equal(view.rows.length, 121); assert.equal(view.cappedRows, 1);
  assert.deepEqual(new Set(view.rows.filter(item => item.source === 'hq').map(item => item.subject)), new Set(imports.slice(0, 60).map(item => item.subject)));
  assert.equal((await readWaitingView(db, 'sample', now)).rows.length, 61);
});

test('Done survives a partial file omission and clears only on clean absence or thirty UK days', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const doneAt = new Date('2037-09-25T10:00:00Z');
  const first = {...row, since: '2037-09-18'};
  await replaceWaitingFile(db, parseWaiting(source([first])), doneAt);
  const id = waitingIdentity('hq', first);
  await changeWaitingItem(db, 'live', id, 'done', 'invented-device', doneAt);
  await replaceWaitingFile(db, {...parseWaiting(source([])), skippedRows: 1}, new Date(+doneAt + 1000));
  assert.equal((await db.query('SELECT 1 FROM pulse.waiting_on_done WHERE item_id=$1', [id])).rowCount, 1);
  await replaceWaitingFile(db, parseWaiting(source([first])), new Date(+doneAt + 2000));
  assert.equal((await readWaitingView(db, 'live', new Date('2037-10-24T22:59:59Z'))).done.length, 1);
  assert.equal((await readWaitingView(db, 'live', new Date('2037-10-24T23:00:00Z'))).rows.length, 1);
  await changeWaitingItem(db, 'live', id, 'done', 'invented-device', now);
  await replaceWaitingFile(db, {...parseWaiting(source([])), cappedRows: 1}, now);
  await replaceWaitingFile(db, parseWaiting(source([first])), now);
  assert.equal((await readWaitingView(db, 'live', now)).done.length, 1);
  await replaceWaitingFile(db, parseWaiting(source([])), now);
  assert.equal((await db.query('SELECT 1 FROM pulse.waiting_on_done WHERE item_id=$1', [id])).rowCount, 0);
  await replaceWaitingFile(db, parseWaiting(source([first])), now);
  assert.equal((await readWaitingView(db, 'live', now)).rows.length, 1);
});

test('missing files clear imported rows and Done markers while preserving local rows and their answers', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await replaceWaitingFile(db, parseWaiting(source()), now);
  const manual = await addWaitingItem(db, row, 'invented-device', now), imported = waitingIdentity('hq', row);
  await changeWaitingItem(db, 'live', imported, 'done', 'invented-device', now);
  await changeWaitingItem(db, 'live', manual, 'done', 'invented-device', now);
  await replaceWaitingFile(db, null, now);
  const view = await readWaitingView(db, 'live', now);
  assert.equal(view.status, 'missing'); assert.equal(view.rows.length, 0); assert.equal(view.done.length, 1); assert.equal(view.done[0]!.id, manual);
  assert.equal((await db.query('SELECT 1 FROM pulse.waiting_on_done')).rowCount, 1);
  await replaceWaitingFile(db, parseWaiting(source()), now);
  assert.equal((await readWaitingView(db, 'live', now)).rows[0]!.id, imported);
  await assert.rejects(changeWaitingItem(db, 'sample', imported, 'done', 'invented-device', now));
});

test('failed import storage rolls back together and source failure retains its last good rows with an unavailable label', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await replaceWaitingFile(db, parseWaiting(source()), now);
  const before = await readWaitingView(db, 'live', now);
  await assert.rejects(replaceWaitingFile(db, {...parseWaiting(source()), rows: [{...row, subject: 'Invented next'}, {...row, contact: 'private@example.test'}]}, now));
  assert.deepEqual(await readWaitingView(db, 'live', now), before);
  await db.query(`INSERT INTO pulse.github_hq_reads(target_key,path,ref,error_code) VALUES('waiting-on','ops/waiting-on/latest.md','main','timeout')`);
  const failed = await readWaitingView(db, 'live', now);
  assert.equal(failed.status, 'unavailable'); assert.deepEqual(failed.rows, before.rows);
});

test('waiting need starts exactly at the configured bar, excludes Done, and never treats real manual rows as sample', () => {
  const view: WaitingView = {mode: 'sample', status: 'waiting_for_keys', updatedLabel: null, readAt: null, asOf: now.toISOString(),
    malformedRows: 0, cappedRows: 0, thresholdDays: 7, rows: [], done: []};
  assert.deepEqual(waitingNeeds(view), []);
  view.rows = [{...row, id: 'manual:invented', source: 'manual', days: 6}];
  assert.deepEqual(waitingNeeds(view), []);
  view.rows[0]!.days = 7;
  const need = waitingNeeds(view)[0]!;
  assert.equal(need.title, '1 waiting on others over 7 days'); assert.equal(need.state, 'warn'); assert.equal(need.sourceMode, 'live');
  assert.equal(need.link, '/handover'); assert.equal(need.source, 'github-hq');
  view.thresholdDays = 8; assert.deepEqual(waitingNeeds(view), []);
});

test('waiting routes authenticate, enforce exact own-origin JSON, and return fresh committed views without source writes', async t => {
  const db = await createTestDatabase(), app = Fastify({logger: false}); t.after(async () => {await app.close(); await db.close();});
  let reads = 0, publishes = 0;
  const origin = 'https://pulse.example.test', headers = {origin, authorization: 'invented-session', 'content-type': 'application/json'};
  const auth = {config: {origin}, session: async (request: {headers: Record<string, unknown>}) =>
    request.headers.authorization === 'invented-session' ? 'invented-device' : null} as unknown as Auth;
  registerWaitingOn(app, db, auth, {mode: 'sample', clock: () => now,
    loadView: async at => {reads++; return readWaitingView(db, 'sample', at);}, publish: async () => {publishes++;}});
  assert.equal((await app.inject('/api/waiting-on')).statusCode, 401); assert.equal(reads, 0);
  for (const action of ['add', 'done', 'restore']) {
    const url = `/api/waiting-on/${action}`, payload = action === 'add' ? row : {id: waitingIdentity('manual', row)};
    assert.equal((await app.inject({method: 'POST', url, payload})).statusCode, 403);
    assert.equal((await app.inject({method: 'POST', url, headers: {...headers, origin: 'https://other.example.test'}, payload})).statusCode, 403);
    assert.equal((await app.inject({method: 'POST', url, headers: {origin, authorization: 'invented-session', 'content-type': 'text/plain'}, payload: '{}'})).statusCode, 415);
    assert.equal((await app.inject({method: 'POST', url, headers: {origin, 'content-type': 'application/json'}, payload})).statusCode, 401);
    assert.equal((await app.inject({method: 'POST', url, headers, payload: {...payload, extra: true}})).statusCode, 400);
  }
  assert.equal(reads, 0); assert.equal(publishes, 0);
  const added = await app.inject({method: 'POST', url: '/api/waiting-on/add', headers, payload: row});
  assert.equal(added.statusCode, 200); assert.equal(added.headers['cache-control'], 'no-store');
  const item = added.json<{view: WaitingView}>().view.rows[0]!;
  const done = await app.inject({method: 'POST', url: '/api/waiting-on/done', headers, payload: {id: item.id}});
  assert.equal(done.statusCode, 200); assert.equal(done.json<{view: WaitingView}>().view.rows.length, 0); assert.equal(done.json<{view: WaitingView}>().view.done[0]!.id, item.id);
  const restored = await app.inject({method: 'POST', url: '/api/waiting-on/restore', headers, payload: {id: item.id}});
  assert.equal(restored.json<{view: WaitingView}>().view.rows.length, 1);
  assert.equal(publishes, 3);
  assert.equal((await app.inject({method: 'POST', url: '/api/waiting-on/done', headers, payload: {id: `manual:${'a'.repeat(64)}`}})).statusCode, 404);
  const invalid = await app.inject({method: 'POST', url: '/api/waiting-on/add', headers, payload: {...row, subject: 'private@example.test'}});
  assert.equal(invalid.statusCode, 400); assert.ok(!invalid.body.includes('private@example.test'));
});

test('a committed waiting write keeps its receipt when publishing, logging and the fresh read fail', async t => {
  const db = await createTestDatabase(), app = Fastify({logger: false}); t.after(async () => {await app.close(); await db.close();});
  const origin = 'https://pulse.example.test';
  const auth = {config: {origin}, session: async () => 'invented-device'} as unknown as Auth;
  registerWaitingOn(app, db, auth, {mode: 'sample', clock: () => now,
    loadView: async () => {throw new Error('Invented read failure');}, publish: async () => {throw new Error('Invented publish failure');}});
  t.mock.method(console, 'warn', () => {throw new Error('Invented diagnostic failure');});
  const response = await app.inject({method: 'POST', url: '/api/waiting-on/add',
    headers: {origin, 'content-type': 'application/json'}, payload: row});
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {saved: true, view: null, message: 'Saved. Refresh to see the waiting items.'});
  assert.equal((await readWaitingView(db, 'sample', now)).rows.length, 1);
  assert.equal((await db.query("SELECT 1 FROM pulse.audit_log WHERE event='Waiting item added'")).rowCount, 1);
});
