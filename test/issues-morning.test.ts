import assert from 'node:assert/strict';
import test from 'node:test';
import type {DashboardSnapshot} from '../src/dashboard-types.js';
import {changedSourceScopes, fenceDashboardScopes} from '../src/morning/control-overlay.js';
import {morningInputFromDashboard} from '../src/morning/inputs.js';
import {morningDeck, type MorningCard, type MorningState} from '../src/morning/model.js';
import {morningSummaryPayload} from '../src/push/service.js';
import {getSampleDashboard} from '../src/sample-dashboard.js';
import {defaultSettings, type Settings} from '../src/settings.js';
import type {DashboardNeed} from '../src/shopify/dashboard.js';
import {tickerState} from '../src/ticker/model.js';

const now = new Date('2032-04-07T12:00:00Z');
const issue: DashboardNeed = {id: 'issues-scratched-slab', source: 'pulse', sourceMode: 'live',
  readScope: 'needs:issues', state: 'warn', title: 'Scratched slab cases have doubled',
  why: 'Three invented cases this month, one last month. Review #8401.', link: '/handover'};
const unrelated: DashboardNeed = {id: 'invented-pulse-watch', source: 'pulse', state: 'warn',
  title: 'An invented local check', why: 'An unrelated local observation.', link: '/sources'};

function dashboard(settings = defaultSettings()): DashboardSnapshot {
  const view = getSampleDashboard(settings);
  view.shopify = {mode: 'live', needs: [issue], checks: [], stock: [], detail: {},
    live: {lastOrder: '', dispatch: '', carts: ''}};
  view.adSets = undefined;
  view.creatives = undefined;
  view.sourceHealth = [];
  view.issuesRead = {ok: true, checkedAt: now.toISOString()};
  return view;
}
function input(view: DashboardSnapshot, settings = defaultSettings()) {
  return morningInputFromDashboard(view, settings, tickerState([], [], now, 'live'), 'live');
}
function hidden(card: MorningCard): MorningState {
  return {mode: 'live', cardKey: card.key, state: 'hidden', untilDay: null, answer: null,
    factsHash: card.factsHash, credentialId: 'invented-device', pressedAt: now.toISOString(), clearedAt: null,
    title: card.title, kind: card.kind, subjectId: card.subjectId, sourceScope: card.sourceScope};
}

test('Issues has its own read certification and stays a Handover Watch outside the deck and summary', () => {
  const view = dashboard();
  view.sourceHealth = [{source: 'meta', name: 'Meta Ads', stage: 2, requiredKeys: [], mode: 'live', status: 'error',
    lastSuccessAt: now, lastAttemptAt: now, consecutiveFailures: 2, updatedAt: now}];
  view.shopify!.needs.push(unrelated);
  const projected = input(view), result = morningDeck(projected, [], now);
  assert.equal(projected.sourceReadOk['needs:issues'], true);
  assert.equal(projected.sourceReadOk['needs:pulse'], false, 'Issues does not certify other Pulse observations');
  assert.equal(projected.sourceReadAt?.['needs:issues'], now.toISOString());
  const card = result.candidates.find(row => row.subjectId === issue.id)!;
  assert.equal(card.sourceScope, 'needs:issues');
  assert.match(card.sourceLine, /last read 2032-04-07T12:00:00\.000Z/);
  assert.equal(card.state, 'warn');
  assert.deepEqual(result.snapshot.cards, []);
  assert.equal(result.snapshot.watchOnHandover?.[0]?.title, issue.title);
  const summary = morningSummaryPayload(result);
  assert.equal(summary.title, 'All clear this morning');
  assert.equal(summary.body, '');
});

test('an absent Issues trend retains its hidden answer while unavailable, then clears only after a certified read', () => {
  const view = dashboard(), card = morningDeck(input(view), [], now).candidates[0]!;
  const state = hidden(card);
  view.shopify!.needs = [];
  view.issuesRead = {ok: false, checkedAt: now.toISOString()};
  const unavailable = morningDeck(input(view), [state], now);
  assert.deepEqual(unavailable.clearKeys, []);
  assert.deepEqual(unavailable.deleteKeys, []);
  assert.equal(unavailable.snapshot.hidden[0]?.stateRow.cardKey, state.cardKey);

  delete view.issuesRead;
  const missing = morningDeck(input(view), [state], now);
  assert.deepEqual(missing.clearKeys, []);
  assert.equal(missing.snapshot.hidden.length, 1, 'No optional Issues projection is not evidence that a rule cleared');

  view.issuesRead = {ok: true, checkedAt: now.toISOString()};
  const resolved = morningDeck(input(view), [state], now);
  assert.deepEqual(resolved.clearKeys, [state.cardKey]);
  assert.deepEqual(resolved.deleteKeys, []);
  assert.deepEqual(resolved.snapshot.hidden, []);
});

test('a tag map or handover scope change fences Issues and its read certificate without clearing hidden state', () => {
  const settings = defaultSettings();
  const changes: Partial<Settings>[] = [
    {gorgiasIssueTags: [{tag: 'invented_slab', reason: 'scratched slab'}]},
    {gorgiasHandoverViewId: '84001'},
    {gorgiasHandoverTag: 'invented_queue'},
  ];
  for (const change of changes) {
    const view = dashboard(settings);
    view.shopify!.needs.push(unrelated);
    const before = structuredClone(view), state = hidden(morningDeck(input(view, settings), [], now).candidates[0]!);
    const current = {...settings, ...change}, scopes = changedSourceScopes(settings, current);
    const fenced = fenceDashboardScopes(view, scopes);
    assert.equal(fenced.shopify!.needs.some(row => row.id === issue.id), false);
    assert.equal(fenced.shopify!.needs.some(row => row.id === unrelated.id), true);
    assert.equal(fenced.issuesRead, undefined);
    const projected = input(fenced, current);
    assert.equal(projected.sourceReadOk['needs:issues'], false);
    const result = morningDeck(projected, [state], now);
    assert.deepEqual(result.clearKeys, []);
    assert.deepEqual(result.deleteKeys, []);
    assert.equal(result.snapshot.hidden[0]?.stateRow.cardKey, state.cardKey);
    assert.deepEqual(view, before, 'Fencing never mutates the cached snapshot');
  }
});
