import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {test} from 'node:test';
import type {Database} from '../src/db.js';
import {HQClient, HQReadError, type HQTarget} from '../src/github-hq/client.js';
import {beginHQRead, failHQRead, readHQSync, saveHQKits, saveHQKitsMissing, touchHQRead} from '../src/github-hq/store.js';
import {HQWorker, HQ_HOURLY_MS} from '../src/github-hq/worker.js';
import {KIT_BODY_LIMIT, KIT_PARSER_VERSION, parseKits, parseKitOrders} from '../src/kits/model.js';
import {readKitFacts} from '../src/kits/store.js';
import {readSourceHealth, syncSourceHealth} from '../src/sources.js';
import {createTestDatabase} from './helpers/database.js';

const now = new Date('2032-04-07T12:00:00Z');
const kits = JSON.stringify({updated: '2032-04-07T09:20:00Z', rows: [{id: 'box-a', name: 'Box A', gate: 2,
  status: 'in flight', owner: 'Will', next_action: 'Check an invented sample', ref: 'Never retain'}]});
const orders = JSON.stringify([{id: 'order-a', kit: 'Box A', supplier: 'a supplier', item: 'Invented cartons', qty: 1200,
  date: '2032-04-02', eta: '2032-05-02', status: 'In production', ref: 'A private price reference'}]);
const env = () => ({GITHUB_HQ_TOKEN: randomBytes(24).toString('hex')});
const quiet = {log: () => {}, sleep: async () => {}};
const source = async (db: Database) => (await readSourceHealth(db)).find(row => row.source === 'github-hq')!;
const other = (url: URL) => url.pathname.endsWith('/waiting-on/latest.md') ? new Response(null, {status: 404}) :
  new Response(url.pathname.endsWith('/register.md') ? '## Watches (kill rules, not tests)\n## Live\n## Queue\n## History'
    : '## 2032-04-06 (Tue), run 7 Apr 07:40\n**Needs Will:** nothing.');
const sync = async (db: Database, kind: 'kits' | 'kit-orders') => (await readHQSync(db, [{kind}])).get(kind)!;

test('kit migration replays and allows only the exact main paths without any reference storage', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await beginHQRead(db, {kind: 'kits'}, now); await beginHQRead(db, {kind: 'kit-orders'}, now);
  await beginHQRead(db, {kind: 'waiting'}, now); await beginHQRead(db, {kind: 'register'}, now);
  await beginHQRead(db, {kind: 'month', month: '2032-04', ref: 'claude/ads-daily'}, now);
  const sql = await readFile(new URL('../migrations/074_kit_board.sql', import.meta.url), 'utf8');
  await db.query(sql); await db.query(sql);
  for (const [path, ref] of [['ops/kit-board/other.json', 'main'], ['ops/kit-board/kits.json', 'claude/ads-daily'],
    ['ops/kit-board/orders.json', 'claude/ads-daily'], ['ops/waiting-on/latest.md', 'claude/ads-daily']])
    await assert.rejects(db.query('INSERT INTO pulse.github_hq_reads(target_key,path,ref) VALUES($1,$2,$3)', ['invalid-path', path, ref]), /check constraint/);
  assert.equal((await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema='pulse' AND table_name IN ('kit_board_kits','kit_board_orders') AND column_name='ref'")).rowCount, 0);
});

test('kit rows and read metadata commit together, 304 preserves file dates and diagnostics, sample never queries storage', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const partial = parseKits(JSON.stringify({updated: '2032-04-07T09:20:00Z', rows: [{id: 'box-a', name: 'Box A', gate: 2}, null]}));
  await saveHQKits(db, 'kits', partial, '"invented-kits"', now);
  await saveHQKits(db, 'kit-orders', parseKitOrders(orders), '"invented-orders"', now);
  const initial = await readKitFacts(db, 'live', now);
  assert.equal(initial.kits.rows.length, 1); assert.equal(initial.kits.skippedRows, 1); assert.equal(initial.orders.rows[0]!.date, '2032-04-02');
  assert.equal(JSON.stringify(initial).includes('private price'), false); assert.equal(JSON.stringify(initial).includes('Never retain'), false);
  const later = new Date(+now + HQ_HOURLY_MS);
  await touchHQRead(db, {kind: 'kits'}, null, later); await touchHQRead(db, {kind: 'kit-orders'}, null, later);
  const touched = await readKitFacts(db, 'live', later);
  assert.equal(touched.kits.readAt, later.toISOString()); assert.equal(touched.kits.updatedAt, initial.kits.updatedAt);
  assert.equal(touched.kits.skippedRows, 1); assert.equal((await sync(db, 'kits')).etag, '"invented-kits"');
  const broken = (connection: Database): Database => ({...connection, query: async (text, values) => {
    if (text.startsWith('INSERT INTO pulse.github_hq_reads')) throw new Error('Invented metadata failure');
    return connection.query(text, values);
  }, transaction: callback => connection.transaction(tx => callback(broken(tx)))});
  await assert.rejects(saveHQKits(broken(db), 'kits', parseKits(JSON.stringify([{id: 'box-b', name: 'Box B', gate: 1}])), null, later));
  assert.deepEqual(await readKitFacts(db, 'live', later), touched);
  const noReads: Database = {...db, query: async () => {throw new Error('Sample facts must not read stored live data');}};
  assert.equal((await readKitFacts(noReads, 'sample', later)).kits.rows.length, 6);
});

test('bad kit JSON retains good rows, missing clears only that file and never claims a parsed success', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  assert.equal((await readKitFacts(db, 'live', now)).kits.status, 'pending');
  await saveHQKits(db, 'kits', parseKits(kits), '"invented-kits"', now);
  await saveHQKits(db, 'kit-orders', parseKitOrders(orders), '"invented-orders"', now);
  const good = await readKitFacts(db, 'live', now), later = new Date(+now + HQ_HOURLY_MS);
  await saveHQKits(db, 'kits', parseKits('{'), '"invented-bad"', later);
  const failed = await readKitFacts(db, 'live', later);
  assert.equal(failed.kits.status, 'unavailable'); assert.deepEqual(failed.kits.rows, good.kits.rows);
  assert.equal(failed.kits.readAt, good.kits.readAt);
  await assert.rejects(touchHQRead(db, {kind: 'kits'}, null, later), (e: unknown) => e instanceof HQReadError && e.code === 'unreadable');
  await saveHQKitsMissing(db, 'kits', later);
  const missing = await readKitFacts(db, 'live', later), metadata = await sync(db, 'kits');
  assert.equal(missing.kits.status, 'missing'); assert.equal(missing.kits.rows.length, 0); assert.equal(missing.kits.readAt, later.toISOString());
  assert.deepEqual(missing.orders, good.orders); assert.equal(metadata.lastSuccessAt, now.toISOString());
  assert.equal(metadata.errorCode, 'not_found'); assert.equal(metadata.etag, null);
  await assert.rejects(touchHQRead(db, {kind: 'kits'}, null, later), (e: unknown) => e instanceof HQReadError && e.code === 'invalid');
  await failHQRead(db, {kind: 'kits'}, new HQReadError('invalid', 304), later);
  await assert.rejects(touchHQRead(db, {kind: 'kits'}, null, later), (e: unknown) => e instanceof HQReadError && e.code === 'invalid');
});

test('the existing kit table retains legacy fields without repurposing them for optional presentation fields', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const parsed = parseKits(JSON.stringify([{id: 'box-a', name: 'Box A', gate: 2, launch_target: '2032-06-12',
    next_action: 'Check the invented proof', note: 'Keep this original note', milestone: 'Review the proof',
    sellout_target: '2032-09-14', next_date: 'Order due 3 Mar', move_note: 'Next check Tue 9 Mar'}]));
  await saveHQKits(db, 'kits', parsed, '"invented-kits"', now);
  const row = (await readKitFacts(db, 'live', now)).kits.rows[0]!;
  assert.equal(row.launchTarget, '2032-06-12'); assert.equal(row.nextAction, 'Check the invented proof');
  assert.equal(row.note, 'Keep this original note'); assert.equal(row.milestone, 'Review the proof');
  // The no-migration build can parse these fields, but the existing columns cannot retain them.
  assert.equal(row.selloutTarget ?? null, null); assert.equal(row.nextDate ?? null, null); assert.equal(row.moveNote ?? null, null);
  assert.equal((await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='pulse'
    AND table_name='kit_board_kits' AND column_name IN ('sellout_target','next_date','move_note')`)).rowCount, 0);
});

test('the newer kit parser re-reads a cached earlier version without its old ETag', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await saveHQKits(db, 'kits', parseKits(kits), '"invented-kits"', now);
  await db.query("UPDATE pulse.github_hq_reads SET parser_version=$1 WHERE target_key='kits'", [KIT_PARSER_VERSION - 1]);
  const later = new Date(+now + 60_000), seen: (string | null)[] = [];
  const worker = new HQWorker(db, env(), {...quiet, clock: () => later, fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/kits.json')) {
      seen.push(new Headers(init?.headers).get('if-none-match'));
      return new Response(kits, {headers: {etag: '"invented-kits"'}});
    }
    if (url.pathname.endsWith('/orders.json')) return new Response(orders);
    return other(url);
  }}); t.after(() => worker.stop());
  await worker.tick();
  assert.deepEqual(seen, [null]);
  assert.equal((await sync(db, 'kits')).parserVersion, KIT_PARSER_VERSION);
  assert.equal((await sync(db, 'kits')).lastSuccessAt, later.toISOString());
});

test('two kit files use hourly conditional GETs, share one run and keep healthy missing files', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const keys = env(); await syncSourceHealth(db, keys);
  let clock = now, phase = 0, calls = 0, writes = 0;
  const seen: {path: string; etag: string | null}[] = [];
  const worker = new HQWorker(db, keys, {...quiet, clock: () => clock, onWrite: () => {writes++;}, fetch: async (input, init) => {
    const url = new URL(String(input)); calls++;
    if (!url.pathname.includes('/kit-board/')) return other(url);
    assert.equal(init?.method, 'GET'); assert.equal(url.searchParams.get('ref'), 'main');
    const etag = new Headers(init?.headers).get('if-none-match'); seen.push({path: url.pathname.split('/').at(-1)!, etag});
    if (!phase) return new Response(null, {status: 404});
    if (phase === 3 && url.pathname.endsWith('/kits.json')) return new Response('{');
    return etag ? new Response(null, {status: 304}) : new Response(url.pathname.endsWith('/kits.json') ? kits : orders,
      {headers: {etag: url.pathname.endsWith('/kits.json') ? '"invented-kits"' : '"invented-orders"'}});
  }}); t.after(() => worker.stop());
  const first = worker.tick(); assert.equal(worker.tick(), first); await first;
  assert.equal(calls, 5); assert.equal((await source(db)).status, 'healthy');
  assert.equal((await readKitFacts(db, 'live', clock)).kits.status, 'missing'); assert.equal((await sync(db, 'kits')).lastSuccessAt, null);
  clock = new Date(+clock + HQ_HOURLY_MS - 1); await worker.tick(); assert.equal(calls, 5); assert.equal(writes, 1);
  phase = 1; clock = new Date(+now + HQ_HOURLY_MS); await worker.tick();
  const good = await readKitFacts(db, 'live', clock); assert.equal(good.kits.rows.length, 1); assert.equal(good.orders.rows.length, 1);
  phase = 2; clock = new Date(+clock + HQ_HOURLY_MS); await worker.tick();
  assert.equal((await readKitFacts(db, 'live', clock)).kits.readAt, clock.toISOString());
  assert.deepEqual(seen.map(row => row.etag), [null, null, null, null, '"invented-kits"', '"invented-orders"']);
  phase = 3; clock = new Date(+clock + HQ_HOURLY_MS); await worker.tick();
  const failed = await readKitFacts(db, 'live', clock); assert.equal(failed.kits.status, 'unavailable');
  assert.deepEqual(failed.kits.rows, good.kits.rows); assert.equal(failed.orders.status, 'ready'); assert.equal((await source(db)).status, 'error');
});

test('kit transport enforces 256 KB before and during streaming, leaving existing larger HQ limits unchanged', async () => {
  for (const kind of ['kits', 'kit-orders'] as const) {
    const target: HQTarget = {kind}, token = randomBytes(24).toString('hex');
    for (const declared of [false, true]) {
      let chunks = 0, cancelled = false;
      const client = new HQClient(token, {...quiet, fetch: async () => new Response(new ReadableStream<Uint8Array>({
        pull(controller) {chunks++; controller.enqueue(new Uint8Array(KIT_BODY_LIMIT));}, cancel() {cancelled = true;},
      }, {highWaterMark: 0}), {headers: declared ? {'content-length': String(KIT_BODY_LIMIT + 1)} : {}})});
      await assert.rejects(client.read(target), (e: unknown) => e instanceof HQReadError && e.code === 'too_large');
      assert.equal(chunks, declared ? 0 : 2); assert.equal(cancelled, true);
    }
    const exact = new HQClient(token, {...quiet, fetch: async () => new Response(' '.repeat(KIT_BODY_LIMIT))});
    assert.equal((await exact.read(target)).status, 'modified');
  }
});
