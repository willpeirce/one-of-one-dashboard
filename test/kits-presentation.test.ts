import assert from 'node:assert/strict';
import test from 'node:test';
import {type KitRow, type KitOrderRow, type KitFacts} from '../src/kits/model.js';
import {sampleKitFacts} from '../src/kits/sample.js';
import {homeKits, kitCard, kitDateLabel, kitLaunchDistance, kitMove, kitSheet, kitStatus, kitStepAside} from '../src/kits/presentation.js';
import {KIT_STEPS} from '../src/kits/presentation-types.js';
import {homeKitsHtml, kitCardHtml, kitFoldedHtml, kitMoveHtml, kitSheetHtml, kitTrackHtml, kitTrackLabel} from '../src/kits/view.js';

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
  assert.deepEqual(tags.map(tag => kitStatus(tag, 2)), [{kind: 'live', label: 'On sale'}, {kind: 'flight', label: 'Safety tests'},
    {kind: 'planned', label: 'Planned'}, {kind: 'proposed', label: 'Proposed'}, {kind: 'optional', label: 'Optional'},
    {kind: 'other', label: 'Awaiting a reply'}]);
  const rows = [...Array.from({length: 5}, (_, index) => kit({id: `box-${index}`, name: `Box ${index}`, status: index % 2 ? 'live' : 'in flight'})),
    ...tags.slice(2).map((status, index) => kit({id: `fold-${index}`, status}))];
  const view = homeKits(facts(rows), 'live', now);
  assert.deepEqual(view.cards.map(row => row.id), ['box-0', 'box-1', 'box-2', 'box-3']);
  assert.deepEqual(view.folded.map(row => row.id), ['box-4', 'fold-0', 'fold-1', 'fold-2', 'fold-3']);
  assert.equal(view.folded[0]!.status.kind, 'flight', 'The fifth active kit keeps its actual status in the folded list');
  assert.match(view.summary!, /^5 on the go · 4 planned/);
  const html = homeKitsHtml(view);
  assert.match(html, /\+5 planned · show/); assert.match(html, /aria-expanded="false"/);
  assert.match(html, /○ Awaiting a reply/); assert.doesNotMatch(html, /kit-status-Awaiting/);
  assert.doesNotMatch(homeKitsHtml(homeKits(facts(rows.slice(0, 2)), 'live', now)), /data-kits-fold/);
});

test('launch countdown uses UK calendar dates across both clock changes and a year end', () => {
  for (const instant of ['2032-03-28T00:30:00Z', '2032-03-28T22:30:00Z'])
    assert.equal(kitCard(kit({launchTarget: '2032-03-29'}), new Date(instant)).distance, '1 day');
  assert.equal(kitCard(kit({launchTarget: '2032-03-29'}), new Date('2032-03-28T23:30:00Z')).distance, '', 'Cards count down only to future UK dates');
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

test('future cards keep day/week distances while unchanged folded rows retain Today', () => {
  for (const [target, expected] of [['2032-04-07', 'Today'], ['2032-04-08', '1 day'],
    ['2032-04-20', '13 days'], ['2032-04-21', '2 wks']] as const) {
    assert.equal(kitLaunchDistance(target, '2032-04-07'), expected);
    const view = homeKits(facts([kit({launchTarget: target}), kit({id: 'box-b', name: 'Box B', status: 'planned', launchTarget: target})]), 'live', now);
    const cardDistance = expected === 'Today' ? '' : expected;
    assert.equal(view.cards[0]!.distance, cardDistance);
    assert.equal(view.folded[0]!.distance, expected);
    if (cardDistance) assert.ok(kitCardHtml(view.cards[0]!).includes(`<strong>${cardDistance}</strong>`));
    else assert.doesNotMatch(kitCardHtml(view.cards[0]!), /<strong>Today<\/strong>/);
    assert.ok(kitFoldedHtml(view.folded[0]!).includes(`<small>${expected}</small>`));
  }
});

test('card countdown prefers a live sellout, then future launch, then the label alone', () => {
  const live = kit({status: 'LIVE now', selloutTarget: '2032-05-26', launchTarget: '2032-04-16', launchLabel: 'Until the next collection'});
  assert.deepEqual([kitCard(live, now).distance, kitCard(live, now).launch], ['7 wks', 'left on sale: Until the next collection']);
  assert.equal(kitCard({...live, launchLabel: null}, now).launch, 'left on sale: 26 May');
  const launch = kit({...live, status: 'in flight', launchLabel: 'The next collection'});
  assert.deepEqual([kitCard(launch, now).distance, kitCard(launch, now).launch], ['9 days', 'to launch: The next collection']);
  assert.equal(kitCard({...launch, launchLabel: null}, now).launch, 'to launch: 16 Apr');
  for (const selloutTarget of [null, '2032-04-06', '2032-04-07']) {
    const card = kitCard({...live, selloutTarget, launchLabel: null}, now);
    assert.equal(card.distance, '9 days'); assert.equal(card.launch, 'to launch: 16 Apr');
  }
  for (const target of [null, '2032-04-06', '2032-04-07']) {
    const card = kitCard({...live, selloutTarget: target, launchTarget: target, launchLabel: 'Available now'}, now);
    assert.equal(card.distance, ''); assert.equal(card.launch, 'Available now');
    assert.equal(kitCard({...live, selloutTarget: target, launchTarget: target, launchLabel: null}, now).launch, '');
  }
  const yearEnd = kitCard({...live, selloutTarget: '2033-01-08', launchLabel: null}, new Date('2032-12-31T23:30:00Z'));
  assert.equal(yearEnd.distance, '8 days'); assert.equal(yearEnd.launch, 'left on sale: 8 Jan 2033');
});

test('owner moves distinguish questions, preserve full action and never show supplier waiting age', () => {
  const action = 'Choose the artwork and confirm which printed sample should be made before the next production slot is booked. ';
  const row = kit({nextAction: action, moveNote: 'Next check Tue 13 Apr', waitingSince: '2032-04-01', with: 'the kit maker'});
  const move = kitMove(row, '2032-04-07')!;
  assert.deepEqual(move, {yours: true, label: '◆ Your move', action, note: 'Next check Tue 13 Apr'});
  for (const nextAction of ['Choose this design?', 'Choose this design?  '])
    assert.equal(kitMove({...row, nextAction}, '2032-04-07')!.label, '◆ Your call');
  assert.equal(kitMove({...row, nextAction: 'Choose this design? Then send the proof.'}, '2032-04-07')!.label, '◆ Your move');
  assert.equal(kitMove({...row, moveNote: null}, '2032-04-07')!.note, null);
  const card = kitCard(row, now), sheet = kitSheet(facts([row]), row.id, now)!;
  assert.deepEqual(card.move, sheet.move); assert.equal(sheet.waiting, null);
  for (const html of [kitCardHtml(card), kitSheetHtml(sheet)]) {
    assert.ok(html.includes(action), 'The complete action is in card and sheet markup');
    assert.ok(html.includes(kitMoveHtml(move)), 'Card and sheet use the same move box');
    assert.doesNotMatch(html, /Waiting 6 days|Waiting on|6d waiting/);
  }
  for (const nextAction of ['', '   ']) {
    const empty = {...row, nextAction};
    assert.equal(kitCard(empty, now).move, null);
    assert.equal(kitSheet(facts([empty]), empty.id, now)!.move, null);
    assert.equal(kitMoveHtml(null), '');
  }
});

test('non-owner moves use calendar waiting days with singular, zero and absent-date fallbacks', () => {
  const row = kit({owner: 'the kit maker', with: 'the kit maker', moveNote: 'Next check tomorrow'});
  for (const [since, note] of [[null, 'Next check tomorrow'], ['2032-04-07', 'Next check tomorrow'],
    ['2032-04-08', 'Next check tomorrow'], ['2032-04-06', 'Waiting 1 day'], ['2032-04-01', 'Waiting 6 days'],
    ['2032-04-02', 'Waiting 5 days']] as const) {
    const change = {...row, waitingSince: since};
    assert.deepEqual(kitMove(change, '2032-04-07'), {yours: false, label: '○ Nothing for you right now', action: row.nextAction, note});
    assert.deepEqual(kitCard(change, now).move, kitSheet(facts([change]), change.id, now)!.move, 'The card and sheet share the same move');
  }
  assert.equal(kitMove({...row, waitingSince: null, moveNote: undefined}, '2032-04-07')!.note, null);
  assert.equal(kitMove({...row, waitingSince: '2032-04-07', moveNote: null}, '2032-04-07')!.note, null);
  assert.equal(kitMove({...row, waitingSince: '2032-04-01', with: ''}, '2032-04-07')!.note, 'Waiting 6 days', 'Move age uses waiting_since without a separate with requirement');
  assert.match(kitMove({...row, waitingSince: '0001-01-01'}, '9999-12-31')!.note!, /^Waiting \d+ days$/, 'Old dates use bounded calendar arithmetic');
  const html = kitCardHtml(kitCard({...row, waitingSince: '2032-04-01'}, now));
  assert.match(html, /Nothing for you right now/); assert.match(html, /Waiting 6 days/);
  assert.doesNotMatch(html, /kit-waiting|6d waiting|alarm|red|danger/);
  for (const instant of ['2032-03-28T23:30:00Z', '2032-10-31T23:30:00Z']) {
    const since = instant.startsWith('2032-03') ? '2032-03-28' : '2032-10-30';
    assert.equal(kitCard({...row, waitingSince: since}, new Date(instant)).move!.note, 'Waiting 1 day', 'Waiting uses UK calendar days through clock changes');
  }
});

test('plain stage words, accessible track and dated aside follow all seven gates', () => {
  assert.deepEqual(KIT_STEPS, ['Choosing the theme', 'Being designed', 'Safety tests', 'Being made', 'Shipping to us', 'On sale', 'Sold out']);
  assert.equal(kitStepAside(kit({nextDate: 'Order due 12 Apr', milestone: 'Other detail'})), 'Order due 12 Apr');
  assert.equal(kitStepAside(kit({nextDate: '📦'.repeat(28)})), '📦'.repeat(28));
  assert.equal(kitStepAside(kit({nextDate: null, milestone: 'x'.repeat(28)})), 'Next: being made', 'A short milestone no longer replaces the next stage');
  assert.equal(kitStepAside(kit({milestone: 'x'.repeat(29)})), 'Next: being made');
  assert.equal(kitStepAside(kit({gate: 6, nextDate: 'Review due 12 Apr'})), '', 'The last stage has no aside even when next_date exists');
  assert.equal(kitTrackLabel(2), 'Stage 3 of 7, Safety tests. Done: Choosing the theme, Being designed. To come: Being made, Shipping to us, On sale, Sold out.');
  assert.match(kitTrackLabel(0), /Done: none/); assert.match(kitTrackLabel(6), /To come: none/);
  const track = kitTrackHtml(2);
  assert.equal((track.match(/<i /g) ?? []).length, 7); assert.match(track, /role="img" aria-label="Stage 3 of 7, Safety tests/);
  assert.equal((track.match(/class="kit-track-done"/g) ?? []).length, 2);
  assert.equal((track.match(/class="kit-track-current"/g) ?? []).length, 1);
  for (const [gate, label] of KIT_STEPS.entries()) {
    const row = kit({gate}), card = kitCard(row, now), html = kitCardHtml(card), sheet = kitSheetHtml(kitSheet(facts([row]), row.id, now)!);
    assert.equal(card.status.label, label); assert.match(html, new RegExp(`◆ ${label}`));
    assert.ok(html.includes(`stage ${gate + 1} of 7`)); assert.ok(kitTrackLabel(gate).includes(label));
    assert.ok(sheet.includes(`${label} <small>now`));
    if (gate < 6) assert.equal(card.stepAside, `Next: ${KIT_STEPS[gate + 1]!.toLowerCase()}`);
  }
});

test('source modes never put sample kits beside live Shopify; missing and first reads stay quiet', () => {
  const sample = sampleKitFacts(now), sampleView = homeKits(sample, 'sample', now);
  assert.equal(sampleView.cards.length, 3); assert.equal(sampleView.folded.length, 3);
  assert.match(homeKitsHtml(sampleView), /Sample data · invented kits/);
  const hidden = homeKits(sample, 'live', now);
  assert.equal(hidden.ready, false); assert.equal(hidden.cards.length + hidden.folded.length, 0);
  assert.match(homeKitsHtml(hidden), /Not set up yet/); assert.doesNotMatch(homeKitsHtml(hidden), /Box [A-F]|Sample data|on the go ·/);
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

test('Kits heading puts its summary under the title with its separate All kits link', () => {
  const view = homeKits(facts(), 'live', now), html = homeKitsHtml(view), heading = html.split('</header>')[0]!;
  assert.equal(view.summary, '1 on the go · 0 planned · updated 13:00');
  assert.match(heading, /chapter-number[^>]*>2<\/span>/);
  assert.match(heading, /chapter-eyebrow">In the making<\/p>/);
  const copy = heading.split('<div class="chapter-copy">')[1]!.split('</div>')[0]!;
  assert.ok(copy.indexOf('id="kits-title">Kits') < copy.indexOf(view.summary!));
  assert.match(copy, /class="shm kits-summary"/);
  assert.match(heading, /href="\/kits" data-kits-all>All kits ›<\/a>/);
  assert.equal((heading.match(/data-kits-all/g) ?? []).length, 1);
});

test('an older row without the optional fields retains plain fallbacks and its stored wording', () => {
  const row = kit({nextAction: 'Approve the printed sample', milestone: 'Existing checkpoint'});
  assert.ok(!Object.hasOwn(row, 'selloutTarget') && !Object.hasOwn(row, 'nextDate') && !Object.hasOwn(row, 'moveNote'));
  const card = kitCard(row, now), sheet = kitSheet(facts([row]), row.id, now)!;
  assert.equal(card.launch, 'to launch: 30 Jun'); assert.equal(card.distance, '12 wks');
  assert.equal(card.stepAside, 'Next: being made');
  assert.equal(card.move!.action, 'Approve the printed sample'); assert.equal(card.move!.note, null);
  assert.equal(sheet.nextDate, null); assert.equal(sheet.milestone, 'Existing checkpoint');
  assert.ok(kitCardHtml(card).includes('Approve the printed sample'));
  assert.ok(kitSheetHtml(sheet).includes('Existing checkpoint'));
});

test('sheet blocks show move, stages, next date then milestone, waiting and note before unchanged orders', () => {
  const source = sampleKitFacts(now), row = source.kits.rows[1]!;
  Object.assign(row, {owner: 'the kit maker', nextAction: 'The kit maker is checking the proof.',
    nextDate: 'Proof due 12 Apr', milestone: 'Printed proof ready', note: 'Keep the chosen colours.',
    waitingSince: '2032-04-06', with: 'the kit maker', briefDue: '2032-04-18'});
  const sheet = kitSheet(source, row.id, now)!, html = kitSheetHtml(sheet);
  const inOrder = [kitMoveHtml(sheet.move), '<ol class="kit-checklist">', '<h4>Dates</h4>', 'Proof due 12 Apr',
    'Printed proof ready', '<h4>Waiting on</h4>', 'the kit maker · 1 day', '<h4>Note</h4>', 'Keep the chosen colours.', 'On order · 3 of 5'];
  let previous = -1;
  for (const text of inOrder) {
    const position = html.indexOf(text, previous + 1);
    assert.ok(position > previous, `Sheet block follows the previous block: ${text}`);
    previous = position;
  }
  assert.equal(html.split('<h4>Dates</h4>')[1]!.split('</section>')[0], '<p>Proof due 12 Apr</p><p>Printed proof ready</p>');
  assert.doesNotMatch(html, /Brief due/);
  const empty = kitSheet(facts([kit({nextAction: '', nextDate: null, milestone: null})]), 'box-a', now)!;
  assert.doesNotMatch(kitSheetHtml(empty), /Your move|Nothing for you|<h4>Dates<|<h4>Waiting on<|<h4>Note</);
});

test('kit sheets match order names case-insensitively, show three before more, keep full text and omit suppliers on Home', () => {
  const source = sampleKitFacts(now);
  source.orders.rows[0]!.kit = '  BOX b  ';
  source.kits.rows[1]!.nextAction = 'An invented action '.repeat(9);
  const sheet = kitSheet(source, 'box-b', now)!;
  assert.equal(sheet.orders.length, 5);
  assert.deepEqual(sheet.orders.map(row => row.id), source.orders.rows.slice(0, 5).map(row => row.id));
  assert.equal(sheet.orders[1]!.quantity, '2,400'); assert.equal(sheet.waiting?.days, 6);
  assert.equal(sheet.move!.action, source.kits.rows[1]!.nextAction);
  assert.doesNotMatch(JSON.stringify(sheet), /supplier/);
  const html = kitSheetHtml(sheet);
  assert.match(html, /On order · 3 of 5/); assert.match(html, /\+2 more/);
  assert.equal((html.split('data-kit-orders-toggle')[0]!.match(/data-kit-order>/g) ?? []).length, 3);
  assert.match(html, /id="kit-orders-rest" data-kit-orders-rest hidden/);
  assert.equal((html.match(/<li class="kit-step-now"/g) ?? []).length, 1);
  assert.match(html, /Safety tests <small>now/); assert.match(html, /Choosing the theme <small>done/); assert.match(html, /Shipping to us <small>to come/);
  assert.equal(kitSheet(source, 'box-missing', now), null);
  const extended = kitSheet(source, 'box-b', now, {suppliers: true})!;
  assert.equal(extended.orders[0]!.supplier, 'a supplier');
  assert.match(kitSheetHtml(extended), /a supplier/);
});

test('kit titles, actions, notes and unknown state words remain text, not markup, classes or executable attributes', () => {
  const attack = '<script>alert("invented")</script>', source = facts([kit({name: attack, nextAction: attack, note: attack,
    launchLabel: attack, series: attack, owner: attack, with: attack, waitingSince: '2032-04-01', milestone: attack,
    nextDate: attack, moveNote: attack})]);
  const chapter = homeKitsHtml(homeKits(source, 'live', now)), sheet = kitSheetHtml(kitSheet(source, 'box-a', now)!);
  for (const html of [chapter, sheet]) {
    assert.doesNotMatch(html.replace('href="/kits"', ''), /<script|style=|onclick=|href=/);
    assert.match(html, /&lt;script&gt;alert\(&quot;invented&quot;\)&lt;\/script&gt;/);
  }
  const noteMove = kitMove(kit({moveNote: attack}), '2032-04-07');
  assert.match(kitMoveHtml(noteMove), /<small class="kit-move-note">&lt;script&gt;alert\(&quot;invented&quot;\)&lt;\/script&gt;<\/small>/);
  assert.doesNotMatch(kitMoveHtml(noteMove), /<script/);
  source.kits.rows[0]!.status = attack;
  const unknown = homeKitsHtml(homeKits(source, 'live', now));
  assert.match(unknown, /kit-status-other">○ &lt;script/);
  assert.doesNotMatch(unknown, /class="[^\"]*<script/);
});

test('the Home projection stays below 40 KB with forty maximum Unicode rows and two hundred full orders', () => {
  const unicode = (length: number) => '📦'.repeat(length);
  const rows = Array.from({length: 40}, (_, index) => kit({id: `box-${index}-${'x'.repeat(30)}`, name: unicode(40), series: unicode(80),
    status: index < 4 ? 'in flight' : unicode(30), launchLabel: unicode(60), nextAction: unicode(200), owner: unicode(20),
    with: unicode(120), waitingSince: null, note: unicode(300), milestone: unicode(120),
    nextDate: unicode(28), moveNote: unicode(60), selloutTarget: '2032-07-01'}));
  const source = facts(rows);
  source.orders.rows = Array.from({length: 200}, (_, index): KitOrderRow => ({id: `order-${index}`, kit: unicode(40),
    supplier: unicode(80), item: unicode(160), qty: 10_000_000, status: unicode(160), date: '2032-04-01', eta: '2032-04-21'}));
  const view = homeKits(source, 'live', now), bytes = Buffer.byteLength(JSON.stringify(view));
  assert.equal(view.cards.length, 4); assert.equal(view.folded.length, 36);
  assert.ok(bytes < 40 * 1024, `Home Kits snapshot is ${bytes} bytes`);
  assert.ok(Buffer.byteLength(JSON.stringify(source)) > 40 * 1024, 'The fixture would violate the cap without projection');
  assert.doesNotMatch(JSON.stringify(view), /"orders"|"supplier"|"with"/);
  assert.equal(view.cards[0]!.move!.note, unicode(60), 'The bound includes the maximum move note');
  assert.ok(!JSON.stringify(view).includes(unicode(300)), 'Full kit notes remain sheet-only');
});

test('sheet keeps a non-owner waiting contact without inventing an age when its date is absent', () => {
  const row = kit({owner: 'the kit maker', with: 'the kit maker', waitingSince: null});
  const sheet = kitSheet(facts([row]), row.id, now)!;
  assert.deepEqual(sheet.waiting, {with: 'the kit maker', days: null});
  assert.match(kitSheetHtml(sheet), /<h4>Waiting on<\/h4><p>the kit maker<\/p>/);
  row.owner = 'Will';
  assert.equal(kitSheet(facts([row]), row.id, now)!.waiting, null);
});
