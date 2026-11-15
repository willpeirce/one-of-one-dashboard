import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import type {Database} from '../src/db.js';
import {HQReadError, HQ_WAITING_PARSER_VERSION} from '../src/github-hq/client.js';
import {parseWaiting} from '../src/github-hq/parse-waiting.js';
import {beginHQRead, failHQRead, readHQSync, saveHQWaiting, saveHQWaitingMissing, touchHQRead} from '../src/github-hq/store.js';
import {HQWorker, HQ_HOURLY_MS} from '../src/github-hq/worker.js';
import {readSourceHealth, syncSourceHealth} from '../src/sources.js';
import {addWaitingItem, changeWaitingItem, readWaitingView} from '../src/waiting-on/store.js';
import {createTestDatabase} from './helpers/database.js';

const now = new Date('2032-04-07T12:00:00Z');
const waiting = (rows = '| A supplier | Invented carton proof | 2032-03-30 |') =>
  `# Invented waiting\nUpdated: 2032-04-07 09:20 UK\n| Contact | Subject | Since |\n| --- | --- | --- |\n${rows}`;
const month = '## 2032-04-06 (Tue), run 7 Apr 07:40\n**Needs Will:** nothing.';
const register = '## Watches (kill rules, not tests)\n## Live\n## Queue\n## History';
const env = () => ({GITHUB_HQ_TOKEN: randomBytes(24).toString('hex')});
const quiet = {log: () => {}, sleep: async () => {}};
const source = async (db: Database) => (await readSourceHealth(db)).find(row => row.source === 'github-hq')!;
const metadata = async (db: Database) => (await readHQSync(db, [{kind: 'waiting'}])).get('waiting-on')!;
const otherFile = (url: URL) => new Response(url.pathname.endsWith('/register.md') ? register : month);

test('waiting migration permits only the new fixed main path, replays, and preserves existing targets', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await beginHQRead(db, {kind: 'waiting'}, now);
  await beginHQRead(db, {kind: 'register'}, now);
  await beginHQRead(db, {kind: 'month', month: '2032-04', ref: 'claude/ads-daily'}, now);
  const sql = await readFile(new URL('../migrations/073_waiting_on.sql', import.meta.url), 'utf8');
  await db.query(sql); await db.query(sql);
  assert.equal((await metadata(db)).lastAttemptAt, now.toISOString());
  for (const [path, ref] of [['ops/waiting-on/other.md', 'main'], ['ops/waiting-on/latest.md', 'claude/ads-daily'], ['ops/tests/register.md', 'claude/ads-daily']]) {
    await assert.rejects(db.query('INSERT INTO pulse.github_hq_reads(target_key,path,ref) VALUES($1,$2,$3)', ['invented-invalid', path, ref]), /check constraint/);
  }
});

test('waiting parsed rows and metadata commit together, and 304 preserves Done and diagnostics', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const parsed = parseWaiting(waiting());
  await saveHQWaiting(db, parsed, '"invented-first"', now);
  const first = await readWaitingView(db, 'live', now), item = first.rows[0]!;
  await changeWaitingItem(db, 'live', item.id, 'done', 'invented-device', now);
  const partial = parseWaiting(waiting('| A supplier | Invented carton proof | 2032-03-30 |\n| Invented malformed |'));
  await saveHQWaiting(db, partial, '"invented-partial"', now);
  const later = new Date(+now + HQ_HOURLY_MS);
  await touchHQRead(db, {kind: 'waiting'}, null, later);
  const touched = await readWaitingView(db, 'live', later);
  assert.equal(touched.done.length, 1); assert.equal(touched.rows.length, 0);
  assert.equal(touched.readAt, later.toISOString()); assert.equal(touched.malformedRows, 1);
  assert.equal((await metadata(db)).etag, '"invented-partial"');
  const failMetadata = (connection: Database): Database => ({...connection,
    query: async (sql, values) => {
      if (sql.startsWith('INSERT INTO pulse.github_hq_reads') && values?.[0] === 'waiting-on') throw new Error('Invented metadata failure');
      return connection.query(sql, values);
    },
    transaction: callback => connection.transaction(tx => callback(failMetadata(tx))),
  });
  await assert.rejects(saveHQWaiting(failMetadata(db), parseWaiting(waiting('| Invented studio | Different proof | 2032-04-01 |')), '"invented-failed"', later));
  assert.deepEqual(await readWaitingView(db, 'live', later), touched, 'Rows, Done markers and metadata roll back as one unit');
  assert.equal((await metadata(db)).etag, '"invented-partial"');
});

test('unreadable waiting retains the last good file, while confirmed missing clears only HQ items and Done', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await saveHQWaiting(db, parseWaiting(waiting()), '"invented-first"', now);
  const first = (await readWaitingView(db, 'live', now)).rows[0]!;
  await changeWaitingItem(db, 'live', first.id, 'done', 'invented-device', now);
  const manual = await addWaitingItem(db, {contact: 'Invented studio', subject: 'Local proof', since: '2032-04-01'}, 'invented-device', now);
  await changeWaitingItem(db, 'live', manual, 'done', 'invented-device', now);
  const later = new Date(+now + HQ_HOURLY_MS);
  await saveHQWaiting(db, parseWaiting('Invented wrong format'), '"invented-unreadable"', later);
  const failed = await readWaitingView(db, 'live', later);
  assert.equal(failed.status, 'unavailable'); assert.equal(failed.done.length, 2);
  assert.equal(failed.readAt, now.toISOString()); assert.equal((await metadata(db)).readable, false);
  await assert.rejects(touchHQRead(db, {kind: 'waiting'}, null, later), (error: unknown) => error instanceof HQReadError && error.code === 'unreadable');
  await saveHQWaitingMissing(db, later);
  const missing = await readWaitingView(db, 'live', later), sync = await metadata(db);
  assert.equal(missing.status, 'missing'); assert.equal(missing.rows.length, 0);
  assert.deepEqual(missing.done.map(row => row.id), [manual]);
  assert.equal(sync.etag, null); assert.equal(sync.errorCode, 'not_found');
  assert.equal(sync.lastSuccessAt, now.toISOString(), 'A 404 does not claim a newly parsed body');
  await assert.rejects(touchHQRead(db, {kind: 'waiting'}, null, later), (error: unknown) => error instanceof HQReadError && error.code === 'invalid');
  await failHQRead(db, {kind: 'waiting'}, new HQReadError('invalid', 304), later);
  await assert.rejects(touchHQRead(db, {kind: 'waiting'}, null, later), (error: unknown) => error instanceof HQReadError && error.code === 'invalid',
    'Repeated unexpected 304s cannot make a missing file count as a parsed body');
});

test('waiting uses hourly main-only ETags, shares in-flight work, and notifies only after writes', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const keys = env(); await syncSourceHealth(db, keys);
  let clock = now, calls = 0, writes = 0;
  const seen: (string | null)[] = [];
  const worker = new HQWorker(db, keys, {...quiet, clock: () => clock, onWrite: () => {writes++;}, fetch: async (input, init) => {
    calls++; const url = new URL(String(input));
    if (!url.pathname.endsWith('/waiting-on/latest.md')) return otherFile(url);
    assert.equal(url.searchParams.get('ref'), 'main'); assert.equal(init?.method, 'GET');
    const etag = new Headers(init?.headers).get('if-none-match'); seen.push(etag);
    return etag ? new Response(null, {status: 304}) : new Response(waiting(), {headers: {etag: '"invented-waiting"'}});
  }}); t.after(() => worker.stop());
  const first = worker.tick(); assert.equal(worker.tick(), first); await first;
  assert.equal(calls, 3); assert.equal(writes, 1); assert.equal((await source(db)).status, 'healthy');
  clock = new Date(+now + HQ_HOURLY_MS - 1); await worker.tick(); assert.equal(calls, 3); assert.equal(writes, 1);
  clock = new Date(+now + HQ_HOURLY_MS); await worker.tick();
  assert.deepEqual(seen, [null, '"invented-waiting"']); assert.equal(writes, 2);
  assert.equal((await readWaitingView(db, 'live', clock)).readAt, clock.toISOString());
  assert.equal((await metadata(db)).parserVersion, HQ_WAITING_PARSER_VERSION);
  await db.query("UPDATE pulse.github_hq_reads SET parser_version=0 WHERE target_key='waiting-on'");
  clock = new Date(+clock + 1000); await worker.tick();
  assert.deepEqual(seen, [null, '"invented-waiting"', null], 'Obsolete waiting parses bypass their old ETag immediately');
});

test('missing waiting is healthy, malformed rows are counted, and a failed read keeps last good rows visible', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const keys = env(); await syncSourceHealth(db, keys);
  let clock = now, phase = 0, writes = 0;
  const worker = new HQWorker(db, keys, {...quiet, clock: () => clock, onWrite: () => {writes++;}, fetch: async input => {
    const url = new URL(String(input)); if (!url.pathname.endsWith('/waiting-on/latest.md')) return otherFile(url);
    return phase === 0 ? new Response(null, {status: 404}) : phase === 1
      ? new Response(waiting('| A supplier | Invented carton proof | 2032-03-30 |\n| Invented malformed |'))
      : new Response('Invented unreadable file');
  }}); t.after(() => worker.stop());
  await worker.tick(); assert.equal((await source(db)).status, 'healthy');
  assert.equal((await metadata(db)).lastSuccessAt, null); assert.equal((await readWaitingView(db, 'live', clock)).status, 'missing');
  phase = 1; clock = new Date(+clock + HQ_HOURLY_MS); await worker.tick();
  const good = await readWaitingView(db, 'live', clock);
  assert.equal(good.rows.length, 1); assert.equal(good.malformedRows, 1); assert.equal((await source(db)).status, 'healthy');
  phase = 2; clock = new Date(+clock + HQ_HOURLY_MS); await worker.tick();
  const failed = await readWaitingView(db, 'live', clock);
  assert.equal(failed.status, 'unavailable'); assert.equal(failed.readAt, good.readAt);
  assert.deepEqual(failed.rows, good.rows); assert.equal((await source(db)).status, 'error'); assert.equal(writes, 3);
});

test('a register rate limit stops the later waiting request and persists across worker restarts', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const keys = env(); await syncSourceHealth(db, keys);
  let calls = 0;
  const options = {...quiet, clock: () => now, fetch: (async input => {
    calls++; const url = new URL(String(input));
    assert.ok(!url.pathname.endsWith('/waiting-on/latest.md'), 'No subsequent file may bypass this token pause');
    return url.pathname.endsWith('/register.md') ? new Response(null, {status: 429, headers: {'retry-after': '172800'}}) : otherFile(url);
  }) as typeof fetch};
  const worker = new HQWorker(db, keys, options); t.after(() => worker.stop());
  await worker.tick(); assert.equal(calls, 2); assert.equal((await source(db)).status, 'error');
  const restarted = new HQWorker(db, keys, options); t.after(() => restarted.stop());
  await restarted.tick(); assert.equal(calls, 2); assert.equal(await metadata(db), undefined);
});

test('a failed missing-file transaction retains rows and records the Waiting read as unavailable', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const keys = env(); await syncSourceHealth(db, keys);
  await saveHQWaiting(db, parseWaiting(waiting()), '"invented-first"', now);
  const later = new Date(+now + HQ_HOURLY_MS);
  const failing = (connection: Database): Database => ({...connection,
    query: async (sql, values) => {
      if (sql.startsWith('DELETE FROM pulse.waiting_on_items')) throw new Error('Invented missing-file storage failure');
      return connection.query(sql, values);
    },
    transaction: callback => connection.transaction(tx => callback(failing(tx))),
  });
  const worker = new HQWorker(failing(db), keys, {...quiet, clock: () => later, fetch: async input => {
    const url = new URL(String(input)); return url.pathname.endsWith('/waiting-on/latest.md') ? new Response(null, {status: 404}) : otherFile(url);
  }}); t.after(() => worker.stop());
  await worker.tick();
  const retained = await readWaitingView(db, 'live', later);
  assert.equal(retained.status, 'unavailable'); assert.equal(retained.rows.length, 1);
  assert.equal(retained.readAt, now.toISOString()); assert.equal((await metadata(db)).errorCode, 'storage');
  assert.equal((await source(db)).status, 'error');
});

test('HQ background clock, storage, logger and notification failures never reject a run', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const keys = env(); await syncSourceHealth(db, keys);
  t.mock.method(console, 'error', () => {throw new Error('Invented logger failure');});
  let notifications = 0;
  const broken = new HQWorker({...db, query: async () => {throw new Error('Invented storage failure');}}, keys,
    {...quiet, clock: () => {throw new Error('Invented clock failure');}, onWrite: async () => {notifications++; throw new Error('Invented callback failure');}});
  await assert.doesNotReject(broken.tick()); await assert.doesNotReject(broken.tick()); await broken.stop();
  assert.equal(notifications, 2, 'A failed run releases its single-flight guard');
  const healthy = new HQWorker(db, keys, {...quiet, clock: () => now, onWrite: () => {throw new Error('Invented callback failure');}, fetch: async input => {
    const url = new URL(String(input)); return url.pathname.endsWith('/waiting-on/latest.md') ? new Response(null, {status: 404}) : otherFile(url);
  }}); t.after(() => healthy.stop());
  await assert.doesNotReject(healthy.tick()); assert.equal((await source(db)).status, 'healthy', 'Notification errors do not rewrite a successful source read');
});
