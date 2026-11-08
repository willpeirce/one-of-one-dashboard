import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateStockGaps, inboundProductWarning, stockGapNeeds, type InboundStock } from '../src/shopify/stock-gap.js';
import type { StockCover } from '../src/shopify/metrics.js';
import { decisionsHtml } from '../src/decisions/view.js';
import { ukToday } from '../src/hero-range.js';

const stock = (market: 'uk' | 'us' = 'uk', cover: number | null = 3): StockCover => ({
  product: 'Invented Starter', productId: 'invented-starter', locationId: `invented-${market}`, market,
  name: `Invented Starter · ${market}`, available: 3, required: null, dailyRate: 1, cover, runOut: null, basis: 'Invented measured rate',
});
const arrival = (expectedDate: string, market: 'uk' | 'us' = 'uk', quantity = 11): InboundStock => ({
  product: 'invented starter', market, quantity, expectedDate,
});

test('stock gap matches product without case, separates markets and chooses the first future arrival', () => {
  const rows = calculateStockGaps([stock(), stock('us')], [arrival('2026-11-20'), arrival('2026-11-10'), arrival('2026-11-10', 'uk', 7), arrival('2026-11-12', 'us')], [], '2026-11-05');
  assert.equal(rows[0]!.coverDays, 3);
  assert.deepEqual(rows[0]!.nextArrival, { date: '2026-11-10', quantity: 18, assumed: false });
  assert.equal(rows[0]!.daysToArrival, 5); assert.equal(rows[0]!.gapDays, 2);
  assert.deepEqual(rows[1]!.nextArrival, { date: '2026-11-12', quantity: 11, assumed: false });
  assert.equal(rows[1]!.gapDays, 4);
});

test('past arrivals stop counting and the shortest non-null supplier lead time becomes an explicit assumption', () => {
  const leadTimes = [{ days: null }, { days: 12 }, { days: 5 }];
  const rows = calculateStockGaps([stock()], [arrival('2026-11-04')], leadTimes, '2026-11-05');
  assert.deepEqual(rows[0]!.nextArrival, { date: '2026-11-10', quantity: null, assumed: true });
  assert.equal(rows[0]!.gapDays, 2);
  const need = stockGapNeeds([stock()], [], leadTimes, '2026-11-05', 'live')[0]!;
  assert.match(need.why, /Assumed arrival 2026-11-10: shortest supplier lead time, 5 days/);
  assert.match(need.why, /no upcoming inbound row/);
  assert.equal(calculateStockGaps([stock()], [], [{ days: 0 }, { days: 5 }], '2026-11-05')[0]!.gapDays, 0);
});

test('unknown cover or timing creates no gap need; today arrivals and adequate cover create none', () => {
  const today = '2026-11-05';
  assert.equal(calculateStockGaps([stock()], [], [{ days: null }], today)[0]!.gapDays, null);
  assert.equal(calculateStockGaps([stock('uk', null)], [arrival('2026-11-10')], [], today)[0]!.gapDays, null);
  assert.deepEqual(stockGapNeeds([stock()], [], [], today, 'live'), []);
  assert.deepEqual(stockGapNeeds([stock('uk', null)], [arrival('2026-11-10')], [], today, 'live'), []);
  assert.deepEqual(stockGapNeeds([stock()], [arrival(today)], [], today, 'live'), []);
  assert.deepEqual(stockGapNeeds([stock('uk', 10)], [arrival('2026-11-10')], [], today, 'live'), []);
  assert.equal(calculateStockGaps([stock('uk', -2)], [arrival('2026-11-10')], [], today)[0]!.gapDays, 5);
});

test('UK calendar dates cross the autumn clock change without adding an hour to the gap', () => {
  const today = ukToday(new Date('2026-10-24T23:30:00Z'));
  assert.equal(today, '2026-10-25');
  const row = calculateStockGaps([stock('uk', 0.25)], [arrival('2026-10-26')], [], today)[0]!;
  assert.equal(row.daysToArrival, 1); assert.equal(row.gapDays, 0.75);
  const need = stockGapNeeds([stock('uk', 0.25)], [arrival('2026-10-26')], [], today, 'live')[0]!;
  assert.deepEqual(need.figure, { value: '1', label: 'days gap · rounded up' });
});

test('a live stock gap reaches Watch through its own id while sample rows never add a need', () => {
  const input = [arrival('2026-11-10')];
  assert.deepEqual(stockGapNeeds([stock()], input, [], '2026-11-05', 'sample'), []);
  const needs = stockGapNeeds([stock()], input, [], '2026-11-05', 'live');
  assert.deepEqual(needs.map(({id, source, state, link}) => ({id, source, state, link})), [{ id: 'stock-gap:invented-starter:uk', source: 'shopify', state: 'warn', link: '/settings' }]);
  const html = decisionsHtml({ shopify: { mode: 'live', stock: [], checks: [], needs, detail: {}, live: { lastOrder: '', dispatch: '', carts: '' } } });
  assert.equal((html.match(/class="wrow"/g) ?? []).length, 1); assert.match(html, /Invented Starter/); assert.match(html, /Open settings/);
  assert.doesNotMatch(html, /class="dcard/);
});

test('Settings warn about an unmatched product without rejecting a future planned product', () => {
  assert.equal(inboundProductWarning('INVENTED STARTER', ['Invented Starter']), '');
  assert.equal(inboundProductWarning('', ['Invented Starter']), '');
  assert.match(inboundProductWarning('Invented Future', ['Invented Starter']), /Product not found in Stock and cover/);
});
