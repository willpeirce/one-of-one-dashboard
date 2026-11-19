import assert from 'node:assert/strict';
import test from 'node:test';
import {dashboardPage} from '../src/dashboard-view.js';
import {handoverCount, handoverFlagHtml, handoverFlagName, handoverFlagParts, handoverFlagState, type HandoverCount} from '../src/gorgias/home-count.js';
import {gorgiasWeekStart, type GorgiasFacts, type GorgiasTicket} from '../src/gorgias/model.js';
import {changedSourceScopes, fenceDashboardScopes} from '../src/morning/control-overlay.js';
import {getSampleDashboard} from '../src/sample-dashboard.js';
import {defaultSettings} from '../src/settings.js';

const now = new Date('2032-04-07T12:00:00Z');
function ticket(id: string, change: Partial<GorgiasTicket> = {}): GorgiasTicket {
  return {id, status: 'open', channel: 'email', tags: ['ai_handover'], inHandover: true, viewId: null, aiIntent: null,
    createdAt: '2032-04-05T09:00:00Z', updatedAt: now.toISOString(), lastCustomerMessageAt: '2032-04-07T00:00:00Z',
    customer: 'Fern L.', subject: 'Invented slab question', ...change};
}
function facts(tickets: GorgiasTicket[], change: Partial<GorgiasFacts> = {}): GorgiasFacts {
  return {mode: 'live', status: 'live', domain: 'invented-helpdesk', checkedAt: now.toISOString(), asOf: now.toISOString(),
    weekStart: gorgiasWeekStart(now), openedThisWeek: tickets.length, closedThisWeek: 0, tickets, ...change};
}
const flag = (html: string): string => html.match(/<a class="handover-flag"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? '';

test('the Home count is every open handover ticket, not the new ones, and carries no ticket', () => {
  const source = facts([ticket('81001'), ticket('81002', {createdAt: '2031-06-01T09:00:00Z', lastCustomerMessageAt: null}),
    ticket('81003', {status: 'closed'}), ticket('81004', {inHandover: false})]);
  const count = handoverCount(source, 'live');
  assert.deepEqual(count, {mode: 'live', current: true, open: 2, checkedAt: now.toISOString()});
  assert.doesNotMatch(JSON.stringify(count), /Fern|Invented|81001|email|ai_handover/);
  assert.deepEqual(handoverCount(source, 'sample'), count, 'A live Gorgias read keeps its own label when Shopify is on sample data');
  assert.equal(handoverCount(facts([]), 'live')!.open, 0, 'A completed read of an empty folder is a real zero');
});

test('Home never shows a count without a completed read, and never a sample count beside live numbers', () => {
  const sample = facts([ticket('91001'), ticket('91002'), ticket('91003'), ticket('91004')], {mode: 'sample', status: 'sample'});
  assert.equal(handoverCount(sample, 'live'), undefined, 'No Gorgias keys on the live dashboard: no number');
  assert.deepEqual(handoverCount(sample, 'sample'), {mode: 'sample', current: true, open: 4, checkedAt: now.toISOString()});
  assert.equal(handoverCount(facts([], {mode: 'sample', status: 'unavailable', checkedAt: null}), 'sample'), undefined);
  assert.equal(handoverCount(facts([], {status: 'pending', checkedAt: null}), 'live'), undefined, 'Keys present, first read pending');
  assert.equal(handoverCount(facts([ticket('81001')], {status: 'unavailable', checkedAt: null}), 'live'), undefined);
  assert.deepEqual(handoverCount(facts([ticket('81001')], {status: 'unavailable'}), 'live'),
    {mode: 'live', current: false, open: 1, checkedAt: now.toISOString()}, 'A failing read keeps the last successful count, marked');
});

test('the flag names its state with an icon and a word, and labels sample data', () => {
  const live: HandoverCount = {mode: 'live', current: true, open: 1234, checkedAt: now.toISOString()};
  assert.equal(handoverFlagState(live), 'decide');
  assert.deepEqual(handoverFlagParts(live), {figure: '◆ 1,234', word: 'handover'});
  assert.equal(handoverFlagName(live), '1,234 open handover tickets');
  assert.equal(handoverFlagName({...live, open: 1}), '1 open handover ticket');
  assert.equal(handoverFlagState({...live, open: 0}), 'good');
  assert.deepEqual(handoverFlagParts({...live, open: 0}), {figure: '✓ 0', word: 'handover'});
  assert.equal(handoverFlagState({...live, current: false}), 'warn');
  assert.equal(handoverFlagParts({...live, open: 0, current: false}).figure, '△ 0', 'A stale zero is not shown as clear');
  assert.match(handoverFlagName({...live, current: false}), /last successful read; the Gorgias read is unavailable$/);
  assert.deepEqual(handoverFlagParts({...live, mode: 'sample', open: 4}), {figure: '◆ 4', word: 'sample handover'});
  assert.equal(handoverFlagName({...live, mode: 'sample', open: 4}), '4 open handover tickets, sample data');
  assert.equal(handoverFlagHtml(undefined), '<a class="handover-flag" href="/handover" data-handover-flag hidden></a>');
  assert.equal(handoverFlagHtml({...live, open: 37}),
    '<a class="handover-flag" href="/handover" data-handover-flag data-state="decide" data-mode="live" aria-label="37 open handover tickets"><span class="hf-figure">◆ 37</span><span class="hf-word"> handover</span></a>');
});

test('Home renders the count beside the market switch as a link to Handover, hidden until there is one', () => {
  const base = getSampleDashboard();
  const hidden = flag(dashboardPage(base));
  assert.equal(hidden, '<a class="handover-flag" href="/handover" data-handover-flag hidden></a>');
  const html = dashboardPage({...base, handover: {mode: 'live', current: true, open: 37, checkedAt: now.toISOString()}});
  const market = html.indexOf('id="market"'), grid = html.indexOf('<div class="four hero-grid">');
  const row = html.slice(market, grid);
  assert.match(row, /<button class="review-flag"[^>]*>[^<]*<\/button>\s*<a class="handover-flag" href="\/handover" data-handover-flag data-state="decide" data-mode="live" aria-label="37 open handover tickets"><span class="hf-figure">◆ 37<\/span><span class="hf-word"> handover<\/span><\/a>\s*<\/div>\s*$/);
  assert.equal((html.match(/class="handover-flag"/g) ?? []).length, 1);
  assert.doesNotMatch(flag(html), /sample/i);
  assert.match(flag(dashboardPage({...base, handover: {mode: 'sample', current: true, open: 4, checkedAt: now.toISOString()}})),
    /data-mode="sample" aria-label="4 open handover tickets, sample data"><span class="hf-figure">◆ 4<\/span><span class="hf-word"> sample handover<\/span>/);
});

test('a changed handover view, tag or wait bar withholds the cached count until the next build', () => {
  const dashboard = {...getSampleDashboard(), handover: {mode: 'live' as const, current: true, open: 37, checkedAt: now.toISOString()}};
  const settings = defaultSettings();
  assert.equal(fenceDashboardScopes(dashboard, changedSourceScopes(settings, settings)).handover?.open, 37);
  for (const change of [{gorgiasHandoverViewId: '700001'}, {gorgiasHandoverTag: 'invented-tag'}, {gorgiasHandoverWaitHours: 13}])
    assert.equal(fenceDashboardScopes(dashboard, changedSourceScopes(settings, {...settings, ...change})).handover, undefined);
  assert.equal(fenceDashboardScopes(dashboard, changedSourceScopes(settings, {...settings, waitingOnDays: 8})).handover?.open, 37);
});
