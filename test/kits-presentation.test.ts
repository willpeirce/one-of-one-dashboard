import assert from 'node:assert/strict';
import test from 'node:test';
import {type KitRow, type KitOrderRow, type KitFacts} from '../src/kits/model.js';
import {sampleKitFacts} from '../src/kits/sample.js';
import {homeKits, kitCard, kitDateLabel, kitLaunchDistance, kitSheet, kitStatus, kitStepAside, kitWaitingChip, kitWorkingDays} from '../src/kits/presentation.js';
import {homeKitsHtml, kitCardHtml, kitSheetHtml, kitTrackHtml, kitTrackLabel} from '../src/kits/view.js';

const now = new Date('2032-04-07T12:00:00Z');
const kit = (change: Partial<KitRow> = {}): KitRow => ({id: 'box-a', name: 'Box A', series: 'Invented collection', status: 'in flight',
  gate: 2, launchTarget: '2032-06-30', launchLabel: null, briefDue: null, milestone: null,
  nextAction: 'Check the sample', owner: 'Will', with: '', waitingSince: null, note: '', ...change});
function facts(rows: KitRow[] = [kit()]): KitFacts {
  return {mode: 'live', kits: {status: 'ready', updatedAt: now.toISOString(), readAt: now.toISOString(), skippedRows: 0, cappedRows: 0, rows},
    orders: {status: 'ready', updatedAt: null, readAt: now.toISOString(), skippedRows: 0, cappedRows: 0, rows: []}};
}

test('kit status prefixes keep known words and unknown tags neutral; four active cards is the only card cap', () => {
  const tags = ['LiVe now', 'IN FLIGHT · proof', 'planned later', 'Proposed option', 'Optional idea', 'Awaiting a reply'];
  assert.deepEqual(tags.map(kitStatus), [{kind: 'live', label: 'Live'}, {kind: 'flight', label: 'In flight'},
    {kind: 'planned', label: 'Planned'}, {kind: 'proposed', label: 'Proposed'}, {kind: 'optional', label: 'Optional'},
    {kind: 'other', label: 'Awaiting a reply'}]);
  const rows = [...Array.from({length: 5}, (_, index) => kit({id: `box-${index}`, name: `Box ${index}`, status: index % 2 ? 'live' : 'in flight'})),
    ...tags.slice(2).map((status, index) => kit({id: `fold-${index}`, status}))];
  const view = homeKits(facts(rows), 'live', now);
  assert.deepEqual(view.cards.map(row => row.id), ['box-0', 'box-1', 'box-2', 'box-3']);
  assert.deepEqual(view.folded.map(row => row.id), ['box-4', 'fold-0', 'fold-1', 'fold-2', 'fold-3']);
  assert.equal(view.folded[0]!.status.kind, 'flight', 'The fifth active kit keeps its actual status in the folded list');
  assert.match(view.summary!, /^5 active · 4 planned/);
  const html = homeKitsHtml(view);
  assert.match(html, /\+5 planned · show/); assert.match(html, /aria-expanded="false"/);
  assert.match(html, /○ Awaiting a reply/); assert.doesNotMatch(html, /kit-status-Awaiting/);
  assert.doesNotMatch(homeKitsHtml(homeKits(facts(rows.slice(0, 2)), 'live', now)), /data-kits-fold/);
});

test('launch countdown uses UK calendar dates across both clock changes and a year end', () => {
  for (const instant of ['2032-03-28T00:30:00Z', '2032-03-28T22:30:00Z'])
    assert.equal(kitCard(kit({launchTarget: '2032-03-29'}), new Date(instant)).distance, '1 day');
  assert.equal(kitCard(kit({launchTarget: '2032-03-29'}), new Date('2032-03-28T23:30:00Z')).distance, '0 days');
  for (const instant of ['2032-10-31T00:30:00Z', '2032-10-31T23:30:00Z'])
    assert.equal(kitCard(kit({launchTarget: '2032-11-01'}), new Date(instant)).distance, '1 day');
  assert.equal(kitCard(kit({launchTarget: '2033-01-01'}), new Date('2032-12-31T23:30:00Z')).distance, '1 day');
  assert.equal(kitDateLabel('2033-01-01', '2032-12-31'), '1 Jan 2033');
  assert.equal(kitDateLabel('2032-04-14', '2032-04-07'), '14 Apr');
  assert.equal(kitLaunchDistance('2032-04-20', '2032-04-07'), '13 days');
  assert.equal(kitLaunchDistance('2032-04-21', '2032-04-07'), '2 wks');
  assert.equal(kitLaunchDistance('2032-04-25', '2032-04-07'), '3 wks');
  assert.equal(kitLaunchDistance('2032-04-06', '2032-04-07'), '');
  assert.equal(kitLaunchDistance(null, '2032-04-07'), '');
});

test('waiting needs three working days, excludes weekends and never becomes a failure colour', () => {
  assert.equal(kitWorkingDays('2032-04-05', '2032-04-07'), 2);
  assert.equal(kitWorkingDays('2032-04-05', '2032-04-08'), 3);
  assert.equal(kitWorkingDays('2032-04-02', '2032-04-06'), 2, 'Friday through Tuesday');
  assert.equal(kitWorkingDays('2032-04-02', '2032-04-07'), 3);
  assert.equal(kitWorkingDays('2032-04-07', '2032-04-06'), 0);
  assert.ok(kitWorkingDays('0001-01-01', '9999-12-31') > 2_000_000, 'Old valid dates stay bounded');
  const row = kit({with: 'the kit maker', waitingSince: '2032-04-05'});
  assert.equal(kitWaitingChip(row, '2032-04-07'), null);
  assert.equal(kitWaitingChip(row, '2032-04-08'), '3d waiting');
  assert.equal(kitWaitingChip({...row, waitingSince: '2032-04-02'}, '2032-04-07'), '5d waiting');
  assert.equal(kitWaitingChip({...row, with: ''}, '2032-04-08'), null);
  assert.equal(kitWaitingChip({...row, waitingSince: null}, '2032-04-08'), null);
  const html = kitCardHtml(kitCard({...row, waitingSince: '2032-04-01'}, now));
  assert.match(html, /kit-waiting">△ 6d waiting/); assert.doesNotMatch(html, /alarm|red|danger/);
});

test('step words, accessible track and milestone boundary follow all seven gates', () => {
  assert.equal(kitStepAside(kit({milestone: 'x'.repeat(28)})), 'x'.repeat(28));
  assert.equal(kitStepAside(kit({milestone: 'x'.repeat(29)})), 'Manufacture next');
  assert.equal(kitStepAside(kit({milestone: '📦'.repeat(28)})), '📦'.repeat(28), 'Character limits count code points');
  assert.equal(kitStepAside(kit({gate: 6, milestone: null})), '');
  assert.equal(kitTrackLabel(2), 'Step 3 of 7, Compliance. Done: Theme, Design. To come: Manufacture, Inbound, Launch, Review.');
  assert.match(kitTrackLabel(0), /Done: none/); assert.match(kitTrackLabel(6), /To come: none/);
  const track = kitTrackHtml(2);
  assert.equal((track.match(/<i /g) ?? []).length, 7); assert.match(track, /role="img" aria-label="Step 3 of 7, Compliance/);
  assert.equal((track.match(/class="kit-track-done"/g) ?? []).length, 2);
  assert.equal((track.match(/class="kit-track-current"/g) ?? []).length, 1);
  assert.match(kitCardHtml(kitCard(kit(), now)), /<strong>Compliance<\/strong> <span class="kit-step-count">step 3 of 7/);
});

test('source modes never put sample kits beside live Shopify; missing and first reads stay quiet', () => {
  const sample = sampleKitFacts(now), sampleView = homeKits(sample, 'sample', now);
  assert.equal(sampleView.cards.length, 3); assert.equal(sampleView.folded.length, 3);
  assert.match(homeKitsHtml(sampleView), /Sample data · invented kits/);
  const hidden = homeKits(sample, 'live', now);
  assert.equal(hidden.ready, false); assert.equal(hidden.cards.length + hidden.folded.length, 0);
  assert.match(homeKitsHtml(hidden), /Not set up yet/); assert.doesNotMatch(homeKitsHtml(hidden), /Box [A-F]|Sample data|active ·/);
  assert.deepEqual(homeKits(facts(), 'sample', now), homeKits(facts(), 'live', now), 'Live HQ remains live on sample Shopify');
  for (const status of ['missing', 'pending'] as const) {
    const source = facts(); source.kits.status = status; source.kits.rows = []; source.kits.readAt = status === 'missing' ? now.toISOString() : null;
    const html = homeKitsHtml(homeKits(source, 'live', now));
    assert.match(html, /Not set up yet/); assert.doesNotMatch(html, /data-kit-open/);
  }
  assert.match(homeKitsHtml(), /In the making[\s\S]*Kits[\s\S]*Not set up yet/);
});

test('summary uses UK updated time, yesterday includes its date, absent updated uses checked and old data is Watch', () => {
  const source = facts();
  assert.match(homeKits(source, 'live', now).summary!, /updated 13:00$/);
  source.kits.updatedAt = '2032-04-06T12:00:00Z';
  assert.match(homeKits(source, 'live', now).summary!, /updated 6 Apr 13:00$/);
  assert.equal(homeKits(source, 'live', now).stale, false);
  source.kits.updatedAt = '2032-04-06T00:00:00Z';
  assert.equal(homeKits(source, 'live', now).stale, false, 'Exactly 36 hours is not more than 36 hours');
  source.kits.updatedAt = '2032-04-05T23:59:59Z';
  assert.match(homeKitsHtml(homeKits(source, 'live', now)), /△ stale/);
  source.kits.updatedAt = null;
  assert.match(homeKits(source, 'live', now).summary!, /checked 13:00$/);
  source.kits.status = 'unavailable';
  const retained = homeKits(source, 'live', now);
  assert.equal(retained.cards.length, 1); assert.match(homeKitsHtml(retained), /△ Last saved kits · source unavailable/);
});

test('kit sheets match order names case-insensitively, show three before more, keep full text and omit suppliers on Home', () => {
  const source = sampleKitFacts(now);
  source.orders.rows[0]!.kit = '  BOX b  ';
  source.kits.rows[1]!.nextAction = 'An invented action '.repeat(9);
  const sheet = kitSheet(source, 'box-b', now)!;
  assert.equal(sheet.orders.length, 5);
  assert.deepEqual(sheet.orders.map(row => row.id), source.orders.rows.slice(0, 5).map(row => row.id));
  assert.equal(sheet.orders[1]!.quantity, '2,400'); assert.equal(sheet.waiting?.days, 6);
  assert.equal(sheet.nextAction, source.kits.rows[1]!.nextAction);
  assert.doesNotMatch(JSON.stringify(sheet), /supplier/);
  const html = kitSheetHtml(sheet);
  assert.match(html, /On order · 3 of 5/); assert.match(html, /\+2 more/);
  assert.equal((html.split('data-kit-orders-toggle')[0]!.match(/data-kit-order>/g) ?? []).length, 3);
  assert.match(html, /id="kit-orders-rest" data-kit-orders-rest hidden/);
  assert.equal((html.match(/<li class="kit-step-now"/g) ?? []).length, 1);
  assert.match(html, /Compliance <small>now/); assert.match(html, /Theme <small>done/); assert.match(html, /Inbound <small>to come/);
  assert.equal(kitSheet(source, 'box-missing', now), null);
  const extended = kitSheet(source, 'box-b', now, {suppliers: true})!;
  assert.equal(extended.orders[0]!.supplier, 'a supplier');
  assert.match(kitSheetHtml(extended), /a supplier/);
});

test('kit titles, actions, notes and unknown state words remain text, not markup, classes or executable attributes', () => {
  const attack = '<script>alert("invented")</script>', source = facts([kit({name: attack, nextAction: attack, note: attack,
    launchLabel: attack, series: attack, owner: attack, with: attack, waitingSince: '2032-04-01', milestone: attack})]);
  const chapter = homeKitsHtml(homeKits(source, 'live', now)), sheet = kitSheetHtml(kitSheet(source, 'box-a', now)!);
  for (const html of [chapter, sheet]) {
    assert.doesNotMatch(html.replace('href="/kits"', ''), /<script|style=|onclick=|href=/);
    assert.match(html, /&lt;script&gt;alert\(&quot;invented&quot;\)&lt;\/script&gt;/);
  }
  source.kits.rows[0]!.status = attack;
  const unknown = homeKitsHtml(homeKits(source, 'live', now));
  assert.match(unknown, /kit-status-other">○ &lt;script/);
  assert.doesNotMatch(unknown, /class="[^\"]*<script/);
});

test('the Home projection stays below 40 KB with forty maximum Unicode rows and two hundred full orders', () => {
  const unicode = (length: number) => '📦'.repeat(length);
  const rows = Array.from({length: 40}, (_, index) => kit({id: `box-${index}-${'x'.repeat(30)}`, name: unicode(40), series: unicode(80),
    status: index < 4 ? 'in flight' : unicode(30), launchLabel: unicode(60), nextAction: unicode(200), owner: unicode(20),
    with: unicode(120), waitingSince: '2032-04-01', note: unicode(300), milestone: unicode(120)}));
  const source = facts(rows);
  source.orders.rows = Array.from({length: 200}, (_, index): KitOrderRow => ({id: `order-${index}`, kit: unicode(40),
    supplier: unicode(80), item: unicode(160), qty: 10_000_000, status: unicode(160), date: '2032-04-01', eta: '2032-04-21'}));
  const view = homeKits(source, 'live', now), bytes = Buffer.byteLength(JSON.stringify(view));
  assert.equal(view.cards.length, 4); assert.equal(view.folded.length, 36);
  assert.ok(bytes < 40 * 1024, `Home Kits snapshot is ${bytes} bytes`);
  assert.ok(Buffer.byteLength(JSON.stringify(source)) > 40 * 1024, 'The fixture would violate the cap without projection');
  assert.doesNotMatch(JSON.stringify(view), /"orders"|"note"|"supplier"|"with"/);
});
