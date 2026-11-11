import { parseRegister } from '../src/github-hq/parse-register.js';
import { addMorningHq } from '../src/github-hq/presentation.js';
import { pressMorning, readMorningResult } from '../src/morning/store.js';
import { defaultSettings } from '../src/settings.js';
import { tickerState } from '../src/ticker/model.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { HQReadError, type HQTarget } from '../src/github-hq/client.js';
import { HQ_MONTH_PARSER_VERSION, type HQBriefEntry, type HQTestRow } from '../src/github-hq/model.js';
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

test('HQ check items keep bounded Unicode lines and tags with diagnostics belonging to their own report', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const current: HQBriefEntry = {...entry(), malformedCardTags: 3, items: [{text: 'Invented Fern review',
    label: 'Review', lines: Array.from({length: 11}, (_, index) => `${index} ${'𐐀'.repeat(400)}`),
    tag: {type: 'pause', adSetId: '120000000000000001'}}]};
  const older: HQBriefEntry = {...entry('2032-04-04'), malformedCardTags: 8, items: [{text: 'Invented earlier note',
    lines: ['An invented earlier line.'], tag: {type: 'info'}}]};
  await saveHQMonth(db, target, [older, current], '"invented-lines"', now);
  const stored = (await readHQReports(db, current.day))[0]!;
  assert.equal(stored.malformedCardTags, 3);
  assert.equal(stored.items[0]!.lines!.length, 8);
  for (const line of stored.items[0]!.lines!) {
    assert.equal(Array.from(line).length, 300);
    assert.ok(!line.endsWith('\uD801'), 'A line bound never splits a Unicode code point');
  }
  assert.deepEqual(stored.items[0]!.tag, {type: 'pause', adSetId: '120000000000000001'});
  assert.equal((await readHQReports(db, older.day))[0]!.malformedCardTags, 8);
  assert.equal((await readHQFacts(db, now, 'live')).report!.malformedCardTags, 3,
    'The selected report does not inherit another day’s malformed tags');
  await touchHQRead(db, target, null, new Date(+now + 3_600_000));
  const touched = (await readHQReports(db, current.day))[0]!;
  assert.deepEqual(touched.items, stored.items); assert.equal(touched.malformedCardTags, 3);
  assert.equal((await readHQSync(db, [target])).get('month:2032-04:main')!.parserVersion, HQ_MONTH_PARSER_VERSION);
});

test('legacy stored check items load empty lines and the additive diagnostics migration preserves existing reports', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await db.query(`INSERT INTO pulse.github_hq_reports(report_day,run_label,status,item_count,items,first_lines,ref,path,read_at)
    VALUES($1,$2,'needs',1,$3::jsonb,'[]'::jsonb,'main','ops/ads-daily/2032-04.md',$4)`,
  ['2032-04-05', 'run 6 Apr 07:41', JSON.stringify([{text: 'Invented legacy item', label: 'Review'}]), now]);
  const stored = (await readHQReports(db, '2032-04-05'))[0]!;
  assert.deepEqual(stored.items, [{text: 'Invented legacy item', label: 'Review', lines: []}]);
  assert.equal(stored.malformedCardTags, 0);
  const migration = await readFile(new URL('../migrations/068_hq_check_items.sql', import.meta.url), 'utf8');
  await db.query(migration); await db.query(migration);
  assert.deepEqual((await readHQReports(db, '2032-04-05'))[0], stored);
  await assert.rejects(db.query('UPDATE pulse.github_hq_reports SET malformed_card_tags=-1'));
  assert.equal((await readHQReports(db, '2032-04-05'))[0]!.malformedCardTags, 0);
});

test('stored check tags discard extra keys without changing valid tags or report diagnostics', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await saveHQMonth(db, target, [entry()], null, now);
  const tags = [
    {type: 'pause', adSetId: '120000000000000001', extra: 'invented'},
    {type: 'freelancer', adSetId: '120000000000000002'},
    {type: 'pause', adSetId: '120000000000000003'},
    {type: 'freelancer'},
  ];
  await db.query('UPDATE pulse.github_hq_reports SET items=$1::jsonb,item_count=$2',
    [JSON.stringify(tags.map((tag, index) => ({text: `Invented stored item ${index + 1}`, tag}))), tags.length]);
  const stored = (await readHQReports(db, '2032-04-05'))[0]!;
  assert.deepEqual(stored.items.map(item => item.tag), [undefined, undefined, tags[2], tags[3]]);
  assert.ok(stored.items.every(item => Array.isArray(item.lines)));
  assert.equal(stored.malformedCardTags, 0, 'Stored JSON validation does not invent source parser diagnostics');
});

test('an obsolete month parse cannot be refreshed by 304 until a full parse stores the current version', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await saveHQMonth(db, target, [entry()], '"invented-old-parse"', now);
  const original = (await readHQReports(db, '2032-04-05'))[0]!;
  await db.query("UPDATE pulse.github_hq_reads SET parser_version=0 WHERE target_key='month:2032-04:main'");
  const later = new Date(+now + 1000);
  await assert.rejects(touchHQRead(db, target, '"invented-304"', later),
    (error: unknown) => error instanceof HQReadError && error.code === 'invalid' && error.status === 304);
  assert.deepEqual((await readHQReports(db, '2032-04-05'))[0], original, 'A refused 304 cannot freshen an obsolete report');
  await saveHQMonth(db, target, [{...entry(), items: [{text: 'Invented parsed item', lines: ['Invented retained detail.']}]}], '"invented-current-parse"', later);
  assert.equal((await readHQSync(db, [target])).get('month:2032-04:main')!.parserVersion, HQ_MONTH_PARSER_VERSION);
  await touchHQRead(db, target, null, new Date(+later + 1000));
  assert.deepEqual((await readHQReports(db, '2032-04-05'))[0]!.items[0]!.lines, ['Invented retained detail.']);
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
  await saveHQRegister(db, {readable: true, rows: [row('T2', 'queue')], skippedRows: 1, complete: false}, '"partial"', later);
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
  await saveHQRegister(db, {readable: true, rows: [], skippedRows: 1, complete: false}, '"partial"', later);
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
  await saveHQRegister(db, {readable: true, rows: [row('T1', 'history')], skippedRows: 1, complete: false}, '"partial-first"', now);
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
    await saveHQRegister(db, {readable: true, rows: fresh, skippedRows: 1, complete: false}, null, new Date(now.getTime() + (iteration + 1) * 3_600_000));
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

test('a complete set of headings establishes the baseline and removes gone rows despite malformed and capped rows', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await saveHQRegister(db, {readable: true, complete: true, rows: [row('T1', 'live'), row('H1', 'history')], skippedRows: 1, cappedRows: 2}, '"baseline"', now);
  let facts = await readHQFacts(db, now, 'live');
  assert.equal(facts.registerReadOk, true); assert.ok(facts.tests.every(test => test.initiallySeen));
  assert.equal(facts.registerSkippedRows, 1); assert.equal(facts.registerCappedRows, 2);
  const later = new Date('2032-04-07T08:00:00Z');
  await saveHQRegister(db, {readable: true, complete: true, rows: [row('H2', 'history')], skippedRows: 1, cappedRows: 3}, '"next"', later);
  facts = await readHQFacts(db, later, 'live');
  assert.deepEqual(facts.tests.map(test => test.id), ['H2']); assert.equal(facts.tests[0]!.initiallySeen, false);
  await touchHQRead(db, register, null, later);
  assert.equal((await readHQFacts(db, later, 'live')).registerCappedRows, 3);
});


test('malformed and capped IDs retain their exact stored rows, first-seen marks and called answers', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const live = row('T1', 'live'); live.cells[5] = '2032-03-01';
  await saveHQRegister(db, {readable: true, complete: true, rows: [live, row('H1', 'history'), row('gone', 'history')], skippedRows: 0}, null, now);
  const original = (await readHQFacts(db, now, 'live')).tests;
  const load = async (at: Date) => addMorningHq({mode: 'live', needs: [], checks: [], creativeCards: [], settings: defaultSettings(),
    ticker: tickerState([], [], at, 'live'), activity: [], metaActions: [], sourceReadOk: {}}, await readHQFacts(db, at, 'live'), at);
  const card = (await readMorningResult(db, load, now)).openCards.find(card => card.subjectId === 'T1')!;
  await pressMorning(db, load, {cardKey: card.key, action: 'call', answer: 'draw'}, 'invented-device', now);
  const source = (liveRows: string, historyRows: string) => `## Live\n${liveRows}\n## Queue\n## History\n${historyRows}\n## Watches`;
  const parsed = parseRegister(source('| T1 Invented broken | too few |', '| H1 Invented broken | too few |\n| H2 | Question | Draw | Rule | Evidence |'));
  assert.deepEqual(parsed.skippedCells, ['T1 Invented broken', 'H1 Invented broken']);
  await saveHQRegister(db, parsed, null, new Date(+now + 1000));
  let facts = await readHQFacts(db, now, 'live');
  for (const id of ['T1', 'H1']) assert.deepEqual(facts.tests.find(row => row.id === id), original.find(row => row.id === id));
  assert.equal(facts.tests.some(row => row.id === 'gone'), false);
  assert.equal((await readMorningResult(db, load, now)).snapshot.answers[0]!.cardKey, card.key);
  const beforeMalformedTable = facts.tests;
  await saveHQRegister(db, parseRegister(source('| T1 | too few |', '| H1 | too few |\n| H2 | too few |')), null, new Date(+now + 2000));
  assert.deepEqual((await readHQFacts(db, now, 'live')).tests, beforeMalformedTable);
  const full = Array.from({length: 40}, (_, index) => `| N${index} | Site | Question | A vs B | Bar | 2032-04-01 | Later | Source | Waiting |`).join('\n');
  await saveHQRegister(db, parseRegister(source(`${full}\n| ${live.cells.join(' | ')} |`, '| H1 | Question | Draw | Rule | Evidence |')), null, new Date(+now + 3000));
  facts = await readHQFacts(db, now, 'live');
  assert.deepEqual(facts.tests.find(row => row.id === 'T1'), original.find(row => row.id === 'T1'));
  assert.equal(facts.tests.filter(row => row.section === 'live').length, 40, 'Protected rows reserve space within the existing cap');
  assert.equal(facts.registerCappedRows, 2);
  assert.equal((await readMorningResult(db, load, now)).snapshot.answers[0]!.cardKey, card.key);
  await saveHQRegister(db, parseRegister(source('', '| H1 | Question | Draw | Rule | Evidence |')), null, new Date(+now + 4000));
  assert.equal((await readMorningResult(db, load, now)).snapshot.answers.length, 0, 'A genuinely absent called test still clears');
});

test('protected rows reserve capped storage without displacing other present stored identities', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const original = Array.from({length: 40}, (_, index) => row(`T${index}`, 'live'));
  await saveHQRegister(db, {readable: true, rows: original, skippedRows: 0}, null, now);
  const before = (await readHQFacts(db, now, 'live')).tests;
  await saveHQRegister(db, {readable: true, complete: true,
    rows: [...Array.from({length: 39}, (_, index) => row(`new${index}`, 'live')), original[39]!],
    skippedRows: 39, skippedCells: original.slice(0, 39).map(row => row.id)}, null, new Date(+now + 1000));
  let facts = await readHQFacts(db, now, 'live');
  assert.deepEqual(facts.tests, before, 'New rows cannot crowd out an existing well-formed row');
  assert.equal(facts.registerCappedRows, 39);
  // A present row also survives a requested move into a section wholly occupied by protected rows.
  await saveHQRegister(db, {readable: true, rows: [...original, row('Q1', 'queue')], skippedRows: 0}, null, now);
  const moving = (await readHQFacts(db, now, 'live')).tests.find(row => row.id === 'Q1');
  await saveHQRegister(db, {readable: true, complete: true, rows: [row('Q1', 'live')],
    skippedRows: 40, skippedCells: original.map(row => row.id)}, null, new Date(+now + 2000));
  facts = await readHQFacts(db, now, 'live');
  assert.deepEqual(facts.tests.find(row => row.id === 'Q1'), moving);
  assert.equal(facts.tests.filter(row => row.section === 'live').length, 40);
  assert.equal(facts.registerCappedRows, 1);
});
