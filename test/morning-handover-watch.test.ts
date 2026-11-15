import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings } from '../src/settings.js';
import { morningDeck, type MorningInput, type MorningState } from '../src/morning/model.js';
import { morningDeckHtml, morningLinesHtml, morningWatchHtml } from '../src/morning/view.js';
import { tickerState } from '../src/ticker/model.js';

const now = new Date('2032-04-09T09:00:00.000Z');
function input(): MorningInput {
  return {mode: 'live', needs: [], checks: [], creativeCards: [], ticker: tickerState([], [], now, 'live'),
    settings: defaultSettings(), activity: [], metaActions: [], sourceReadOk: {'needs:pulse': true, 'needs:github-hq': true}};
}

test('Handover Watch needs stay out of the deck and Home count while decisions and alarms remain in the deck', () => {
  const data = input();
  data.needs = [
    {id: 'invented-waiting', source: 'github-hq', state: 'warn', title: 'Invented waiting items', why: 'Invented waiting evidence.', link: '/handover'},
    {id: 'invented-issues', source: 'pulse', state: 'warn', title: 'Invented issue cases', why: 'Invented issue evidence.', link: '/handover'},
    {id: 'invented-home', source: 'pulse', state: 'warn', title: 'Invented Home watch', why: 'Invented Home evidence.', link: '/sources'},
    {id: 'invented-decision', source: 'pulse', state: 'decide', title: 'Invented decision', why: 'Invented decision evidence.', link: '/handover'},
    {id: 'invented-alarm', source: 'pulse', state: 'alarm', title: 'Invented alarm', why: 'Invented alarm evidence.', link: '/handover'},
  ];
  const result = morningDeck(data, [], now);
  assert.equal(result.snapshot.watchOnHome, 1);
  assert.deepEqual(result.snapshot.watchOnHandover?.map(row => row.title), ['Invented waiting items', 'Invented issue cases']);
  assert.deepEqual(result.snapshot.cards.map(row => row.subjectId), ['invented-alarm', 'invented-decision']);
  assert.equal(result.snapshot.total, 2);
  assert.equal(result.openCards.length, 5, 'Handover Watch needs remain full candidates and open observations');
  for (const row of result.snapshot.watchOnHandover!) {
    assert.deepEqual(Object.keys(row).sort(), ['key', 'sourceHref', 'title', 'why']);
    assert.equal(row.sourceHref, '/handover');
  }
});

test('hidden or parked Handover watches stop counting, and absent Handover watches add no snapshot field or markup', () => {
  const data = input(); data.needs = [{id: 'invented-waiting', source: 'pulse', state: 'warn', title: 'Invented waiting item', why: 'Invented reason', link: '/handover'}];
  const candidate = morningDeck(data, [], now).candidates[0]!;
  for (const state of ['hidden', 'parked'] as const) {
    const saved: MorningState = {mode: 'live', cardKey: candidate.key, state, untilDay: state === 'parked' ? '2032-04-10' : null,
      factsHash: candidate.factsHash, answer: null, credentialId: 'invented-device', pressedAt: now.toISOString(), clearedAt: null,
      title: candidate.title, kind: candidate.kind, subjectId: candidate.subjectId, sourceScope: candidate.sourceScope};
    const snapshot = morningDeck(data, [saved], now).snapshot;
    assert.equal(Object.hasOwn(snapshot, 'watchOnHandover'), false);
    assert.equal(snapshot.watchOnHome, 0);
    assert.match(morningLinesHtml(snapshot), /id="mn-watch-none"/);
    assert.doesNotMatch(morningLinesHtml(snapshot), /id="mn-watch"/);
    assert.equal(morningLinesHtml(snapshot), morningLinesHtml({...snapshot, watchOnHandover: []}));
  }
  data.needs[0]!.link = '/sources';
  const onlyHome = morningDeck(data, [], now).snapshot;
  assert.equal(Object.hasOwn(onlyHome, 'watchOnHandover'), false);
  assert.match(morningLinesHtml(onlyHome), /id="mn-more-home" href="\/\?from=morning"[\s\S]*Watch · 1 on Home<\/a>/);
  assert.match(morningDeckHtml(onlyHome), /1 Watch card is on Home\./);
});

test('the existing Watch control opens one sheet with accurate Home and Handover counts, evidence and safe links', () => {
  const data = input(); data.needs = [
    {id: 'invented-waiting', source: 'github-hq', state: 'warn', title: '<img src=x>', why: 'An invented <script>reason</script>.', link: '/handover'},
    {id: 'invented-home', source: 'pulse', state: 'warn', title: 'Invented Home watch', why: 'Invented Home reason.', link: '/sources'},
  ];
  const snapshot = morningDeck(data, [], now).snapshot;
  assert.match(morningLinesHtml(snapshot), /<button type="button" class="mn-watch-line" id="mn-watch" aria-haspopup="dialog">[\s\S]*Watch · 2 to check<\/button>/);
  const sheet = morningWatchHtml(snapshot);
  assert.match(sheet, /href="\/\?from=morning">△ Home · 1 Watch card/);
  assert.match(sheet, /href="\/handover">Open Handover/);
  assert.match(sheet, /&lt;img src=x&gt;/);
  assert.match(sheet, /An invented &lt;script&gt;reason&lt;\/script&gt;/);
  assert.doesNotMatch(sheet, /<img src=x>|<script>/);
  assert.match(morningDeckHtml(snapshot), /Your Morning deck is clear\. 1 Watch card is on Home\. 1 Watch card is on Handover\./);
  snapshot.watchOnHome = 0;
  assert.match(morningDeckHtml(snapshot), /Your Morning deck is clear\. 1 Watch card is on Handover\./);
  assert.doesNotMatch(morningDeckHtml(snapshot), /Nothing else needs you/);
  assert.match(morningWatchHtml(snapshot), /✓ Home · no Watch cards/);
});
