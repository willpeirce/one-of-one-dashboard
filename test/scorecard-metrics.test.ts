import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays } from '../src/hero-range.js';
import { defaultSettings } from '../src/settings.js';
import { buildScorecard, profitPointer, scorecardMonth, type ProfitPeriod, type ScorecardInput } from '../src/scorecard/metrics.js';
import { compareSpendAndSales } from '../src/scorecard/growth.js';
import type { Order } from '../src/shopify/model.js';
import type { StockDailyRow } from '../src/scorecard/stock-daily.js';

const now = new Date('2026-11-08T12:00:00Z');
const dates = (from: string, to: string) => {
  const result: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) result.push(day);
  return result;
};
/** Invented projections, with no customer or provider account information. */
function order(id: string, day: string, money: number, flag: Order['firstOrder'] = 'first', product = 'invented-product', quantity = 1): Order {
  return { id, orderNumber: null, createdAt: `${day}T12:00:00Z`, updatedAt: `${day}T12:00:00Z`, day,
    cancelledAt: null, test: false, channel: 'Online Store', paidAt: `${day}T12:00:00Z`, fulfillmentStatus: 'FULFILLED',
    discountSignals: [], financialStatus: 'PAID', currency: 'GBP', taxesIncluded: false, itemTaxPence: 0,
    itemsAfterDiscountsPence: money * 100, taxPence: 0, shippingPence: 0, totalPence: money * 100,
    tags: [], firstOrder: flag, market: 'UK', marketBasis: 'country', country: 'GB', region: null, postcodeArea: null,
    lines: [{ id: `invented-line-${id}`, variantId: null, productId: product, sku: product.toUpperCase(), quantity }],
    giftTest: null, refunds: [], fulfillments: [], firstVisit: null, lastVisit: null };
}
function input(changes: Partial<ScorecardInput> = {}): ScorecardInput {
  const days = dates('2026-09-01', '2026-10-31');
  const orders = changes.orders ?? [order('invented-before', '2026-09-02', 100),
    order('invented-new', '2026-10-02', 100), order('invented-returning', '2026-10-02', 50, 'repeat'),
    order('invented-unknown', '2026-10-02', 50, 'unknown')];
  const settings = defaultSettings();
  settings.paymentFeePercent = 2;
  settings.startingCogs = [{ sku: 'INVENTED-PRODUCT', unitCostGbp: 10 }];
  settings.overheads = [{ name: 'Invented service', monthlyGbp: 31, startMonth: '', endMonth: '' }];
  const dailySales = days.map(day => ({ day, netSales: orders.filter(row => row.day === day).reduce((sum, row) => sum + row.itemsAfterDiscountsPence, 0) / 100 }));
  return { mode: 'live', month: '2026-10', market: 'all', now, orders, dailySales, salesCoverage: days, orderCoverage: days,
    settings, costs: [], estimates: orders.map(row => ({ orderId: row.id, costPence: 200, source: 'invented-estimate' })),
    spend: { mode: 'live', rows: ['2026-09-02', '2026-10-02'].map(day => ({ source: 'meta', accountId: 'invented-account',
      campaignId: 'invented-campaign', campaignName: 'Invented UK campaign', adSetId: null, adSetName: null,
      owner: 'ours', market: 'uk', day, amount: day.startsWith('2026-09') ? '20.00' : '30.00', currency: 'GBP' })),
    sources: [{ source: 'meta', live: true, ready: true, status: 'live', fetchedAt: now.toISOString() }], days: days.map(day => ({ day, source: 'meta' })) },
    stockDaily: [], locations: [{ market: 'uk', locationId: 'invented-uk' }, { market: 'us', locationId: 'invented-us' }],
    productLabels: { 'invented-product': 'Invented kit' }, ...changes };
}
function stock(day: string, productId: string, available: number, locationId = 'invented-uk'): StockDailyRow {
  return { mode: 'live', day, productId, available, locationId, inventoryItemId: `invented-item-${productId}`,
    takenAt: `${day}T00:05:00Z`, fetchedAt: `${day}T00:03:00Z`, source: 'shopify', brand: 'one-of-one', sourceId: `invented-stock-${productId}` };
}

test('completed UK calendar months use the last full month and real leap-year ends', () => {
  const october = scorecardMonth(undefined, now);
  assert.deepEqual(october, { month: '2026-10', from: '2026-10-01', to: '2026-10-31', previousFrom: '2026-09-01',
    previousTo: '2026-09-30', yearFrom: '2025-10-01', yearTo: '2025-10-31', label: 'October 2026' });
  assert.equal(scorecardMonth(undefined, new Date('2026-10-31T23:30:00Z')).month, '2026-09');
  assert.equal(scorecardMonth(undefined, new Date('2026-03-31T23:30:00Z')).month, '2026-03');
  assert.equal(scorecardMonth('2024-02', now).to, '2024-02-29');
  assert.equal(scorecardMonth('2024-02', now).yearTo, '2023-02-28');
  for (const invalid of ['2026-11', '2026-13', '2026-1', 'not-a-month', '0001-01']) assert.throws(() => scorecardMonth(invalid, now));
});

test('spend falling more slowly than sales still grew faster; unavailable percentages remain independent', () => {
  const falling = compareSpendAndSales({ netSales: 80, spend: 95 }, { netSales: 100, spend: 100 });
  assert.equal(falling.salesGrowthPercent, -20); assert.equal(falling.spendGrowthPercent, -5);
  assert.equal(falling.relation, 'spend-faster'); assert.equal(falling.headline, 'Spend grew faster than sales');
  assert.match(falling.line, /Spend −5.0% · Shopify net sales −20.0%/);
  assert.equal(compareSpendAndSales({ netSales: 120, spend: 110 }, { netSales: 100, spend: 100 }).relation, 'sales-faster');
  assert.equal(compareSpendAndSales({ netSales: 110, spend: 220 }, { netSales: 100, spend: 200 }).relation, 'same');
  for (const missing of [null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = compareSpendAndSales({ netSales: 120, spend: 150 }, { netSales: missing, spend: 100 });
    assert.equal(result.salesGrowthPercent, null); assert.equal(result.spendGrowthPercent, 50);
    assert.equal(result.relation, 'unavailable'); assert.match(result.line, /Spend \+50.0%/);
  }
});

test('overall and per-platform growth use Shopify net sales and explicit spend-day coverage', () => {
  const source = input(), model = buildScorecard(source);
  assert.equal(model.sales.current, 200); assert.equal(model.sales.previous, 100);
  assert.equal(model.growth.overall.salesGrowthPercent, 100); assert.equal(model.growth.overall.spendGrowthPercent, 50);
  assert.equal(model.growth.platforms[0]!.comparison.relation, 'sales-faster');
  assert.equal(model.growth.platforms[1]!.comparison.spendGrowthPercent, null);
  assert.equal(model.growth.platforms[1]!.comparison.salesGrowthPercent, 100);
  source.spend.days = source.spend.days.filter(row => row.day !== '2026-10-25');
  const missing = buildScorecard(source);
  assert.equal(missing.growth.overall.spendGrowthPercent, null);
  assert.equal(missing.sales.current, 200);
  const failed = input(); failed.spend.sources[0]!.failures = 1;
  assert.equal(buildScorecard(failed).growth.overall.spendGrowthPercent, null);
  const mixed = input(); mixed.spend.mode = 'sample';
  assert.equal(buildScorecard(mixed).growth.overall.spendGrowthPercent, null);
  assert.deepEqual(model.days.find(row => row.day === '2026-10-25')!.spikeMarkets, ['UK']);
  assert.deepEqual(buildScorecard({ ...input(), market: 'us' }).days.find(row => row.day === '2026-10-25')!.spikeMarkets, []);
});

test('last-year comparisons require complete history, not an early order or a partial matching month', () => {
  const days = dates('2025-10-01', '2026-10-31'), source = input();
  source.salesCoverage = days; source.dailySales = days.map(day => ({ day, netSales: 10 }));
  source.spend.days = days.map(day => ({ day, source: 'meta' }));
  source.spend.rows.push({ ...source.spend.rows[0]!, day: '2025-10-02', amount: '10.00' });
  const complete = buildScorecard(source);
  assert.equal(complete.sales.yearAvailable, true); assert.equal(complete.sales.lastYear, 310);
  assert.equal(complete.sales.lastYearGrowthPercent, 0);
  assert.equal(complete.growth.lastYear?.spendGrowthPercent, 200);
  assert.equal(complete.growth.platforms[0]!.lastYear?.spendGrowthPercent, 200);
  assert.equal(complete.growth.platforms[1]!.lastYear, null);
  source.salesCoverage = days.filter(day => day !== '2026-04-03');
  source.orders = [...source.orders, order('invented-early', '2024-01-01', 90)];
  const gap = buildScorecard(source);
  assert.equal(gap.sales.yearAvailable, false); assert.equal(gap.sales.lastYear, null); assert.equal(gap.growth.lastYear, null);
  source.salesCoverage = days;
  source.spend.days = source.spend.days.filter(row => row.day !== '2025-10-17');
  assert.equal(buildScorecard(source).sales.lastYear, 310);
  assert.equal(buildScorecard(source).growth.lastYear, null);
});

test('new, returning and unknown keep their own money and mix, with market filtering', () => {
  const source = input();
  source.orders = [...source.orders, { ...order('invented-us', '2026-10-02', 250, 'repeat'), market: 'US', country: 'US' }];
  const uk = buildScorecard({ ...source, market: 'uk' });
  assert.deepEqual(uk.customers.slices.map(row => [row.key, row.money, row.mixPercent, row.orders]),
    [['first', 100, 50, 1], ['repeat', 50, 25, 1], ['unknown', 50, 25, 1]]);
  assert.deepEqual(uk.customers.slices.map(row => row.previousMoney), [100, 0, 0]);
  const us = buildScorecard({ ...source, market: 'us' });
  assert.deepEqual(us.customers.slices.map(row => row.money), [0, 250, 0]);
  assert.deepEqual(us.customers.slices.map(row => row.mixPercent), [0, 100, 0]);
});

test('refunds use their UK event date and keep negative cohort money without inventing a ring share', () => {
  const prior = order('invented-refunded', '2026-09-01', 80, 'repeat');
  prior.refunds = [{ id: 'invented-refund', createdAt: '2026-09-30T23:30:00Z', itemsPence: 8000, taxPence: 0, shippingNetPence: 0 }];
  const source = input({ orders: [prior, order('invented-new-month', '2026-10-01', 100)] });
  const model = buildScorecard(source);
  assert.deepEqual(model.customers.slices.map(row => row.money), [100, -80, 0]);
  assert.equal(model.customers.previousMixAvailable, true);
  assert.equal(model.customers.mixAvailable, false);
  assert.deepEqual(model.customers.slices.map(row => row.mixPercent), [null, null, null]);
  const empty = buildScorecard(input({ orders: [] }));
  assert.equal(empty.customers.mixAvailable, false);
  const uncovered = buildScorecard({ ...source, orderCoverage: source.orderCoverage.filter(day => day !== '2026-10-05') });
  assert.equal(uncovered.customers.available, false);
  assert.deepEqual(uncovered.customers.slices.map(row => row.money), [null, null, null]);
});

test('product movers are top three by ordered units, with sell-outs and missing stock days distinct', () => {
  const orders: Order[] = [];
  for (let index = 0; index < 8; index++) {
    const product = `invented-mover-${index}`, up = index < 4, quantity = index + 1;
    orders.push(order(`invented-prior-${index}`, '2026-09-12', 900 - index * 50, 'repeat', product, up ? 1 : 10));
    orders.push(order(`invented-current-${index}`, '2026-10-12', 10 + index * 5, 'first', product, up ? quantity + 1 : 10 - quantity));
  }
  orders.push({ ...order('invented-free', '2026-10-12', 0, 'first', 'invented-free', 999), totalPence: 0 });
  orders.push({ ...order('invented-unpaid', '2026-10-12', 100, 'first', 'invented-unpaid', 999), financialStatus: 'PENDING' });
  const source = input({ market: 'uk', orders, stockDaily: [stock('2026-10-12', 'invented-mover-3', 0), stock('2026-09-12', 'invented-mover-3', 9)] });
  const model = buildScorecard(source);
  assert.deepEqual(model.movers.up.map(row => row.change), [4, 3, 2]);
  assert.deepEqual(model.movers.down.map(row => row.change), [-8, -7, -6]);
  assert.equal(model.movers.up[0]!.stock.current.outOfStock, true);
  assert.equal(model.movers.up[0]!.stock.current.unknownDays, 30);
  assert.match(model.movers.up[0]!.stock.current.label, /Out of stock in UK on 1 day; stock then not known on 30 days/);
  assert.equal(model.movers.up[0]!.stock.previous.outOfStock, false);
  assert.equal(model.movers.up[1]!.stock.current.unknownDays, 31);
  const uncovered = buildScorecard({ ...source, orderCoverage: source.orderCoverage.filter(day => day !== '2026-09-01') });
  assert.equal(uncovered.movers.available, false); assert.deepEqual(uncovered.movers.up, []);
});

test('stock totals include all inventory items and never reuse a sample snapshot in live mode', () => {
  const first = stock('2026-10-02', 'invented-product', 0);
  const positive = { ...first, inventoryItemId: 'invented-second-item', available: 7 };
  const sample = { ...stock('2026-10-03', 'invented-product', 0), mode: 'sample' as const };
  const model = buildScorecard(input({ market: 'uk', stockDaily: [first, positive, sample] }));
  assert.equal(model.movers.up[0]!.stock.current.outOfStock, false);
  assert.equal(model.movers.up[0]!.stock.current.unknownDays, 30);
  const split = buildScorecard(input({ stockDaily: [stock('2026-10-02', 'invented-product', 0), stock('2026-10-02', 'invented-product', 20, 'invented-us')] }));
  assert.equal(split.movers.up[0]!.stock.current.outOfStock, true, 'US stock cannot hide a UK sell-out');
  assert.match(split.movers.up[0]!.stock.current.label, /Out of stock in UK/);
  const partlyKnown = buildScorecard(input({ stockDaily: [stock('2026-10-02', 'invented-product', 0)] }));
  assert.equal(partlyKnown.movers.up[0]!.stock.current.outOfStock, true);
  assert.equal(partlyKnown.movers.up[0]!.stock.current.unknownDays, 31, 'The known UK sell-out does not invent US stock');
});

test('a missing known inventory item makes a location unknown, not sold out', () => {
  const first = stock('2026-10-02', 'invented-product', 0);
  const second = { ...stock('2026-09-12', 'invented-product', 9), inventoryItemId: 'invented-second-item' };
  const source = input({ market: 'uk', stockDaily: [first, second] });
  const partial = buildScorecard(source).movers.up[0]!.stock;
  assert.equal(partial.current.outOfStock, false);
  assert.equal(partial.current.unknownDays, 31);
  assert.equal(partial.previous.unknownDays, 30, 'The known item from the other month is not assumed absent before it was observed');
  assert.doesNotMatch(partial.current.label, /Out of stock/);
  const completed = { ...first, inventoryItemId: second.inventoryItemId, available: 0 };
  const fullUk = buildScorecard({ ...source, market: 'all', stockDaily: [...source.stockDaily, completed] }).movers.up[0]!.stock.current;
  assert.equal(fullUk.outOfStock, true, 'Complete UK zero still proves a UK sell-out when US is missing');
  assert.equal(fullUk.unknownDays, 31);
  assert.match(fullUk.label, /Out of stock in UK/);
});

test('profit follows observed product costs, fulfilment, fees, spend and estimated overhead', () => {
  const model = buildScorecard(input());
  assert.equal(model.profit.current.grossProfit, 170); assert.equal(model.profit.current.grossMarginPercent, 85);
  assert.equal(model.profit.current.profit, 99); // 200 sales - 30 product - 6 fulfilment - 4 fees - 30 ads - 31 overhead.
  assert.equal(model.profit.previous.profit, 35);
  assert.equal(model.profit.overheadEstimated, true);
  assert.match(model.profit.assumptions.join(' '), /Overhead is an estimate/);
  const source = input(); source.settings.startingCogs = [];
  const missing = buildScorecard(source);
  assert.equal(missing.profit.current.grossMarginPercent, null); assert.equal(missing.profit.current.profit, null);
  assert.match(missing.profit.pointer, /waits for complete sales and product costs/);
  assert.deepEqual(model.costPerOrder, { state: 'waiting', line: 'Not enough data yet' });
});

test('profit pointers distinguish discounts/mix, downstream costs and both improving', () => {
  const period = (netSales: number, grossMarginPercent: number, profit: number): ProfitPeriod => ({ netSales, grossMarginPercent, profit, grossProfit: netSales * grossMarginPercent / 100, assumptions: [] });
  const previous = period(100, 60, 20);
  assert.equal(profitPointer(period(120, 55, 25), previous), 'Sales up and gross margin down: look at discounts, product costs and mix.');
  assert.equal(profitPointer(period(120, 65, 15), previous), 'Gross margin up and profit down: look at marketing, fulfilment and overhead.');
  assert.equal(profitPointer(period(120, 65, 25), previous), 'Both up: good.');
});
