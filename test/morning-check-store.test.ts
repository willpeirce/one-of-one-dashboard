import assert from 'node:assert/strict';
import test from 'node:test';
import type { HQBriefItem } from '../src/github-hq/model.js';
import { defaultSettings } from '../src/settings.js';
import { tickerState } from '../src/ticker/model.js';
import type { MorningInput } from '../src/morning/model-types.js';
import { morningDeck } from '../src/morning/model.js';
import { MorningPressError, pressMorning, readMorning, readMorningStates } from '../src/morning/store.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2032-04-07T08:00:00Z'), device = 'invented-check-device';
function input(items: HQBriefItem[] = [{ text: 'Invented check task', lines: ['Invented evidence.'] }]): MorningInput {
  return { mode: 'live', needs: [], checks: [], creativeCards: [], settings: defaultSettings(),
    ticker: tickerState([], [], now, 'live'), activity: [], metaActions: [], sourceReadOk: {},
    brief: { mode: 'live', status: 'needs', day: '2032-04-06', text: 'Morning check · 07:41 · 1 item',
      runLabel: 'Invented run · 07:41', items, count: items.length, href: 'https://example.invalid/invented-check' } };
}

test('Seen persists on an unchanged rerun, changed content gets a new card, and yesterday’s item state never hides today’s entry', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  let data = input(); const load = async () => data;
  const first = (await readMorning(db, load, now)).cards[0]!;
  const seen = await pressMorning(db, load, { cardKey: first.key, action: 'ack' }, device, now);
  assert.equal(seen.cards.length, 0); assert.equal(seen.completed, 1); assert.equal(seen.brief!.allInDeck, true);
  data.brief!.runLabel = 'Invented rerun · 09:42';
  assert.equal((await readMorning(db, load, now)).cards.length, 0);
  data.brief!.items![0]!.lines = ['Invented changed evidence.'];
  const changed = await readMorning(db, load, now);
  assert.equal(changed.cards.length, 1); assert.notEqual(changed.cards[0]!.key, first.key);
  assert.equal(changed.completed, 1); assert.equal(changed.total, 2);
  await pressMorning(db, load, { cardKey: changed.cards[0]!.key, action: 'ack' }, device, now);
  const next = new Date('2032-04-08T08:00:00Z'); data.brief!.day = '2032-04-07';
  const today = await readMorning(db, load, next);
  assert.equal(today.cards.length, 1); assert.notEqual(today.cards[0]!.key, changed.cards[0]!.key);
  assert.equal(today.completed, 0); assert.equal((await readMorningStates(db, 'live')).length, 0);
  assert.equal((await db.query('SELECT 1 FROM pulse.audit_log')).rowCount, 2);
  assert.equal((await db.query('SELECT 1 FROM pulse.meta_actions')).rowCount, 0);
});

test('a check hold is local, can be put back, and cannot suppress a different item at the same position', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const id = '120000000000006001';
  let data = input([{ text: 'Invented pause recommendation', lines: ['Invented cost evidence.'], tag: { type: 'pause', adSetId: id } }]);
  const load = async () => data, first = (await readMorning(db, load, now)).cards[0]!;
  const held = await pressMorning(db, load, { cardKey: first.key, action: 'hold', days: 3 }, device, now);
  assert.equal(held.cards.length, 0); assert.equal(held.answers[0]!.untilDay, '2032-04-10');
  assert.equal(held.completed, 1);
  data = input([{ text: 'Invented revised recommendation', lines: ['Invented cost evidence.'], tag: { type: 'pause', adSetId: id } }]);
  const revised = await readMorning(db, load, now);
  assert.equal(revised.cards.length, 1); assert.notEqual(revised.cards[0]!.key, first.key);
  const undone = await pressMorning(db, load, { cardKey: first.key, action: 'undo' }, device, now);
  assert.equal(undone.cards.length, 1); assert.equal(undone.completed, 0);
  assert.equal((await readMorningStates(db, 'live')).length, 0);
  assert.equal((await db.query('SELECT 1 FROM pulse.audit_log')).rowCount, 2);
  assert.equal((await db.query('SELECT 1 FROM pulse.meta_actions')).rowCount, 0);
});

test('capped Watch items cannot accept a guessed press until an offered item is answered', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const data = input(Array.from({ length: 9 }, (_, index) => ({ text: `Invented task ${index}`, lines: [`Invented detail ${index}.`] })));
  const load = async () => data, initial = await readMorning(db, load, now);
  assert.equal(initial.cards.length, 7); assert.equal(initial.more, 2);
  const omitted = morningDeck(data, [], now).candidates.find(card => card.title === 'Invented task 8')!;
  await assert.rejects(pressMorning(db, load, { cardKey: omitted.key, action: 'ack' }, device, now),
    (error: unknown) => error instanceof MorningPressError && error.statusCode === 409);
  await pressMorning(db, load, { cardKey: initial.cards[0]!.key, action: 'ack' }, device, now);
  const progressed = await pressMorning(db, load, { cardKey: initial.cards[1]!.key, action: 'ack' }, device, now);
  assert.ok(progressed.cards.some(card => card.key === omitted.key)); assert.equal(progressed.more, 0);
  const saved = await pressMorning(db, load, { cardKey: omitted.key, action: 'ack' }, device, now);
  assert.equal(saved.completed, 3); assert.equal(saved.brief!.allInDeck, true);
  assert.equal((await db.query('SELECT 1 FROM pulse.meta_actions')).rowCount, 0);
});

test('a held check-only freelancer decision stays completed when the same-day rerun removes its item', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  let data = input([{ text: 'Invented freelancer follow-up', lines: ['Invented check evidence.'], tag: { type: 'freelancer' } }]);
  const load = async () => data, first = (await readMorning(db, load, now)).cards[0]!;
  assert.equal(first.kind, 'google'); assert.equal(first.sourceScope, 'check');
  const held = await pressMorning(db, load, { cardKey: first.key, action: 'hold', days: 7 }, device, now);
  assert.equal(held.completed, 1); assert.equal(held.total, 1);
  data = input([]); data.brief!.status = 'ok'; data.brief!.runLabel = 'Invented rerun · 09:42';
  for (let read = 0; read < 2; read++) {
    const clear = await readMorning(db, load, now);
    assert.equal(clear.cards.length, 0); assert.equal(clear.completed, 1); assert.equal(clear.total, 1);
    assert.equal(clear.answers[0]!.sourceScope, 'check'); assert.equal(clear.presses[0]!.cardKey, first.key);
  }
  assert.equal((await db.query('SELECT 1 FROM pulse.audit_log')).rowCount, 1);
  assert.equal((await db.query('SELECT 1 FROM pulse.meta_actions')).rowCount, 0);
});
