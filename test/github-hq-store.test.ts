import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { HQReadError, type HQTarget } from '../src/github-hq/client.js';
import type { HQBriefEntry, HQTestRow } from '../src/github-hq/model.js';
import { beginHQRead, failHQRead, readHQFacts, readHQReports, readHQSync, saveHQMonth, saveHQRegister, touchHQRead } from '../src/github-hq/store.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2032-04-06T07:00:00Z');
const target = {kind: 'month', month: '2032-04', ref: 'main'} as const;
const register: HQTarget = {kind: 'register'};
const entry = (day = '2032-04-05', runLabel = 'run 6 Apr 07:41'): HQBriefEntry =>
  ({day, runLabel, status: 'needs', count: 2, items: [{text: 'Invented item', label: 'Invented'}], firstLines: []});
const row = (id: string, section: HQTestRow['section']): HQTestRow => ({id, section,
  cells: [id, ...Array.from({length: section === 'live' ? 8 : section === 'queue' ? 6 : 4}, (_, i) => `Invented cell ${i}`)]});

test('HQ stores capped report summaries per day/ref, prefers main, and refreshes cached data on 304', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const large = entry(); large.items = Array.from({length: 15}, () => ({text: '界'.repeat(700), label: 'Invented'}));
  large.firstLines = ['must not be stored below a readable entry'];
  await saveHQMonth(db, target, [large, entry('2032-03-31')], '"main-one"', now);
  const branch = {...target, ref: 'claude/ads-daily' as const};
  await saveHQMonth(db, branch, [entry('2032-04-05', 're-run 6 Apr 08:10')], '"branch-one"', now);
  const facts = await readHQFacts(db, now, 'live');
  assert.equal(facts.report?.ref, 'main'); assert.equal(facts.report?.items.length, 12);
  assert.equal(Array.from(facts.report!.items[0]!.text).length, 300); assert.deepEqual(facts.report!.firstLines, []);
  assert.equal((await readHQReports(db, '2032-03-31')).length, 0, 'Wrong-month headings never spill into another report file');
  const later = new Date('2032-04-06T08:00:00Z');
  await touchHQRead(db, target, '"main-two"', later);
  assert.equal((await readHQFacts(db, later, 'live')).report!.readAt, later.toISOString());
  assert.equal((await readHQSync(db, [target])).get('month:2032-04:main')!.etag, '"main-two"');
  await beginHQRead(db, target, later); await failHQRead(db, target, new HQReadError('not_found', 404), later);
  assert.equal((await readHQFacts(db, later, 'live')).report!.ref, 'claude/ads-daily', 'Confirmed missing main uses branch instead of a stale main summary');
  await failHQRead(db, target, new HQReadError('network'), later);
  assert.equal((await readHQFacts(db, later, 'live')).report!.ref, 'main', 'A transport failure can retain the last main report');
  await saveHQMonth(db, target, [], '"main-empty"', later);
  assert.equal((await readHQFacts(db, later, 'live')).report!.ref, 'claude/ads-daily');
  const unreadable = {...entry(), status: 'unreadable' as const, firstLines: Array.from({length: 5}, () => '界'.repeat(700))};
  await saveHQMonth(db, target, [unreadable], null, later);
  const bad = (await readHQFacts(db, later, 'live')).report!;
  assert.equal(bad.firstLines.length, 3); assert.equal(Array.from(bad.firstLines[0]!).length, 300);
  const definitions = await db.query<{column_name: string}>("SELECT column_name FROM information_schema.columns WHERE table_schema='pulse' AND table_name LIKE 'github_hq_%'");
  assert.ok(!definitions.rows.some(row => /^(raw|body|file|token|content)$/.test(row.column_name)));
  const migration = await readFile(new URL('../migrations/065_github_hq.sql', import.meta.url), 'utf8');
  await db.query(migration); await db.query(migration);
  const permissions = await db.query(`SELECT 1 FROM pg_class c, LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl
    WHERE c.oid IN ('pulse.github_hq_reports'::regclass,'pulse.github_hq_reads'::regclass,'pulse.github_hq_tests'::regclass) AND acl.grantee=0`);
  assert.equal(permissions.rows.length, 0); assert.equal((await db.query('SELECT 1 FROM pulse.audit_log')).rowCount, 0);
});

test('HQ first register read marks existing rows seen; new rows and Live-to-History transitions get a new section time', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await saveHQRegister(db, {readable: true, rows: [row('T1', 'live'), row('T2', 'history'), row('T3', 'queue')], skippedRows: 0}, '"first"', now);
  let facts = await readHQFacts(db, now, 'live');
  assert.equal(facts.registerReadOk, true); assert.equal(facts.tests.length, 3);
  assert.ok(facts.tests.every(row => row.initiallySeen && row.firstSeenAt === now.toISOString()));
  const later = new Date('2032-04-10T08:00:00Z');
  await saveHQRegister(db, {readable: true, rows: [row('T1', 'history'), row('T2', 'history'), row('T4', 'history')], skippedRows: 0}, '"second"', later);
  facts = await readHQFacts(db, later, 'live');
  assert.equal(facts.tests.find(row => row.id === 'T3'), undefined);
  const moved = facts.tests.find(row => row.id === 'T1')!, retained = facts.tests.find(row => row.id === 'T2')!, fresh = facts.tests.find(row => row.id === 'T4')!;
  assert.equal(moved.firstSeenAt, now.toISOString()); assert.equal(moved.sectionFirstSeenAt, later.toISOString()); assert.equal(moved.initiallySeen, false);
  assert.equal(retained.sectionFirstSeenAt, now.toISOString()); assert.equal(retained.initiallySeen, true);
  assert.equal(fresh.firstSeenAt, later.toISOString()); assert.equal(fresh.initiallySeen, false);
  await touchHQRead(db, register, null, new Date('2032-04-10T09:00:00Z'));
  assert.deepEqual((await readHQFacts(db, later, 'live')).tests, facts.tests, '304 preserves first-seen and section metadata');
});

test('HQ failed, incomplete and unreadable register reads cannot certify call cleanup or erase the last good register', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await saveHQRegister(db, {readable: true, rows: [row('T1', 'live')], skippedRows: 0}, '"first"', now);
  const original = (await readHQFacts(db, now, 'live')).tests;
  const later = new Date('2032-04-06T08:00:00Z');
  await beginHQRead(db, register, later);
  assert.equal((await readHQFacts(db, later, 'live')).registerReadOk, false, 'An in-flight read cannot clear state');
  await failHQRead(db, register, new HQReadError('timeout'), later);
  assert.deepEqual((await readHQFacts(db, later, 'live')).tests, original);
  await saveHQRegister(db, {readable: false, rows: [], skippedRows: 0}, '"unreadable"', later);
  let facts = await readHQFacts(db, later, 'live'); assert.deepEqual(facts.tests, original); assert.equal(facts.registerReadOk, false);
  await assert.rejects(touchHQRead(db, register, null, later), (error: unknown) => error instanceof HQReadError && error.code === 'unreadable');
  await saveHQRegister(db, {readable: true, rows: [row('T2', 'queue')], skippedRows: 1}, '"partial"', later);
  facts = await readHQFacts(db, later, 'live'); assert.ok(facts.tests.some(row => row.id === 'T2')); assert.equal(facts.registerSkippedRows, 1); assert.equal(facts.registerReadOk, false);
  assert.equal((await readHQSync(db, [register])).get('register')!.errorCode, null, 'A skipped row does not fail a readable file');
  await touchHQRead(db, register, null, new Date('2032-04-06T09:00:00Z'));
  assert.equal((await readHQFacts(db, later, 'live')).registerReadOk, false, '304 does not turn a partial parse into a clean read');
  await saveHQRegister(db, {readable: true, rows: [], skippedRows: 0}, '"clear"', later);
  facts = await readHQFacts(db, later, 'live'); assert.equal(facts.registerReadOk, true); assert.deepEqual(facts.tests, []);
  assert.equal((await readHQFacts(db, later, 'sample')).registerReadOk, false, 'Missing key never confirms test lifecycle');
});

test('HQ partial register reads preserve old History identity, while removing the key hides every cached row without a query', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await saveHQRegister(db, {readable: true, rows: [row('T1', 'history')], skippedRows: 0}, '"first"', now);
  const original = (await readHQFacts(db, now, 'live')).tests[0]!;
  const later = new Date('2032-04-07T08:00:00Z');
  await saveHQRegister(db, {readable: true, rows: [], skippedRows: 1}, '"partial"', later);
  assert.deepEqual((await readHQFacts(db, later, 'live')).tests, [original]);
  await saveHQRegister(db, {readable: true, rows: [row('T1', 'history')], skippedRows: 0}, '"repaired"', later);
  assert.deepEqual((await readHQFacts(db, later, 'live')).tests, [original], 'Fixing one malformed row cannot invent a new verdict');
  await saveHQMonth(db, target, [entry()], null, now);
  const noReads = {...db, query: async () => {throw new Error('No reads with a missing key');}};
  assert.deepEqual(await readHQFacts(noReads, now, 'sample'), {sourceMode: 'sample', report: null, tests: [],
    registerReadAt: null, registerReadOk: false, registerSkippedRows: 0, monthReadAt: null});
});

test('HQ first partial register waits for a complete baseline before treating later rows as new verdicts', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await saveHQRegister(db, {readable: true, rows: [row('T1', 'history')], skippedRows: 1}, '"partial-first"', now);
  assert.equal((await readHQSync(db, [register])).get('register')!.initialized, false);
  await touchHQRead(db, register, null, new Date('2032-04-06T08:00:00Z'));
  assert.equal((await readHQSync(db, [register])).get('register')!.initialized, false);
  await saveHQRegister(db, {readable: true, rows: [row('T1', 'history'), row('T2', 'history')], skippedRows: 0}, '"complete-first"', new Date('2032-04-07T08:00:00Z'));
  const facts = await readHQFacts(db, now, 'live');
  assert.equal(facts.registerReadOk, true); assert.ok(facts.tests.every(row => row.initiallySeen));
  await saveHQRegister(db, {readable: true, rows: [row('T1', 'history'), row('T2', 'history'), row('T3', 'history')], skippedRows: 0}, '"later"', new Date('2032-04-08T08:00:00Z'));
  assert.equal((await readHQFacts(db, now, 'live')).tests.find(row => row.id === 'T3')!.initiallySeen, false);
});

test('HQ partial-cache retention stays at forty rows per section and prioritizes the current valid rows', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const sections = ['live', 'queue', 'history'] as const;
  await saveHQRegister(db, {readable: true, rows: sections.flatMap(section => Array.from({length: 40}, (_, i) => row(`${section}-old-${i}`, section))), skippedRows: 0}, null, now);
  for (let iteration = 0; iteration < 3; iteration++) {
    const fresh = sections.flatMap(section => Array.from({length: 25}, (_, i) => row(`${section}-new-${iteration}-${i}`, section)));
    await saveHQRegister(db, {readable: true, rows: fresh, skippedRows: 1}, null, new Date(now.getTime() + (iteration + 1) * 3_600_000));
    const counts = await db.query<{section: string; count: string}>('SELECT section,count(*)::text FROM pulse.github_hq_tests GROUP BY section ORDER BY section');
    assert.deepEqual(counts.rows.map(row => Number(row.count)), [40, 40, 40]);
    const current = await readHQFacts(db, now, 'live'); assert.equal(current.tests.length, 120);
    for (const candidate of fresh) assert.ok(current.tests.some(row => row.id === candidate.id));
  }
});

test('HQ register updates and metadata roll back together, and an unreadable first file does not initialize seen state', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await saveHQRegister(db, {readable: false, rows: [], skippedRows: 0}, null, now);
  assert.equal((await readHQSync(db, [register])).get('register')!.initialized, false);
  await saveHQRegister(db, {readable: true, rows: [row('T1', 'history')], skippedRows: 0}, '"good"', now);
  const original = await readHQFacts(db, now, 'live'); assert.equal(original.tests[0]!.initiallySeen, true);
  await assert.rejects(saveHQRegister(db, {readable: true, rows: [row('T1', 'live'), {...row('T2', 'live'), cells: ['wrong cell count']}], skippedRows: 0}, '"bad"', new Date('2032-04-06T08:00:00Z')));
  assert.deepEqual(await readHQFacts(db, now, 'live'), original);
  assert.equal((await readHQSync(db, [register])).get('register')!.etag, '"good"');
  const empty = await createTestDatabase(); t.after(() => empty.close());
  await beginHQRead(empty, target, now);
  await assert.rejects(touchHQRead(empty, target, null, now), (error: unknown) => error instanceof HQReadError && error.code === 'invalid');
});
