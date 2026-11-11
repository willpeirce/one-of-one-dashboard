import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, ukToday } from '../src/hero-range.js';
import { defaultSettings } from '../src/settings.js';
import type { StoredAdSet } from '../src/meta-adsets/catalogue.js';
import { adSetName } from '../src/meta-adsets/name.js';
import { pauseUncertaintyCode } from '../src/meta-adsets/pause-uncertainty.js';
import { buildAdSetsView } from '../src/meta-adsets/presentation.js';
import { judgeAdSet, type SetDay } from '../src/meta-adsets/rules.js';
import { morningDeck, type MorningCard, type MorningInput, type MorningState } from '../src/morning/model.js';
import { MorningPressError, pressMorning, readMorning, readMorningStates } from '../src/morning/store.js';
import { tickerState } from '../src/ticker/model.js';
import { createTestDatabase } from './helpers/database.js';

// All names, account/set identifiers, dates and figures are invented.
const now = new Date('2032-04-07T08:00:00Z'), today = ukToday(now), born = '2032-04-01';
function set(index: number, extra: Partial<StoredAdSet> = {}): StoredAdSet {
  return { id: `120000000000001${String(index).padStart(3, '0')}`, campaignId: '120000000000002001',
    name: `Invented campaign — Invented Fern ${index} — £20`, owner: 'ours', market: 'uk',
    status: 'ACTIVE', effectiveStatus: 'ACTIVE', currency: 'GBP', flatBudget: null, dailyBudget: null, lifetimeBudget: null,
    createdTime: `${born}T08:00:00Z`, updatedTime: `${born}T08:00:00Z`, learningStage: null, lastSignificantEdit: null,
    campaignName: 'Invented Garden', firstSeen: `${born}T08:00:00Z`, lastSeen: now.toISOString(), lastRead: now.toISOString(), ...extra };
}
function input(count: number, extra: StoredAdSet[] = []): MorningInput {
  const settings = defaultSettings(); settings.metaAdAccountId = '120000000000003001';
  const sets = [...Array.from({ length: count }, (_, index) => set(index)), ...extra];
  const days = new Map(sets.map((row, index): [string, SetDay[]] => [row.id, Array.from({ length: 6 }, (_, offset) => ({
    day: addDays(born, offset), spend: index < count ? 40 + index : 21, purchases: 1, addsToCart: 3,
  }))]));
  const adSets = buildAdSetsView(sets, days, settings, today, { mode: 'live', lastRead: now.toISOString(), accountYesterday: 100 });
  adSets.actionsEnabled = true;
  return { mode: 'live', settings, adSets, needs: [], checks: [], creativeCards: [], activity: [], metaActions: [],
    ticker: tickerState([], [], now, 'live'), sourceReadOk: { adsets: true, activity: true } };
}
function saved(card: MorningCard, extra: Partial<MorningState> = {}): MorningState {
  return { mode: 'live', cardKey: card.key, kind: card.kind, subjectId: card.subjectId, sourceScope: card.sourceScope,
    state: 'parked', factsHash: card.factsHash, untilDay: addDays(today, 1), answer: null,
    title: card.title, credentialId: 'invented-device', pressedAt: now.toISOString(), clearedAt: null, ...extra };
}
const bulk = (data: MorningInput, states: MorningState[] = [], at = now) =>
  morningDeck(data, states, at).snapshot.cards.find(card => card.kind === 'pause-all');

test('two live Kill cards stay individual; three become one Decide with the members retained for fresh eligibility', () => {
  const two = morningDeck(input(2), [], now);
  assert.deepEqual(two.snapshot.cards.map(card => card.kind), ['meta-kill', 'meta-kill']);
  assert.equal(two.snapshot.pauseAll?.members.length, 2, 'An in-flight sequence can still validate its final two members');
  assert.equal(two.snapshot.pauseAll?.deferred, false);
  const data = input(3), result = morningDeck(data, [], now), card = bulk(data)!;
  assert.ok(card); assert.equal(card.title, '3 of ours are over the bar'); assert.equal(card.state, 'decide');
  assert.equal(card.primary.kind, 'pause-all'); assert.equal(card.primary.label, 'Pause all 3');
  if (card.primary.kind === 'pause-all') assert.equal(card.primary.confirm, 'Pause these 3 ad sets now?');
  assert.deepEqual(card.secondary, { kind: 'save', target: 'morning', label: 'One by one', action: 'park' });
  assert.deepEqual(card.allowedPresses, ['park']);
  assert.deepEqual(result.snapshot.cards.map(row => row.kind), ['pause-all']);
  assert.equal(result.snapshot.completed, 0); assert.equal(result.snapshot.total, 1);
  const members = result.candidates.filter(row => row.kind === 'meta-kill');
  assert.equal(members.length, 3);
  assert.deepEqual(result.openCards.filter(row => row.kind === 'meta-kill').map(row => row.key), members.map(row => row.key));
  assert.deepEqual(result.snapshot.pauseAll?.members, members.map(row => ({ cardKey: row.key, factsHash: row.factsHash, adSetId: row.subjectId })));
  assert.equal(result.snapshot.pauseAll?.cardKey, card.key);
});

test('alarms still lead the group and covered members count only once alongside other decisions', () => {
  const data = input(3);
  data.needs = [{ id: 'invented-alarm', state: 'alarm', source: 'pulse', title: 'Invented alarm', why: 'An invented failure.', link: '/sources' }];
  const result = morningDeck(data, [], now);
  assert.deepEqual(result.snapshot.cards.map(card => card.kind), ['need', 'pause-all']);
  assert.equal(result.snapshot.total, 2);
  const byOne = morningDeck(data, [saved(bulk(data)!)], now);
  assert.deepEqual(byOne.snapshot.cards.map(card => card.kind), ['need', 'meta-kill', 'meta-kill', 'meta-kill']);
  assert.equal(byOne.snapshot.completed, 0, 'Choosing a presentation is not an answered ad-set decision');
  assert.equal(byOne.snapshot.total, 4); assert.equal(byOne.snapshot.pauseAll?.deferred, true);
});

test('One by one survives changed figures, a smaller cohort and a reformed cohort until the next UK day', () => {
  const data = input(3), original = bulk(data)!, deferred = saved(original);
  for (const count of [2, 0, 5]) {
    const changed = input(count);
    for (const row of changed.adSets!.rows) row.verdict!.figures[0] = '£999.00 invented spend';
    const result = morningDeck(changed, [deferred], now);
    assert.equal(result.snapshot.cards.some(card => card.kind === 'pause-all'), false);
    assert.equal(result.snapshot.cards.length, count); assert.equal(result.snapshot.completed, 0);
    assert.equal(result.snapshot.pauseAll?.deferred, true);
    assert.equal(result.snapshot.pauseAll?.cardKey, original.key);
    assert.deepEqual(result.clearKeys, [], 'Cohort changes do not clear a day-long choice');
  }
  const reformed = input(5), replacement = bulk(reformed)!;
  assert.equal(replacement.key, original.key); assert.equal(replacement.factsHash, original.factsHash);
  assert.ok(bulk(reformed, [deferred], new Date('2032-04-08T08:00:00Z')));
  reformed.settings.metaAdAccountId = '120000000000003002';
  assert.notEqual(bulk(reformed)!.key, original.key);
  assert.ok(bulk(reformed, [deferred]), 'An account switch does not reuse another account’s day-long choice');
});

test('sample, disabled actions, and non-live ad-set views never offer Pause all', () => {
  for (const disable of [
    (data: MorningInput) => { data.mode = 'sample'; },
    (data: MorningInput) => { data.adSets!.mode = 'sample'; },
    (data: MorningInput) => { data.adSets!.actionsEnabled = false; },
  ]) {
    const data = input(3); disable(data);
    const result = morningDeck(data, [], now);
    assert.equal(result.snapshot.cards.some(card => card.kind === 'pause-all'), false);
    assert.equal(result.snapshot.pauseAll, undefined);
  }
});

test('the list shows eight short names with each verdict’s first figure, and why retains every member', () => {
  const data = input(10), result = morningDeck(data, [], now), card = bulk(data)!;
  const members = result.candidates.filter(row => row.kind === 'meta-kill');
  assert.equal(card.figure.kind, 'list');
  if (card.figure.kind !== 'list') assert.fail('Expected a list figure');
  assert.equal(card.figure.rows.length, 8); assert.equal(card.figure.more, 2);
  const expected = members.slice(0, 8).map(member => {
    const row = data.adSets!.rows.find(row => row.set.id === member.subjectId)!;
    return { label: adSetName(row.set.name), value: row.verdict!.figures[0] };
  });
  assert.deepEqual(card.figure.rows, expected);
  for (const row of data.adSets!.rows) assert.ok(card.why.includes(adSetName(row.set.name)));
  for (const member of members) assert.ok(card.why.includes(member.why), 'The group preserves each decision’s full explanation');
  assert.equal(result.snapshot.pauseAll?.members.length, 10, 'The display cap never drops a pause target');
  assert.equal(card.primary.label, 'Pause all 10'); assert.equal(result.snapshot.total, 1);
});

test('the market flag counts only active sets of ours and clears when one of ours will remain', () => {
  assert.equal(bulk(input(3))!.flag, 'After these, nothing of ours is live in the UK');
  assert.equal(bulk(input(3, [set(20)]))!.flag, undefined, 'A healthy active set of ours stays live');
  assert.equal(bulk(input(3, [set(20, { owner: 'freelancer' }), set(21, { owner: 'unassigned' })]))!.flag,
    'After these, nothing of ours is live in the UK');
  const data = input(3); data.adSets!.rows[0]!.set.market = 'us';
  const flag = bulk(data)!.flag!;
  assert.ok(flag.includes('After these, nothing of ours is live in the UK'));
  assert.ok(flag.includes('After these, nothing of ours is live in the US'));
});

test('held members and stale ownership/status eligibility cannot remain bulk targets', () => {
  const data = input(4), candidate = morningDeck(data, [], now).candidates.find(card => card.kind === 'meta-kill')!;
  const held = saved(candidate, { state: 'answered', answer: 'hold', untilDay: '2032-04-10' });
  const result = morningDeck(data, [held], now);
  assert.equal(result.snapshot.pauseAll?.members.length, 3);
  assert.equal(result.snapshot.pauseAll?.members.some(member => member.cardKey === candidate.key), false);
  assert.equal(result.snapshot.cards[0]!.title, '3 of ours are over the bar');
  assert.equal(result.snapshot.total, 2, 'One held decision plus one open aggregate');
  for (const extra of [{ owner: 'freelancer' as const }, { status: 'PAUSED' }, { effectiveStatus: 'PAUSED' }, { currency: 'USD' }]) {
    const changed = input(3); Object.assign(changed.adSets!.rows[0]!.set, extra);
    const next = morningDeck(changed, [], now);
    assert.equal(next.snapshot.cards.some(card => card.kind === 'pause-all'), false);
    assert.equal(next.snapshot.pauseAll?.members.length, 2);
    assert.equal(next.snapshot.pauseAll?.members.some(member => member.adSetId === changed.adSets!.rows[0]!.set.id), false);
  }
});

test('pending actions remove bulk eligibility and successful pauses leave fresh metadata for the final two sets', () => {
  const data = input(3), row = data.adSets!.rows[0]!;
  data.metaActions = [{ id: 'invented-pending-pause', adSetId: row.set.id, action: 'pause', result: 'pending',
    time: now.toISOString(), oldValue: 'ACTIVE', newValue: 'PAUSED', errorCode: null, undoneAt: null, undoOf: null }];
  const pending = morningDeck(data, [], now);
  assert.equal(pending.snapshot.cards.some(card => card.kind === 'pause-all'), false);
  assert.equal(pending.snapshot.pauseAll?.members.length, 2);
  assert.equal(pending.snapshot.pauseAll?.members.some(member => member.adSetId === row.set.id), false);
  assert.equal(pending.snapshot.completed, 0);
  data.metaActions[0]!.result = 'success'; row.set.status = 'PAUSED';
  const paused = morningDeck(data, [], now);
  assert.deepEqual(paused.snapshot.cards.map(card => card.kind), ['meta-kill', 'meta-kill']);
  assert.equal(paused.snapshot.pauseAll?.members.length, 2);
  assert.equal(paused.snapshot.pauseAll?.members.some(member => member.adSetId === row.set.id), false);
  assert.equal(paused.snapshot.completed, 1); assert.equal(paused.snapshot.total, 3);
});

test('a successful pause stays out of the group through a stale Active read until undone or later resumed', () => {
  const data = input(3), row = data.adSets!.rows[0]!;
  const pause = { id: 'invented-successful-pause', adSetId: row.set.id, action: 'pause' as const, result: 'success' as const,
    time: '2032-04-07T07:00:00.000Z', oldValue: 'ACTIVE', newValue: 'PAUSED', errorCode: null, undoneAt: null, undoOf: null };
  data.metaActions = [pause];
  const stale = morningDeck(data, [], now);
  assert.equal(row.set.status, 'ACTIVE');
  assert.equal(stale.snapshot.cards.some(card => card.kind === 'pause-all'), false);
  assert.equal(stale.snapshot.pauseAll?.members.some(member => member.adSetId === row.set.id), false);
  data.metaActions = [{ ...pause, undoneAt: '2032-04-07T07:30:00.000Z' }];
  assert.equal(bulk(data)!.primary.label, 'Pause all 3');
  const resume = { ...pause, id: 'invented-later-resume', action: 'resume' as const,
    time: '2032-04-07T07:30:00.000Z', oldValue: 'PAUSED', newValue: 'ACTIVE' };
  for (const undoOf of [null, pause.id]) {
    data.metaActions = [pause, { ...resume, undoOf }];
    assert.equal(bulk(data)!.primary.label, 'Pause all 3', 'A deliberate resume or its Undo restores current Active eligibility');
  }
  data.metaActions = [pause, { ...resume, time: '2032-04-07T06:30:00.000Z' }];
  assert.equal(bulk(data), undefined, 'An older resume does not undo a later pause');
  data.metaActions = [pause, resume]; row.set.status = 'PAUSED';
  assert.equal(bulk(data), undefined, 'Stored Paused status still excludes a set despite a later audit resume');
});

test('an uncertain pause resolved as Active stays individual until a later successful deliberate action', () => {
  const data = input(3), row = data.adSets!.rows[0]!;
  const uncertain = { id: 'invented-uncertain-pause', adSetId: row.set.id, action: 'pause' as const, result: 'failed' as const,
    time: '2032-04-07T07:00:00.000Z', oldValue: 'ACTIVE', newValue: 'PAUSED',
    errorCode: pauseUncertaintyCode('active', new Date('2032-04-07T07:01:00.000Z'), 'timeout'), undoneAt: null, undoOf: null };
  data.metaActions = [uncertain];
  const result = morningDeck(data, [], now);
  assert.equal(result.snapshot.pauseAll?.members.length, 2);
  assert.equal(result.snapshot.pauseAll?.members.some(member => member.adSetId === row.set.id), false);
  assert.equal(result.snapshot.cards.some(card => card.kind === 'pause-all'), false);
  assert.equal(result.snapshot.cards.some(card => card.kind === 'meta-kill' && card.subjectId === row.set.id), true,
    'The uncertain set remains available for individual review');
  assert.equal(result.snapshot.completed, 0);
  const budget = { ...uncertain, id: 'invented-later-budget', action: 'budget' as const, result: 'success' as const,
    time: '2032-04-07T07:30:00.000Z', oldValue: '20', newValue: '21', errorCode: null };
  data.metaActions = [uncertain, { ...budget, time: '2032-04-07T06:30:00.000Z' }];
  assert.equal(bulk(data), undefined, 'An earlier success cannot resolve a later uncertain pause');
  data.metaActions = [uncertain, { ...budget, result: 'failed' }];
  assert.equal(bulk(data), undefined, 'A later failed action does not restore bulk eligibility');
  data.metaActions = [uncertain, budget];
  assert.equal(bulk(data)!.primary.label, 'Pause all 3');
});

test('fresh member metadata changes when its Kill rule changes, while the fixed group identity is preserved', () => {
  const data = input(3), before = morningDeck(data, [], now), row = data.adSets!.rows[0]!;
  const previous = before.snapshot.pauseAll!.members.find(member => member.adSetId === row.set.id)!;
  row.days = row.days.map(day => ({ ...day, purchases: 4, addsToCart: 1 }));
  row.verdict = judgeAdSet(row.set, row.days, data.settings, today);
  assert.equal(row.verdict!.reasons[0]!.rule, 'atc-cost');
  const after = morningDeck(data, [], now), current = after.snapshot.pauseAll!.members.find(member => member.adSetId === row.set.id)!;
  assert.equal(current.cardKey, previous.cardKey); assert.notEqual(current.factsHash, previous.factsHash);
  assert.equal(after.snapshot.pauseAll!.cardKey, before.snapshot.pauseAll!.cardKey);
});

test('One by one is a local audited press, keeps current guards, survives reload and can be put back', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  let data = input(3);
  const load = async () => data, first = morningDeck(data, [], now), card = bulk(data)!;
  const member = first.candidates.find(candidate => candidate.kind === 'meta-kill')!;
  await assert.rejects(pressMorning(db, load, { cardKey: member.key, action: 'hold', days: 3 }, 'invented-device', now),
    (error: unknown) => error instanceof MorningPressError && error.statusCode === 409,
    'A covered member does not offer guessed individual presses');
  const parked = await pressMorning(db, load, { cardKey: card.key, action: 'park' }, 'invented-device', now);
  assert.equal(parked.cards.length, 3); assert.equal(parked.completed, 0); assert.equal(parked.total, 3);
  assert.equal(parked.pauseAll?.deferred, true);
  assert.equal((await readMorningStates(db, 'live'))[0]!.kind, 'pause-all');
  assert.equal((await db.query('SELECT 1 FROM pulse.meta_actions')).rowCount, 0);
  assert.equal((await db.query('SELECT 1 FROM pulse.audit_log')).rowCount, 1);
  data = input(2); assert.equal((await readMorning(db, load, now)).cards.length, 2);
  data = input(5); assert.equal((await readMorning(db, load, now)).cards.length, 5);
  const restored = await pressMorning(db, load, { cardKey: card.key, action: 'undo' }, 'invented-device', now);
  assert.deepEqual(restored.cards.map(row => row.kind), ['pause-all']); assert.equal(restored.total, 1);
  assert.equal((await db.query('SELECT 1 FROM pulse.audit_log')).rowCount, 2);
  await pressMorning(db, load, { cardKey: card.key, action: 'park' }, 'invented-device', now);
  const tomorrow = await readMorning(db, load, new Date('2032-04-08T08:00:00Z'));
  assert.equal(tomorrow.cards[0]!.kind, 'pause-all'); assert.equal(tomorrow.pauseAll?.deferred, false);
  assert.equal((await readMorningStates(db, 'live')).length, 0);
});
