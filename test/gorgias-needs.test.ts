import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultSettings} from '../src/settings.js';
import {gorgiasNeeds} from '../src/gorgias/needs.js';
import {gorgiasWeekStart, type GorgiasFacts, type GorgiasTicket} from '../src/gorgias/model.js';
import {morningDeck, type MorningInput, type MorningState} from '../src/morning/model.js';
import {curateMorningSample} from '../src/morning/sample.js';
import {tickerState} from '../src/ticker/model.js';
import {changedSourceScopes, fenceDashboardScopes} from '../src/morning/control-overlay.js';
import {getSampleDashboard} from '../src/sample-dashboard.js';
import {morningInputFromDashboard} from '../src/morning/inputs.js';
import {morningSummaryPayload} from '../src/push/service.js';

const now = new Date('2032-04-07T12:00:00Z');
function ticket(id = '81001'): GorgiasTicket {
  return {id, status: 'open', channel: 'email', tags: ['ai_handover'], inHandover: true, viewId: null,
    createdAt: '2032-04-05T09:00:00Z', updatedAt: now.toISOString(), lastCustomerMessageAt: '2032-04-07T00:00:00Z',
    customer: 'Fern L.', subject: 'Invented slab question'};
}
function facts(tickets = [ticket()]): GorgiasFacts {
  return {mode: 'live', status: 'live', domain: 'invented-helpdesk', checkedAt: now.toISOString(), asOf: now.toISOString(),
    weekStart: gorgiasWeekStart(now), openedThisWeek: tickets.length, closedThisWeek: 0, tickets};
}
function input(source = facts()): MorningInput {
  return {mode: 'live', needs: gorgiasNeeds(source, defaultSettings(), 'live'), checks: [], creativeCards: [],
    settings: defaultSettings(), activity: [], metaActions: [], ticker: tickerState([], [], now, 'live'),
    sourceReadOk: {'needs:gorgias': true}, sourceReadAt: {'needs:gorgias': now.toISOString()}};
}

test('handover raises one Decide only over the configured wait and counts all open tickets', () => {
  assert.deepEqual(gorgiasNeeds(facts(), defaultSettings(), 'live'), []);
  const source = facts([{...ticket(), lastCustomerMessageAt: '2032-04-06T23:59:59Z'}, ticket('81002'),
    {...ticket('81003'), status: 'closed'}, {...ticket('81004'), inHandover: false}]);
  const needs = gorgiasNeeds(source, defaultSettings(), 'live');
  assert.equal(needs.length, 1);
  assert.equal(needs[0]!.state, 'decide');
  assert.equal(needs[0]!.title, 'Reply to 2 customers · oldest 12h');
  assert.equal(needs[0]!.link, '/handover');
  assert.deepEqual(gorgiasNeeds(source, {...defaultSettings(), gorgiasHandoverWaitHours: 13}, 'live'), []);
  assert.match(gorgiasNeeds({...source, status: 'unavailable'}, defaultSettings(), 'live')[0]!.why, /last successful read/);
  assert.equal(JSON.stringify(needs).includes('Fern'), false, 'The need contains counts and waits, not customer labels');
});

test('a customer-service Decide enters Morning, can be put away locally, and keeps its source mode label', () => {
  const source = facts([{...ticket(), lastCustomerMessageAt: null}]), data = input(source);
  const first = morningDeck(data, [], now).snapshot.cards[0]!;
  assert.equal(first.kind, 'need'); assert.equal(first.state, 'decide');
  assert.equal(first.primary.kind, 'link'); assert.equal(first.primary.label, 'Open handover');
  assert.equal(first.sourceLine.includes('sample data'), false);
  const parked: MorningState = {mode: 'live', cardKey: first.key, state: 'parked', untilDay: '2032-04-08',
    factsHash: first.factsHash, answer: null, credentialId: 'invented-device', pressedAt: now.toISOString(), clearedAt: null,
    title: first.title, kind: first.kind, subjectId: first.subjectId, sourceScope: first.sourceScope};
  const after = morningDeck(data, [parked], now).snapshot;
  assert.equal(after.cards.length, 0); assert.equal(after.completed, 1); assert.equal(after.total, 1);
  data.mode = 'sample';
  assert.ok(curateMorningSample(data, now).needs.some(need => need.source === 'gorgias'));
  assert.equal(morningDeck(data, [], now).snapshot.cards[0]!.sourceLine.includes('sample data'), false,
    'Live Gorgias stays labelled live when Shopify uses samples');
  data.needs = gorgiasNeeds({...source, mode: 'sample', status: 'sample'}, data.settings, data.mode);
  assert.match(morningDeck(data, [], now).snapshot.cards[0]!.sourceLine, /sample data/);
  assert.match(morningDeck(data, [], now).snapshot.cards[0]!.title, /^Sample · Reply/, 'Push-summary titles must also identify invented ticket counts');
});

test('a changed handover selection or threshold fences cached needs until the next snapshot', () => {
  const initial = defaultSettings(), source = facts([{...ticket(), lastCustomerMessageAt: null}]);
  for (const changed of [{gorgiasHandoverViewId: '91001'}, {gorgiasHandoverTag: 'invented_queue'}, {gorgiasHandoverWaitHours: 24}]) {
    const scopes = changedSourceScopes(initial, {...initial, ...changed});
    assert.ok(scopes.has('gorgias'));
    const dashboard = getSampleDashboard(initial);
    dashboard.shopify = {mode: 'sample', checks: [], stock: [], needs: gorgiasNeeds(source, initial, 'sample'), live: {lastOrder: '', dispatch: '', carts: ''}, detail: {}};
    assert.equal(fenceDashboardScopes(dashboard, scopes).shopify!.needs.length, 0);
  }
});

test('Morning and its summary include customer service only for live Gorgias or a sample dashboard', () => {
  const settings = defaultSettings();
  for (const dashboardMode of ['sample', 'live'] as const) for (const sourceMode of ['sample', 'live'] as const) {
    const source = {...facts(Array.from({length: 4}, (_, index) => ({...ticket(String(81001 + index)), lastCustomerMessageAt: null}))),
      mode: sourceMode, status: sourceMode};
    const dashboard = getSampleDashboard(settings);
    dashboard.shopify = {mode: dashboardMode, checks: [], stock: [], needs: gorgiasNeeds(source, settings, dashboardMode),
      live: {lastOrder: '', dispatch: '', carts: ''}, detail: {}};
    const data = morningInputFromDashboard(dashboard, settings, tickerState([], [], now, dashboardMode), dashboardMode);
    const result = morningDeck(data, [], now);
    if (dashboardMode === 'sample') assert.ok(curateMorningSample(data, now).needs.some(need => need.source === 'gorgias'));
    const payload = morningSummaryPayload(result), allowed = sourceMode === 'live' || dashboardMode === 'sample';
    assert.equal(result.snapshot.cards.length, allowed ? 1 : 0, `${dashboardMode} dashboard / ${sourceMode} Gorgias`);
    if (allowed) {
      const card = result.snapshot.cards[0]!;
      assert.equal(card.subjectId, 'gorgias-handover'); assert.equal(card.state, 'decide');
      assert.equal(card.sourceLine.includes('sample data'), sourceMode === 'sample');
      assert.equal(card.title.startsWith('Sample · '), sourceMode === 'sample');
      assert.equal(payload.title, `${dashboardMode === 'sample' ? 'Sample · ' : ''}Needs you: 1 item`);
      assert.match(payload.body, /Reply to 4 customers/);
    } else {
      assert.equal(payload.title, 'All clear this morning'); assert.equal(payload.body, '');
      assert.equal(result.candidates.some(card => card.subjectId === 'gorgias-handover'), false);
      data.needs.push({id: 'invented-live-decision', source: 'pulse', state: 'decide', title: 'Review the invented order flow',
        why: 'An invented decision from live observations.', link: '/sources'});
      const mixed = morningDeck(data, [], now), summary = morningSummaryPayload(mixed);
      assert.equal(mixed.snapshot.cards.length, 1);
      assert.equal(summary.title, 'Needs you: 1 item');
      assert.equal(summary.body, '1. Review the invented order flow');
      assert.doesNotMatch(JSON.stringify(summary), /Reply|customer|Sample/);
    }
  }
});
