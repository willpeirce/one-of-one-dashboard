import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, ukToday } from '../src/hero-range.js';
import { defaultSettings, type Settings } from '../src/settings.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import type { MetaAction } from '../src/meta-adsets/actions.js';
import type { StoredAdSet } from '../src/meta-adsets/catalogue.js';
import { buildAdSetsView, type AdSetsView } from '../src/meta-adsets/presentation.js';
import { overlayAdSetControls } from '../src/morning/control-overlay.js';
import { morningInputFromDashboard } from '../src/morning/inputs.js';
import { morningDeck, type MorningCard, type MorningState } from '../src/morning/model.js';
import { tickerState } from '../src/ticker/model.js';

// All names, identifiers, dates and figures are invented.
const now = new Date('2032-04-07T08:00:00Z');
function fixture() {
  const settings = defaultSettings();
  settings.metaAdAccountId = '120000000000091001'; settings.cppUkBreakEvenGbp = 20;
  const sets: StoredAdSet[] = ['Kill', 'Watch'].map((label, index) => ({
    id: `12000000000009100${index + 2}`, campaignId: '120000000000091004',
    name: `Invented UK ${label} fern`, owner: 'ours', market: 'uk', status: 'ACTIVE', effectiveStatus: 'ACTIVE',
    currency: 'GBP', flatBudget: null, dailyBudget: 2000, lifetimeBudget: null,
    createdTime: '2032-03-31T08:00:00Z', updatedTime: '2032-03-31T08:00:00Z',
    learningStage: label === 'Watch' ? 'LEARNING_LIMITED' : null, lastSignificantEdit: null,
    campaignName: 'Invented UK garden', firstSeen: '2032-03-31T08:00:00Z', lastSeen: now.toISOString(), lastRead: now.toISOString(),
  }));
  return { settings, sets, view: build(sets, settings) };
}
function build(sets: StoredAdSet[], settings: Settings, at = now, cleared = false): AdSetsView {
  const today = ukToday(at), days = new Map(sets.map((set, index) => [set.id,
    Array.from({ length: 7 }, (_, offset) => ({ day: addDays(today, offset - 7),
      spend: index === 0 && !cleared ? 40 : 21, purchases: 1, addsToCart: 3 }))]));
  return { ...buildAdSetsView(sets, days, settings, today,
    { mode: 'live', lastRead: at.toISOString(), accountYesterday: 61 }), actionsEnabled: true };
}
function input(view: AdSetsView, settings: Settings, at = now) {
  const dashboard = getSampleDashboard(settings);
  dashboard.adSets = view; dashboard.shopify = undefined; dashboard.creatives = undefined;
  dashboard.sourceHealth = [{ source: 'meta', name: 'Meta Ads', stage: 2, requiredKeys: [],
    mode: 'live', status: 'healthy', lastSuccessAt: at, lastAttemptAt: at, consecutiveFailures: 0, updatedAt: at }];
  return morningInputFromDashboard(dashboard, settings, tickerState([], [], at, 'live'), 'live',
    { adsets: true, creatives: false, creativeReadAt: null, google: false, googleReadAt: null });
}
function hidden(card: MorningCard, pressedAt = now.toISOString()): MorningState {
  return { mode: 'live', cardKey: card.key, kind: card.kind, subjectId: card.subjectId, sourceScope: card.sourceScope,
    title: card.title, factsHash: card.factsHash, state: 'hidden', untilDay: null, answer: null,
    credentialId: 'invented-device', pressedAt, clearedAt: null };
}

for (const change of ['budget', 'rules', 'day'] as const) test(`a ${change} change defers cached judgments without clearing hidden Kill or Watch states`, () => {
  const { settings, sets, view } = fixture(), original = structuredClone(view);
  const originalInput = input(view, settings), cards = morningDeck(originalInput, [], now).candidates;
  assert.equal(originalInput.sourceReadOk.adsets, true);
  assert.deepEqual(cards.map(card => card.kind), ['meta-kill', 'meta-watch']);
  const states = cards.map(card => hidden(card)), current = structuredClone(settings), fresh = structuredClone(sets);
  const at = change === 'day' ? new Date('2032-04-08T08:00:00Z') : now;
  if (change === 'budget') for (const set of fresh) set.dailyBudget = 2500;
  if (change === 'rules') current.adRules.uk.killBar = 1.4;
  const overlaid = overlayAdSetControls(view, settings, current, fresh, [], ukToday(at));
  assert.equal(overlaid.stale, true); assert.ok(overlaid.rows.every(row => row.verdict === null));
  const deferred = input(overlaid, current, at), result = morningDeck(deferred, states, at);
  assert.equal(deferred.sourceReadOk.adsets, false, 'A fresh catalogue cannot certify an omitted cached judgment');
  assert.deepEqual(result.clearKeys, []); assert.deepEqual(result.deleteKeys, []);
  assert.deepEqual(result.snapshot.hidden.map(row => row.stateRow.cardKey), states.map(row => row.cardKey));
  assert.equal(result.snapshot.cards.length, 0); assert.deepEqual(view, original, 'The cached snapshot remains immutable');

  const rebuilt = build(fresh, current, at);
  const ready = input(overlayAdSetControls(rebuilt, current, current, fresh, [], ukToday(at)), current, at);
  const retained = morningDeck(ready, states, at);
  assert.equal(ready.sourceReadOk.adsets, true);
  assert.deepEqual(retained.clearKeys, []); assert.deepEqual(retained.deleteKeys, []);
  assert.equal(retained.snapshot.hidden.length, 2, 'A completed rebuild with the same rules retains both hidden cards');
  assert.equal(retained.openCards.length, 0);
});

test('only a certified rebuilt absent rule clears a saved hidden ad-set decision', () => {
  const { settings, sets, view } = fixture();
  const states = morningDeck(input(view, settings), [], now).candidates.map(card => hidden(card));
  const fresh = sets.map(set => ({ ...set, learningStage: null })), rebuilt = build(fresh, settings, now, true);
  assert.ok(rebuilt.rows.every(row => row.verdict?.verdict === 'Clear'));
  const ready = input(overlayAdSetControls(rebuilt, settings, settings, fresh, [], ukToday(now)), settings);
  assert.equal(ready.sourceReadOk.adsets, true);
  const result = morningDeck(ready, states, now);
  assert.deepEqual(result.clearKeys, states.map(row => row.cardKey));
  assert.equal(result.snapshot.hidden.length, 0);
});

test('a changed flat-budget flag defers even a cached null verdict instead of deleting an older hidden Kill', () => {
  const { settings, sets, view } = fixture();
  const card = morningDeck(input(view, settings), [], now).candidates.find(row => row.kind === 'meta-kill')!;
  const saved = hidden(card, '2032-04-06T08:00:00Z');
  view.rows[0]!.verdict = null;
  const fresh = sets.map(set => ({ ...set, flatBudget: true }));
  const overlaid = overlayAdSetControls(view, settings, settings, fresh, [], ukToday(now));
  assert.equal(overlaid.rows[0]!.verdict, null); assert.equal(overlaid.stale, true);
  const deferred = input(overlaid, settings), result = morningDeck(deferred, [saved], now);
  assert.equal(deferred.sourceReadOk.adsets, false);
  assert.deepEqual(result.clearKeys, []); assert.deepEqual(result.deleteKeys, []);
  assert.equal(result.snapshot.hidden[0]?.stateRow.cardKey, saved.cardKey);
});

test('fresh paused controls and action history still replace cached ACTIVE data while judgments are deferred', () => {
  const { settings, sets, view } = fixture(), original = structuredClone(view);
  const saved = hidden(morningDeck(input(view, settings), [], now).candidates[0]!);
  const fresh = sets.map(set => ({ ...set, status: 'PAUSED', effectiveStatus: 'PAUSED' }));
  const action: MetaAction = { id: 'invented-pause-action', time: now.toISOString(), adSetId: sets[0]!.id,
    action: 'pause', oldValue: 'ACTIVE', newValue: 'PAUSED', result: 'success', undoneAt: null, undoOf: null, errorCode: null };
  const base = structuredClone(view);
  Reflect.deleteProperty(base, 'catalogue');
  const withoutCatalogue = overlayAdSetControls(base, settings, settings, fresh, [action], ukToday(now));
  assert.equal(Reflect.has(withoutCatalogue, 'catalogue'), false, 'The base projection gains no optional catalogue field');
  const catalogue = (rows: StoredAdSet[]) => rows.map(({ id, name, owner, status, effectiveStatus, currency }) =>
    ({ id, name, owner, status, effectiveStatus, currency }));
  const extended = { ...base, catalogue: catalogue(sets) }, extendedOriginal = structuredClone(extended);
  const overlaid = overlayAdSetControls(extended, settings, settings, fresh, [action], ukToday(now));
  assert.equal(overlaid.stale, true); assert.ok(overlaid.rows.every(row => row.set.status === 'PAUSED' && row.verdict === null));
  assert.deepEqual(Reflect.get(overlaid, 'catalogue'), catalogue(fresh), 'Every optional catalogue entry uses the fresh controls');
  assert.deepEqual(overlaid.actions, [action]); assert.deepEqual(view, original); assert.deepEqual(extended, extendedOriginal);
  const deferred = input(overlaid, settings), result = morningDeck(deferred, [saved], now);
  assert.equal(deferred.sourceReadOk.adsets, false); assert.deepEqual(deferred.metaActions, [action]);
  assert.equal(result.candidates.length, 0, 'A stale ACTIVE card cannot offer a new live action after the pause');
  assert.equal(result.snapshot.metaActions[0]?.id, action.id);
  assert.equal(result.snapshot.metaActions[0]?.undo?.action, 'undo', 'The fresh successful action keeps its existing individual Undo');
  assert.equal(result.snapshot.hidden[0]?.stateRow.cardKey, saved.cardKey);
  assert.deepEqual(result.clearKeys, []); assert.deepEqual(result.deleteKeys, []);
});
