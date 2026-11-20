import assert from 'node:assert/strict';
import test from 'node:test';
import {sampleKitFacts} from '../src/kits/sample.js';
import {homeKits, kitSheet} from '../src/kits/presentation.js';
import {kitsPageView} from '../src/kits/page-model.js';
import {homeKitsHtml, kitMoveHtml, kitSheetHtml} from '../src/kits/view.js';

const now = new Date('2032-04-07T12:00:00Z');

test('sample cards demonstrate an owner call, an owner move and waiting without increasing membership', () => {
  const facts = sampleKitFacts(now), view = homeKits(facts, 'sample', now);
  assert.equal(facts.mode, 'sample');
  assert.deepEqual(facts.kits.rows.map(row => row.name), ['Box A', 'Box B', 'Box C', 'Box D', 'Box E', 'Box F']);
  assert.deepEqual(view.cards.map(row => row.id), ['box-a', 'box-b', 'box-c']);
  assert.deepEqual(view.folded.map(row => row.id), ['box-d', 'box-e', 'box-f']);
  assert.deepEqual(view.cards.map(row => row.move!.label), ['◆ Your call', '○ Nothing for you right now', '◆ Your move']);
  const [call, waiting, move] = view.cards;
  assert.equal(call!.move!.action, 'Shall we keep this collection on sale for another month?');
  assert.equal(call!.move!.note, 'Next check 14 Apr');
  assert.equal(waiting!.move!.action, 'The kit maker is sending the printed sample for safety tests.');
  assert.equal(waiting!.move!.note, 'Waiting 6 days');
  assert.equal(move!.move!.action, 'Choose the artwork for the next printed proof.');
  assert.equal(move!.move!.note, null);
  assert.equal(facts.orders.rows.length, 8);
  assert.equal(facts.orders.rows.filter(row => row.kit === 'Box B').length, 5);
  const html = homeKitsHtml(view);
  assert.match(html, /Sample data · invented kits/);
  assert.match(html, /\+3 planned · show/);
  for (const card of view.cards) {
    const sheet = kitSheet(facts, card.id, now)!;
    assert.deepEqual(sheet.move, card.move);
    assert.ok(html.includes(kitMoveHtml(card.move)));
    assert.ok(kitSheetHtml(sheet).includes(kitMoveHtml(card.move)));
  }
});

test('sample sellout and nearest dates reach the shared cards and sheets in plain words', () => {
  const facts = sampleKitFacts(now), view = homeKits(facts, 'sample', now), page = kitsPageView(facts, 'sample', now);
  const [live, waiting, move] = view.cards;
  assert.equal(facts.kits.rows[0]!.selloutTarget, '2032-05-26');
  assert.equal(live!.status.label, 'On sale');
  assert.equal(live!.distance, '7 wks');
  assert.equal(live!.launch, 'left on sale: The first collection');
  assert.equal(live!.stepAside, 'Stock count 14 Apr');
  assert.equal(waiting!.status.label, 'Safety tests');
  assert.equal(waiting!.stepAside, 'Sample due 14 Apr');
  assert.equal(move!.status.label, 'Being designed');
  assert.equal(move!.stepAside, 'Proof due 21 Apr');
  assert.deepEqual(page.cards.slice(0, 3), view.cards, 'The Kits page uses the same sample card projections');
  for (const card of view.cards) assert.equal(kitSheet(facts, card.id, now)!.nextDate, card.stepAside);
  const waitingSheet = kitSheet(facts, 'box-b', now)!;
  assert.equal(waitingSheet.milestone, 'Safety tests start after the sample arrives.');
  assert.deepEqual(waitingSheet.waiting, {days: 6, with: 'the kit maker'});
  assert.equal(waitingSheet.orders.length, 5);
  assert.equal(kitSheet(facts, 'box-a', now)!.waiting, null);
});

test('new sample moves and sellout facts remain suppressed beside a live dashboard', () => {
  const facts = sampleKitFacts(now), hidden = homeKits(facts, 'live', now), page = kitsPageView(facts, 'live', now);
  assert.equal(hidden.ready, false);
  assert.equal(hidden.summary, null);
  assert.deepEqual(hidden.cards, []); assert.deepEqual(hidden.folded, []);
  assert.deepEqual(page.cards, []); assert.deepEqual(page.orderGroups, []); assert.equal(page.timeline, null);
  const html = homeKitsHtml(hidden);
  assert.match(html, /Not set up yet/);
  assert.doesNotMatch(html, /Box [A-F]|Your call|Nothing for you|left on sale|Stock count|Sample due|Proof due|Sample data/);
});
