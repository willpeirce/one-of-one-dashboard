import assert from 'node:assert/strict';
import test from 'node:test';
import { appConfig } from '../src/config.js';
import { dashboardPage } from '../src/dashboard-view.js';
import { decisionsHtml } from '../src/decisions/view.js';
import { morningInputFromDashboard } from '../src/morning/inputs.js';
import { morningDeck } from '../src/morning/model.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { defaultSettings } from '../src/settings.js';
import { applyShopifyDashboard } from '../src/shopify/dashboard.js';
import type { Facts } from '../src/shopify/metrics.js';
import { checksHtml } from '../src/shopify/presentation.js';
import { adsCheckDue, blankObservation, evaluateWatchdogs, type AdsCheckContext, type AdsCheckEntryState } from '../src/shopify/watchdogs.js';
import type { SourceHealth, SourceMode } from '../src/sources.js';
import { tickerState } from '../src/ticker/model.js';
import { sourceHealthPage } from '../src/views.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2026-11-10T09:00:00Z'), settings = defaultSettings();
function facts(at: Date, mode: SourceMode = 'live'): Facts {
  return {mode, sample: mode === 'sample', counts: {}, pendingWebhooks: 0, failedWebhooks: [], notices: [], geoNotice: null,
    noticeDetails: [], records: [], jobs: ['backfill', 'poll', 'sessions', 'inventory', 'reconcile', 'subscriptions'].map(name => ({
      name, state: name === 'backfill' ? {from: '2026-01-01', allOrders: true, ordersDone: true} : {},
      last_success_at: at, failures: 0,
    }))};
}
function hq(overrides: Partial<SourceHealth> = {}): SourceHealth {
  return {source: 'github-hq', name: 'GitHub HQ', stage: 5, requiredKeys: [], mode: 'live', status: 'healthy',
    lastSuccessAt: now, lastAttemptAt: now, consecutiveFailures: 0, updatedAt: now, ...overrides};
}
function checks(at: Date, health: SourceHealth[] = [hq()], context?: AdsCheckContext) {
  return evaluateWatchdogs(facts(at), at, settings, blankObservation(), [], health, context);
}
function check(at: Date, entry: AdsCheckEntryState | null = null, health: SourceHealth[] = [hq()]) {
  return checks(at, health, {entry, now: at}).find(row => row.id === 'ads_check')!;
}

test('Ads check becomes due exactly at 09:00 UK through summer, winter and both clock changes', () => {
  for (const [instant, reportDay] of [
    ['2026-01-12T09:00:00Z', '2026-01-11'], ['2026-07-12T08:00:00Z', '2026-07-11'],
    ['2026-03-29T08:00:00Z', '2026-03-28'], ['2026-10-25T09:00:00Z', '2026-10-24'],
  ]) {
    const due = new Date(instant!), before = new Date(due.getTime() - 1);
    assert.equal(adsCheckDue(before), false, instant);
    assert.equal(adsCheckDue(due), true, instant);
    for (const entry of [null, {day: reportDay!, status: 'unreadable' as const}]) {
      assert.equal(check(before, entry).status, 'pass', 'Neither missing nor unreadable trips before the deadline');
      const overdue = check(due, entry);
      assert.equal(overdue.status, 'tripped');
      assert.equal(overdue.link, '/morning');
      assert.match(overdue.why, new RegExp(reportDay!));
    }
    assert.equal(adsCheckDue(new Date(due.getTime() + 14 * 3_600_000)), true);
  }
  assert.equal(adsCheckDue(new Date('2026-07-12T23:00:00Z')), false, 'UK midnight starts a new morning deadline');
});

test('Ads check needs a live HQ source, and readable needs entries pass just like ok entries', () => {
  for (const health of [[], [hq({mode: 'sample', status: 'waiting_for_keys'})]]) {
    for (const entry of [null, {day: '2026-11-09', status: 'ok' as const}, {day: '2026-11-09', status: 'unreadable' as const}]) {
      const result = check(now, entry, health);
      assert.equal(result.status, 'unknown');
      assert.equal(result.link, '/morning');
      assert.match(result.why, /needs its key/);
    }
  }
  for (const status of ['ok', 'needs'] as const) {
    const result = check(now, {day: '2026-11-09', status});
    assert.equal(result.status, 'pass');
    assert.match(result.why, /readable/);
  }
  assert.equal(check(now, {day: '2026-11-09', status: 'unreadable'}).status, 'tripped');
  assert.equal(checks(now).find(row => row.id === 'ads_check')!.status, 'tripped', 'Absent optional context uses now with no entry');
});

test('Ads check matches yesterday by UK date across month, year and UK midnight boundaries', () => {
  for (const [instant, yesterday] of [
    ['2026-03-01T09:00:00Z', '2026-02-28'], ['2027-01-01T09:00:00Z', '2026-12-31'],
    ['2026-07-01T22:59:00Z', '2026-06-30'], ['2026-10-25T09:00:00Z', '2026-10-24'],
  ]) {
    const at = new Date(instant!);
    assert.equal(check(at, {day: yesterday!, status: 'ok'}).status, 'pass');
    assert.equal(check(at, {day: '2025-12-01', status: 'ok'}).status, 'tripped');
    assert.equal(check(at, {day: instant!.slice(0, 10), status: 'ok'}).status, 'tripped', 'Today is not yesterday’s report');
  }
  const midnight = new Date('2026-07-01T23:00:00Z');
  const result = check(midnight, {day: '2026-06-30', status: 'ok'});
  assert.equal(result.status, 'pass');
  assert.match(result.why, /No stored morning check for 2026-07-01; due at 09:00 UK/);
});

test('the real HQ clock changes only Ads check while Shopify keeps its sample clock', () => {
  const shopifyNow = new Date(appConfig.shopify.sampleNow), sample = facts(shopifyNow, 'sample');
  const evaluate = (context?: AdsCheckContext) => evaluateWatchdogs(sample, shopifyNow, settings, blankObservation(), [], [hq()], context);
  const original = evaluate(), current = evaluate({entry: {day: '2026-11-09', status: 'ok'}, now});
  assert.equal(original.find(row => row.id === 'ads_check')!.status, 'tripped');
  assert.equal(current.find(row => row.id === 'ads_check')!.status, 'pass');
  assert.deepEqual(current.filter(row => row.id !== 'ads_check'), original.filter(row => row.id !== 'ads_check'));
  assert.equal(evaluate({entry: null, now: new Date('2026-11-10T08:59:00Z')}).find(row => row.id === 'ads_check')!.status, 'pass');
});

test('HQ connection failure remains a separate Self-check and does not erase a readable stored report', () => {
  const health = [hq({status: 'error', consecutiveFailures: 2})];
  const result = checks(now, health, {entry: {day: '2026-11-09', status: 'needs'}, now});
  assert.equal(result.find(row => row.id === 'ads_check')!.status, 'pass');
  const self = result.find(row => row.id === 'self')!;
  assert.equal(self.status, 'tripped'); assert.equal(self.link, '/sources'); assert.match(self.why, /GitHub HQ/);
  assert.equal(checks(now, health).find(row => row.id === 'ads_check')!.status, 'tripped', 'A failed read with no stored report is overdue');
});

test('Ads check stays a Pulse Watch on Home and Sources with an app-local Morning link, outside the decision deck', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const snapshot = await applyShopifyDashboard(getSampleDashboard(), db, facts(now), settings, [hq()], now,
    undefined, now, {entry: null, now});
  const model = snapshot.shopify!, need = model.needs.find(row => row.id === 'ads_check')!;
  assert.equal(need.source, 'pulse'); assert.equal(need.state, 'warn'); assert.equal(need.link, '/morning');
  assert.match(decisionsHtml({shopify: model}), /Pulse · Ads check/);
  assert.match(decisionsHtml({shopify: model}), /href="\/morning">Open Morning<\/a>/);
  const input = morningInputFromDashboard(snapshot, settings, tickerState([], [], now, 'live'), 'live');
  const morning = morningDeck(input, [], now), card = morning.candidates.find(row => row.subjectId === 'ads_check')!;
  assert.ok(card); assert.equal(card.tier, 2); assert.equal(card.source, 'pulse'); assert.equal(card.state, 'warn');
  assert.deepEqual(card.primary, {kind: 'link', label: 'Open Morning', href: '/morning'});
  assert.equal(morning.snapshot.cards.some(row => row.key === card.key), false);
  assert.ok(morning.openCards.some(row => row.key === card.key), 'The Watch is still an open candidate');
  assert.equal(morning.snapshot.watchOnHome, morning.openCards.filter(row => row.state === 'warn').length);
  assert.match(checksHtml(model), /△ Watch · Ads check/);
  const sources = sourceHealthPage([hq()], undefined, undefined, undefined, {summary: 'Invented source check', shopify: model, checkedAt: now.toISOString()});
  assert.match(sources, /△ Watch · Ads check/);
  assert.match(sources, new RegExp(`/${model.checks.length} checks passing`));
});

test('unknown Ads check adds no Home need, visible markup or count, but remains listed on Sources', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const at = new Date(appConfig.shopify.sampleNow), health = [hq({mode: 'sample', status: 'waiting_for_keys'})];
  const snapshot = await applyShopifyDashboard(getSampleDashboard(), db, facts(at, 'sample'), settings, health, at,
    undefined, now, {entry: {day: '2026-11-09', status: 'unreadable'}, now});
  const model = snapshot.shopify!;
  assert.equal(model.checks.find(row => row.id === 'ads_check')!.status, 'unknown');
  assert.equal(model.needs.some(row => row.id === 'ads_check'), false);
  const without = structuredClone(snapshot);
  without.shopify!.checks = without.shopify!.checks.filter(row => row.id !== 'ads_check');
  assert.equal(checksHtml(model), checksHtml(without.shopify!));
  assert.equal(decisionsHtml({shopify: model}), decisionsHtml({shopify: without.shopify!}));
  // The inert snapshot retains the unknown row for Sources; every rendered Home byte stays identical.
  const visibleMarkup = (html: string) => html.replace(/<div id="dashboard-state" hidden data-snapshot="[^"]*"><\/div>/, '');
  assert.equal(visibleMarkup(dashboardPage(snapshot)), visibleMarkup(dashboardPage(without)));
  const input = morningInputFromDashboard(snapshot, settings, tickerState([], [], now, 'sample'), 'sample');
  assert.equal(morningDeck(input, [], now).snapshot.fine.some(row => row.id === 'ads_check'), false);
  const sources = sourceHealthPage(health, undefined, undefined, undefined, {summary: 'Invented source check', shopify: model, checkedAt: now.toISOString()});
  assert.match(sources, /○ Unknown · Ads check/);
  assert.match(sources, new RegExp(`/${model.checks.length} checks passing`));
});
