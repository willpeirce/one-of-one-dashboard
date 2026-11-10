import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings } from '../src/settings.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { dashboardPage } from '../src/dashboard-view.js';
import { tickerState } from '../src/ticker/model.js';
import { morningDeck, type MorningInput, type MorningState } from '../src/morning/model.js';
import { morningBriefHtml, morningLinesHtml } from '../src/morning/view.js';
import { curateMorningSample } from '../src/morning/sample.js';
import type { HQFacts, HQStoredTestRow } from '../src/github-hq/model.js';
import { addMorningHq, homeTestsFromHq, morningBrief } from '../src/github-hq/presentation.js';
import { homeTestReadingHtml, homeTestSheetHtml, homeTestsHtml } from '../src/github-hq/view.js';

const now = new Date('2032-04-20T12:00:00Z');
function input(mode: 'sample' | 'live' = 'live'): MorningInput {
  return { mode, needs: [], checks: [], creativeCards: [], settings: defaultSettings(), ticker: tickerState([], [], now, mode),
    activity: [], metaActions: [], sourceReadOk: {} };
}
function facts(): HQFacts {
  return { sourceMode: 'live', report: null, tests: [], registerReadAt: now.toISOString(), registerReadOk: true, registerSkippedRows: 0, monthReadAt: now.toISOString() };
}
function live(id = 'T1'): HQStoredTestRow {
  return { id, section: 'live', firstSeenAt: '2032-04-10T08:00:00Z', sectionFirstSeenAt: '2032-04-10T08:00:00Z', initiallySeen: true,
    cells: [`${id} Invented button`, 'Site', 'Does the invented button help?', 'A: plain; B: bright', 'Orders per visit, 95% on two mornings',
      '2032-04-10', 'After the stopping rule', 'Invented report', 'Reading 2032-04-20: A 12% n=40; B 17% n=43; ahead B; sure 96%; mornings 2'] };
}
function state(data: MorningInput, changes: Partial<MorningState> = {}): MorningState {
  const card = morningDeck(data, [], now).candidates.find(card => card.kind === 'test-call')!;
  return { mode: 'live', cardKey: card.key, state: 'answered', untilDay: null, factsHash: card.factsHash, answer: 'b',
    credentialId: 'invented-device', pressedAt: now.toISOString(), clearedAt: null,
    title: card.title, kind: card.kind, subjectId: card.subjectId, sourceScope: card.sourceScope, ...changes };
}

test('Morning brief represents all report states as a slim line and escapes its bounded sheet data', () => {
  const source = facts(), report = { day: '2032-04-19', runLabel: 're-run 20 Apr 07:41', status: 'needs' as const, count: 2,
    items: [{ text: 'Review: <invented item>', label: 'Review' }], firstLines: [], ref: 'claude/ads-daily' as const,
    path: 'ops/ads-daily/2032-04.md', readAt: now.toISOString() };
  source.report = report;
  let brief = morningBrief('live', source, now);
  assert.equal(brief.text, 'Morning check · 07:41 · 2 items');
  assert.match(brief.href!, /blob\/claude%2Fads-daily\/ops\/ads-daily\/2032-04\.md$/);
  assert.match(morningBriefHtml(brief), /&lt;invented item&gt;/); assert.doesNotMatch(morningBriefHtml(brief), /<invented item>/);
  const result = morningDeck(addMorningHq(input(), source, now), [], now);
  assert.equal(result.candidates.length, 0, 'The brief never becomes a deck card');
  assert.match(morningLinesHtml(result.snapshot), /id="mn-brief"/);
  source.report = { ...report, status: 'ok', count: 0, items: [] };
  brief = morningBrief('live', source, now);
  assert.equal(brief.text, 'Morning check · 07:41 · nothing needs you');
  assert.match(morningLinesHtml({ ...result.snapshot, brief }), /✓ Good/);
  source.report = { ...report, status: 'unreadable', firstLines: ['<invented heading>', 'Unrecognized status', 'Third bounded line'] };
  brief = morningBrief('live', source, now);
  assert.equal(brief.text, "Morning check: couldn't read"); assert.match(morningBriefHtml(brief), /&lt;invented heading&gt;/);
  assert.match(morningLinesHtml({ ...result.snapshot, brief }), /△ Watch/);
  const key = morningBrief('live', { ...source, sourceMode: 'sample' }, now);
  assert.equal(key.status, 'key'); assert.equal(key.href, '/sources');
});

test('missing brief switches at 09:00 UK in summer and winter, and sample remains explicitly invented', () => {
  for (const [before, after] of [['2032-07-07T07:59:00Z', '2032-07-07T08:00:00Z'], ['2032-12-07T08:59:00Z', '2032-12-07T09:00:00Z']]) {
    assert.equal(morningBrief('live', facts(), new Date(before!)).tone, 'info');
    assert.equal(morningBrief('live', facts(), new Date(after!)).tone, 'warn');
  }
  const source = facts(); source.tests = [live()];
  const sample = addMorningHq(input('sample'), source, now);
  assert.equal(sample.brief?.mode, 'sample'); assert.match(sample.brief!.runLabel!, /invented/);
  assert.match(sample.brief!.href!, /ops\/ads-daily\/2032-04\.md$/);
  assert.equal(sample.extensions, undefined, 'Live register rows never enter the sample demonstration');
  const curated = curateMorningSample(sample, now);
  assert.equal(morningDeck(curated, [], now).candidates.filter(card => card.kind === 'test-call').length, 1);
  assert.equal(morningDeck(curated, [], now).candidates.find(card => card.kind === 'test-call')?.subjectId, 'sample-test-arms');
  const emptyLive = addMorningHq(input(), { ...facts(), sourceMode: 'sample', registerReadAt: null, registerReadOk: false }, now);
  assert.equal(morningDeck(emptyLive, [], now).candidates.length, 0);
  assert.equal(emptyLive.brief?.status, 'key');
});

test('Morning and Home share the exact supplied test call and effective saved-state lifecycle', () => {
  const source = facts(); source.tests = [live()];
  const data = addMorningHq(input(), source, now), card = morningDeck(data, [], now).candidates[0]!;
  assert.equal(card.kind, 'test-call'); assert.equal(card.callAnswer, 'b'); assert.equal(card.figure.kind, 'arms');
  if (card.figure.kind === 'arms') assert.deepEqual(card.figure.arms, [{ label: 'A', value: 12, formatted: '12%', count: 40 }, { label: 'B', value: 17, formatted: '17%', count: 43 }]);
  assert.equal(card.primary.kind, 'save'); assert.deepEqual(card.allowedPresses, ['call', 'park']);
  const call = homeTestsFromHq(source, [], now).rows[0]!.call!;
  assert.equal(call.cardKey, card.key); assert.equal(call.answer, card.callAnswer); assert.match(call.confirm, /register.*write-up/);
  const called = state(data);
  let home = homeTestsFromHq(source, [called], now);
  assert.equal(home.rows[0]!.call, null); assert.equal(home.rows[0]!.status, 'Called B · waiting for the write-up');
  assert.match(homeTestsHtml(home), /data-hq-test-undo="T1"/);
  source.tests[0]!.cells[8] = 'No reading now';
  assert.equal(homeTestsFromHq(source, [called], now).rows[0]!.called?.answer, 'b', 'A Live call survives when the eligible reading disappears');
  source.tests = []; source.registerReadOk = false;
  assert.equal(morningDeck(addMorningHq(input(), source, now), [called], now).snapshot.answers.length, 1);
  source.registerReadOk = true;
  assert.equal(morningDeck(addMorningHq(input(), source, now), [called], now).snapshot.answers.length, 0);
  source.tests = [live()];
  const parked = state(data, { state: 'parked', answer: null, untilDay: '2032-04-21' });
  home = homeTestsFromHq(source, [parked], now);
  assert.equal(home.rows[0]!.call, null); assert.equal(home.rows[0]!.parkedUntil, '2032-04-21');
  source.tests[0]!.cells[8] = source.tests[0]!.cells[8]!.replace('ahead B', 'ahead A');
  assert.equal(homeTestsFromHq(source, [parked], now).rows[0]!.call?.answer, 'a', 'A changed call rule returns a parked test');
});

test('Home offers eligible calls outside the seven-card cap and renders unmeasured status without invented bars', () => {
  const source = facts(); source.tests = Array.from({ length: 8 }, (_, index) => live(`T${index + 1}`));
  const data = addMorningHq(input(), source, now);
  assert.equal(morningDeck(data, [], now).snapshot.cards.length, 7);
  assert.ok(homeTestsFromHq(source, [], now).rows[7]!.call);
  source.tests[0]!.cells[8] = '<invented status> without a reading';
  const row = homeTestsFromHq(source, [], now).rows[0]!, html = homeTestReadingHtml(row);
  assert.equal(row.reading, null); assert.equal(row.model!.arms.length, 0); assert.equal(row.call, null);
  assert.match(html, /&lt;invented status&gt;/); assert.match(html, /How sure: no reading/); assert.doesNotMatch(html, /class="fill"/);
  source.tests[0]!.cells[5] = '2032-03-01';
  const draw = homeTestsFromHq(source, [], now).rows[0]!;
  assert.equal(draw.call?.answer, 'draw'); assert.equal(draw.call?.label, 'Call a draw');
});

test('new verdicts use first observation in History, ignore seeded history and expire after three UK days', () => {
  const source = facts(), history: HQStoredTestRow = { id: 'T1', section: 'history', firstSeenAt: '2032-03-01T08:00:00Z', sectionFirstSeenAt: now.toISOString(), initiallySeen: false,
    cells: ['T1 Invented button', 'Invented question', 'B wins', 'Keep the invented brighter button', 'Invented register evidence'] };
  source.tests = [history];
  const card = morningDeck(addMorningHq(input(), source, now), [], now).candidates[0]!;
  assert.equal(card.kind, 'new-verdict'); assert.equal(card.seenUntilDay, '2032-04-23');
  assert.deepEqual(card.figure, { kind: 'plain', value: 'B wins', label: 'Register verdict' });
  history.cells[2] = `B wins: ${'invented evidence '.repeat(30)}`;
  const long = morningDeck(addMorningHq(input(), source, now), [], now).candidates[0]!;
  assert.deepEqual(long.figure, { kind: 'plain', value: 'B wins', label: 'Register verdict' });
  assert.ok(long.why.includes(history.cells[2]), 'The sheet retains the full verdict behind its short figure');
  assert.equal(morningDeck(addMorningHq(input(), source, new Date('2032-04-23T08:00:00Z')), [], now).candidates.length, 0);
  history.initiallySeen = true;
  assert.equal(morningDeck(addMorningHq(input(), source, now), [], now).candidates.length, 0);
});

test('live Home features the first Live row then folds other Live, Queue and History; sample chapter stays unchanged', () => {
  const source = facts(); source.tests = [live(), live('T2'),
    { ...live('Q1'), section: 'queue', cells: ['Q1 Invented next', 'Site', 'Question', 'Arms', 'Metric', 'How', 'Needs'] },
    { ...live('H1'), section: 'history', cells: ['H1 Invented past', 'Question', 'Draw', 'Rule', 'Evidence'] },
    { ...live('H2'), section: 'history', cells: ['H2 Invented past', 'Question', 'Stopped', 'Rule', 'Evidence'] }];
  const home = homeTestsFromHq(source, [], now), html = homeTestsHtml(home);
  assert.deepEqual([...html.matchAll(/data-hq-test-id="([^"]+)"/g)].map(row => row[1]), ['T1', 'T2', 'Q1', 'H1', 'H2']);
  assert.match(html, /\+1 more/); assert.match(html, /Featured · Site/); assert.match(html, /test-stage">Next/); assert.match(html, /test-stage">Draw/);
  assert.match(homeTestSheetHtml(home.rows[0]!, home.href), /Metric and bar/);
  assert.match(homeTestsHtml(homeTestsFromHq({ ...facts(), registerReadAt: null }, [], now)), /Tests: waiting for the register/);
  const sample = getSampleDashboard(), before = structuredClone(sample), original = dashboardPage(sample);
  assert.equal(dashboardPage({ ...sample, tests: undefined }), original);
  const liveHtml = dashboardPage({ ...sample, tests: home });
  assert.match(liveHtml, /data-hq-tests="live"/); assert.doesNotMatch(liveHtml.match(/<section class="chapter tests"[\s\S]*?<\/section>/)![0], /data-mode="sample"/);
  assert.deepEqual(sample, before, 'Adding a live chapter does not mutate the fixture');
});
