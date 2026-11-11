import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import type {Database} from '../src/db.js';
import type {DashboardNeed} from '../src/shopify/dashboard.js';
import {defaultSettings} from '../src/settings.js';
import {tickerState} from '../src/ticker/model.js';
import {addMorningGoogle} from '../src/morning/google.js';
import type {MorningInput} from '../src/morning/model-types.js';
import {MorningPressError, pressMorning, readMorning} from '../src/morning/store.js';
import {createTestDatabase} from './helpers/database.js';

const now = new Date('2032-04-07T08:00:00Z');
const credential = 'invented-freelancer-device';
function flag(id = 'google-nosale:invented-fern', spend = 85): DashboardNeed {
  return {id, source: 'google-ads', state: 'warn', title: `Invented no-purchase flag ${id}`,
    why: `Invented campaign spent £${spend} without a purchase.`, link: '/settings',
    googleFlag: {kind: 'nosale', rule: 'Invented zero-purchase spend threshold.',
      sourceLine: 'Invented stored Google read', measure: {value: spend, bar: 70,
        label: 'Spend with no purchases', formattedValue: `£${spend}`, formattedBar: '£70'}}};
}
function input(needs: DashboardNeed[] = [flag()]): MorningInput {
  return {mode: 'live', needs, checks: [], creativeCards: [],
    settings: {...defaultSettings(), googleCustomerId: '1200000000'},
    ticker: tickerState([], [], now, 'live'), activity: [], metaActions: [],
    sourceReadOk: {google: true, 'needs:google-ads': true}};
}
async function harness(t: TestContext) {
  const db = await createTestDatabase(); t.after(() => db.close());
  let current = input();
  const writes: string[] = [];
  const observe = (connection: Database): Database => ({
    query(sql, values) {
      for (const match of sql.matchAll(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(pulse(?:_private)?\.[a-z_]+)/gi))
        writes.push(match[1]!);
      return connection.query(sql, values);
    },
    transaction: fn => connection.transaction(tx => fn(observe(tx))),
    close: async () => {},
  });
  const observed = observe(db), load = async () => addMorningGoogle(current);
  return {db, writes, read: (at = now) => readMorning(observed, load, at),
    press: (cardKey: string, action: 'hold' | 'hide' | 'park' | 'undo', at = now) =>
      pressMorning(observed, load, {cardKey, action, ...(action === 'hold' ? {days: 7 as const} : {})}, credential, at),
    setInput: (next: MorningInput) => {current = next;}};
}

test('the freelancer hold is local, rejects Not today and survives changing figures and line membership for seven UK days', async t => {
  const h = await harness(t), initial = await h.read(), card = initial.cards[0]!;
  assert.equal(initial.cards.length, 1); assert.equal(card.kind, 'google'); assert.equal(card.state, 'decide');
  assert.deepEqual(card.allowedPresses, ['hold', 'hide']);
  assert.deepEqual(card.secondary, {kind: 'save', target: 'morning', label: 'Leave it, ask in a week', action: 'hold', days: 7});
  assert.ok([card.primary, card.secondary, ...card.menu].every(button => button?.kind !== 'live'));
  await assert.rejects(h.press(card.key, 'park'),
    (error: unknown) => error instanceof MorningPressError && error.statusCode === 409);
  assert.deepEqual(h.writes, []);
  const held = await h.press(card.key, 'hold');
  assert.equal(held.cards.length, 0); assert.equal(held.completed, 1);
  assert.equal(held.answers[0]!.untilDay, '2032-04-14');
  assert.deepEqual(h.writes, ['pulse.morning_card_states', 'pulse.audit_log']);
  h.setInput(input([flag('google-nosale:invented-fern', 125), flag('google-nosale:invented-moss', 95)]));
  assert.equal((await h.read(new Date('2032-04-08T08:00:00Z'))).cards.length, 0);
  h.setInput(input([flag('google-nosale:invented-moss', 155)]));
  const seventhDay = await h.read(new Date('2032-04-13T22:59:59Z'));
  assert.equal(seventhDay.cards.length, 0); assert.equal(seventhDay.answers[0]!.untilDay, '2032-04-14');
  const eighthDay = await h.read(new Date('2032-04-13T23:00:00Z'));
  assert.equal(eighthDay.day, '2032-04-14'); assert.equal(eighthDay.cards.length, 1);
  assert.equal(eighthDay.cards[0]!.key, card.key);
  assert.notEqual(eighthDay.cards[0]!.factsHash, card.factsHash);
  assert.match(eighthDay.cards[0]!.why, /£155/);
  assert.equal(eighthDay.completed, 0); assert.equal(eighthDay.answers.length, 0);
  assert.deepEqual((await h.db.query('SELECT event,credential_id FROM pulse.audit_log')).rows,
    [{event: `Morning held: ${card.title}`.slice(0, 80), credential_id: credential}]);
  assert.equal((await h.db.query('SELECT 1 FROM pulse.meta_actions')).rowCount, 0);
  assert.ok(h.writes.every(table => ['pulse.morning_card_states', 'pulse.audit_log'].includes(table)));
});

test('Undo puts the freelancer card back immediately with its changed stored lines', async t => {
  const h = await harness(t), card = (await h.read()).cards[0]!;
  await h.press(card.key, 'hold');
  h.setInput(input([flag('google-nosale:invented-new-line', 110)]));
  const undone = await h.press(card.key, 'undo');
  assert.equal(undone.cards.length, 1); assert.equal(undone.cards[0]!.key, card.key);
  assert.match(undone.cards[0]!.why, /£110/);
  assert.equal(undone.completed, 0); assert.equal(undone.answers.length, 0);
  assert.equal((await h.db.query('SELECT 1 FROM pulse.morning_card_states')).rowCount, 0);
  const audits = (await h.db.query<{event: string}>('SELECT event FROM pulse.audit_log ORDER BY id')).rows;
  assert.equal(audits.length, 2); assert.match(audits[0]!.event, /^Morning held:/); assert.match(audits[1]!.event, /^Morning put back:/);
  assert.equal((await h.db.query('SELECT 1 FROM pulse.meta_actions')).rowCount, 0);
});

test('today’s held or hidden freelancer decision remains completed when every loss line disappears', async t => {
  for (const action of ['hold', 'hide'] as const) await t.test(action, async child => {
    const h = await harness(child), card = (await h.read()).cards[0]!;
    await h.press(card.key, action);
    h.setInput(input([]));
    for (let read = 0; read < 2; read++) {
      const clear = await h.read();
      assert.equal(clear.cards.length, 0); assert.equal(clear.completed, 1); assert.equal(clear.total, 1);
      assert.equal(clear.presses[0]!.cardKey, card.key);
      assert.ok(clear.fine.some(row => row.label === 'No Google flags'));
    }
    assert.equal((await h.db.query('SELECT 1 FROM pulse.audit_log')).rowCount, 1);
    assert.equal((await h.db.query('SELECT 1 FROM pulse.meta_actions')).rowCount, 0);
  });
});
