import assert from 'node:assert/strict';
import test from 'node:test';
import {KIT_TIMELINE_TICK_LIMIT, kitOrderGroups, kitTimeline, kitsPageView} from '../src/kits/page-model.js';
import {homeKits, kitCard, kitOrder} from '../src/kits/presentation.js';
import {sampleKitFacts} from '../src/kits/sample.js';
import type {KitFacts, KitOrderRow, KitRow} from '../src/kits/model.js';

const now = new Date('2032-04-07T12:00:00Z');
const kit = (change: Partial<KitRow> = {}): KitRow => ({id: 'box-a', name: 'Box A', series: 'Invented collection', status: 'in flight', gate: 2,
  launchTarget: '2032-06-30', launchLabel: null, briefDue: null, milestone: null, nextAction: 'Check the sample', owner: 'Will',
  with: '', waitingSince: null, note: '', ...change});
const order = (id: string, name: string): KitOrderRow => ({id, kit: name, supplier: 'a supplier', item: 'Invented cartons', qty: 2400,
  date: '2032-04-01', eta: '2032-04-21', status: 'In production'});
function facts(rows: KitRow[] = [kit()], orders: KitOrderRow[] = []): KitFacts {
  return {mode: 'live', kits: {status: 'ready', updatedAt: now.toISOString(), readAt: now.toISOString(), skippedRows: 0, cappedRows: 0, rows},
    orders: {status: 'ready', updatedAt: null, readAt: now.toISOString(), skippedRows: 0, cappedRows: 0, rows: orders}};
}

test('timeline spans the current UK month through the latest launch month and preserves kit file order and exact dates', () => {
  const rows = [kit({id: 'box-b', name: 'Box B', launchTarget: '2032-07-09', briefDue: '2032-05-01'}),
    kit({id: 'box-a', launchTarget: '2032-06-30'}), kit({id: 'box-c', name: 'Box C', launchTarget: null})];
  const timeline = kitTimeline(rows, now);
  assert.equal(timeline.start, '2032-04-01'); assert.equal(timeline.end, '2032-07-31'); assert.equal(timeline.today, '2032-04-07');
  assert.deepEqual(timeline.ticks.map(tick => tick.date), ['2032-04-01', '2032-05-01', '2032-06-01', '2032-07-01']);
  assert.deepEqual(timeline.ticks.map(tick => tick.label), ['Apr', 'May', 'Jun', 'Jul']);
  assert.deepEqual(timeline.ticks.map(tick => tick.year), ['2032', null, null, null]);
  assert.deepEqual(timeline.kits.map(row => row.id), ['box-b', 'box-a', 'box-c']);
  assert.equal(timeline.kits[0]!.launch!.label, '9 Jul 2032'); assert.equal(timeline.kits[0]!.brief!.label, '1 May 2032');
  assert.equal(timeline.kits[2]!.launch, null); assert.equal(timeline.kits[2]!.brief, null);
  assert.ok(timeline.todayPosition > 0 && timeline.todayPosition < timeline.kits[0]!.brief!.position);
  assert.ok(timeline.kits[1]!.launch!.position < timeline.kits[0]!.launch!.position);
  assert.equal(timeline.monthCount, 4); assert.equal(timeline.compressed, false);
});

test('past and undated launches keep at least this month; out-of-range dates are explicitly flagged for edge arrows', () => {
  for (const rows of [[], [kit({launchTarget: null})], [kit({launchTarget: '2032-03-09'})]]) {
    const timeline = kitTimeline(rows, now);
    assert.equal(timeline.start, '2032-04-01'); assert.equal(timeline.end, '2032-04-30'); assert.equal(timeline.monthCount, 1);
  }
  const timeline = kitTimeline([kit({launchTarget: '2032-03-09', briefDue: '2032-05-01'}), kit({id: 'box-b', launchTarget: null,
    briefDue: '2032-04-09'})], now);
  assert.deepEqual(timeline.kits[0]!.launch, {date: '2032-03-09', label: '9 Mar 2032', position: 0, outside: 'before'});
  assert.deepEqual(timeline.kits[0]!.brief, {date: '2032-05-01', label: '1 May 2032', position: 100, outside: 'after'});
  assert.equal(timeline.kits[1]!.launch, null); assert.equal(timeline.kits[1]!.brief!.outside, null);
});

test('month bounds and day positions follow UK dates through both clock changes and across years', () => {
  const spring = kitTimeline([kit({launchTarget: '2032-04-30'})], new Date('2032-03-31T23:30:00Z'));
  assert.equal(spring.start, '2032-04-01'); assert.equal(spring.todayPosition, 0);
  const autumn = kitTimeline([kit({launchTarget: '2032-11-30'})], new Date('2032-10-31T23:30:00Z'));
  assert.equal(autumn.start, '2032-10-01'); assert.equal(autumn.today, '2032-10-31');
  const year = kitTimeline([kit({launchTarget: '2033-02-03'})], new Date('2032-12-31T23:30:00Z'));
  assert.equal(year.end, '2033-02-28'); assert.deepEqual(year.ticks.map(tick => tick.year), ['2032', '2033', null]);
  assert.equal(kitTimeline([kit({launchTarget: '2032-02-10'})], new Date('2032-02-01T12:00:00Z')).end, '2032-02-29');
  assert.equal(kitTimeline([kit({launchTarget: '2100-02-10'})], new Date('2100-02-01T12:00:00Z')).end, '2100-02-28');
  const clock = kitTimeline([kit({launchTarget: '2032-04-01', briefDue: '2032-03-28'})], new Date('2032-03-01T12:00:00Z'));
  assert.equal(clock.kits[0]!.brief!.position, 27 / 60 * 100, 'Positions count calendar days, not hours lost at the clock change');
});

test('all ordinary month ticks are retained; extreme valid dates keep the full range with bounded ticks and year labels', () => {
  const ordinary = kitTimeline([kit({launchTarget: '2042-03-31'})], now);
  assert.equal(ordinary.monthCount, 120); assert.equal(ordinary.ticks.length, 120); assert.equal(ordinary.compressed, false);
  const long = kitTimeline([kit({launchTarget: '9999-12-31', briefDue: '0001-01-01'})], now);
  assert.equal(long.start, '2032-04-01'); assert.equal(long.end, '9999-12-31'); assert.equal(long.compressed, true);
  assert.ok(long.ticks.length <= KIT_TIMELINE_TICK_LIMIT); assert.ok(long.ticks.filter(tick => tick.year).length <= KIT_TIMELINE_TICK_LIMIT);
  assert.equal(long.ticks[0]!.date, '2032-04-01'); assert.equal(long.ticks.at(-1)!.date, '9999-12-01');
  assert.equal(long.kits[0]!.launch!.position, 100); assert.equal(long.kits[0]!.brief!.date, '0001-01-01');
  assert.equal(long.kits[0]!.brief!.label, '1 Jan 1'); assert.equal(long.kits[0]!.brief!.outside, 'before');
  assert.ok(long.ticks.every(tick => Number.isFinite(tick.position) && tick.position >= 0 && tick.position <= 100));
  const early = kitTimeline([kit({launchTarget: '0099-02-10'})], new Date('0099-02-01T12:00:00Z'));
  assert.equal(early.start, '0099-02-01'); assert.equal(early.end, '0099-02-28'); assert.equal(early.ticks[0]!.date, '0099-02-01');
});

test('every kit gets the existing card projection, including all folded Home kits, without changing their component data', () => {
  const source = sampleKitFacts(now), home = homeKits(source, 'sample', now), page = kitsPageView(source, 'sample', now);
  assert.equal(page.cards.length, 6); assert.equal(home.cards.length, 3); assert.equal(home.folded.length, 3);
  assert.deepEqual(page.cards, source.kits.rows.map(row => kitCard(row, now)));
  assert.deepEqual(page.cards.slice(0, 3), home.cards);
  assert.equal(page.summary, home.summary); assert.equal(page.stale, home.stale); assert.equal(page.notice, home.notice);
  assert.equal(page.cards[5]!.distance, ''); assert.equal(page.timeline!.kits[5]!.launch, null);
});

test('order groups follow kit file order, match names ignoring case, preserve order row order, include suppliers and put Other last', () => {
  const source = facts([kit(), kit({id: 'box-b', name: 'Box B'}), kit({id: 'box-c', name: 'Box C'})],
    [order('order-1', 'Unmatched'), order('order-2', ' BOX B '), order('order-3', 'box a'), order('order-4', 'Box B'),
      order('order-5', 'Other unmatched'), order('order-6', 'BOX A')]);
  const groups = kitOrderGroups(source, now);
  assert.deepEqual(groups.map(group => group.name), ['Box A', 'Box B', 'Other']);
  assert.deepEqual(groups.map(group => group.orders.map(row => row.id)), [['order-3', 'order-6'], ['order-2', 'order-4'], ['order-1', 'order-5']]);
  assert.deepEqual(groups[0]!.orders[0], kitOrder(source.orders.rows[2]!, now, true));
  assert.equal(groups[0]!.orders[0]!.quantity, '2,400'); assert.equal(groups[0]!.orders[0]!.supplier, 'a supplier');
  const duplicateNames = facts([kit(), kit({id: 'box-b', name: ' BOX A '})], [order('order-1', 'box a')]);
  assert.equal(kitOrderGroups(duplicateNames, now).length, 1, 'An order is never duplicated when two kit rows share a name');
  assert.equal(kitOrderGroups(duplicateNames, now)[0]!.id, 'kit:box-a', 'The first matching kit name wins');
});

test('the page respects the shared source boundary while orders remain independently available when the kits file is missing', () => {
  const sample = sampleKitFacts(now), suppressed = kitsPageView(sample, 'live', now);
  assert.equal(suppressed.ready, false); assert.equal(suppressed.ordersReady, false); assert.equal(suppressed.timeline, null);
  assert.deepEqual(suppressed.cards, []); assert.deepEqual(suppressed.orderGroups, []); assert.equal(suppressed.summary, null);
  const live = facts([kit()], [order('order-1', 'Box A')]);
  assert.deepEqual(kitsPageView(live, 'sample', now), kitsPageView(live, 'live', now), 'Live HQ is retained beside sample Shopify');
  for (const status of ['pending', 'missing'] as const) {
    live.kits.status = status; live.kits.rows = [];
    const view = kitsPageView(live, 'live', now);
    assert.equal(view.ready, false); assert.equal(view.timeline, null); assert.equal(view.ordersReady, true);
    assert.equal(view.orderGroups[0]!.name, 'Other'); assert.equal(view.orderGroups[0]!.orders.length, 1);
  }
  live.kits.status = 'unavailable'; live.kits.rows = [kit()]; live.orders.status = 'unavailable';
  const retained = kitsPageView(live, 'live', now);
  assert.equal(retained.cards.length, 1); assert.equal(retained.orderGroups.length, 1);
  assert.match(retained.notice!, /Last saved kits/); assert.match(retained.ordersNotice!, /Last saved orders/);
  live.orders.status = 'missing';
  assert.equal(kitsPageView(live, 'live', now).ordersReady, false); assert.deepEqual(kitsPageView(live, 'live', now).orderGroups, []);
});
