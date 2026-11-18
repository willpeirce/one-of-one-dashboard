import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultSettings} from '../src/settings.js';
import {emptyModel, estimateOrder, type Parcel} from '../src/fulfilment/model.js';
import {buildIssueCosts, type IssueCostFacts, type IssueCostEstimate} from '../src/issues/costs.js';
import {sampleIssueCosts} from '../src/issues/costs-sample.js';
import {isFreeOrder, isReplacementOrder, type Order} from '../src/shopify/model.js';
import type {ShopifyCost} from '../src/shopify/costs.js';

const now = new Date('2034-04-07T12:00:00Z');
const settings = {...defaultSettings(), startingCogs: [], flatFulfilmentUkGbp: 5, flatFulfilmentUsGbp: null};
function order(id: string, at = '2034-04-03T12:00:00Z', patch: Partial<Order> = {}): Order {
  return {id, orderNumber: id.slice(-5), createdAt: at, updatedAt: at, day: at.slice(0, 10), cancelledAt: null,
    test: false, channel: 'Draft Orders', paidAt: at, fulfillmentStatus: 'UNFULFILLED', discountSignals: [],
    financialStatus: 'PAID', currency: 'GBP', taxesIncluded: true, itemTaxPence: 0, itemsAfterDiscountsPence: 0,
    taxPence: 0, shippingPence: 0, totalPence: 0, tags: ['replacement'], firstOrder: 'unknown', market: 'UK',
    marketBasis: 'country', country: 'GB', region: null, postcodeArea: null, giftTest: null, refunds: [],
    fulfillments: [], firstVisit: null, lastVisit: null, lines: [{id: `line-${id}`, variantId: 'variant-a',
      productId: 'product-a', sku: 'BOX_A', quantity: 2}], ...patch};
}
const history: ShopifyCost[] = [{variant_id: 'variant-a', inventory_item_id: 'inventory-a', product_id: 'product-a',
  sku: 'BOX_A', amount_pence: 350, currency: 'GBP', first_seen_at: '2034-01-01T00:00:00Z', last_seen_at: now}];
function facts(orders: Order[], at = now, patch: Partial<IssueCostFacts> = {}): IssueCostFacts {
  return {mode: 'live', records: orders.map(data => ({kind: 'order', data, fetched_at: at})), jobs: [
    {name: 'backfill', state: {from: '2033-01-01', ordersDone: true}, last_success_at: at, failures: 0},
    {name: 'poll', state: {}, last_success_at: at, failures: 0}], ...patch};
}
const estimates = (orders: Order[], source: IssueCostEstimate['source'] = 'actual') => orders.map(row => ({orderId: row.id, costPence: 400, source}));
const parcel = (id: string, orderId: string, currency: Parcel['currency'] = 'GBP'): Parcel => ({id, orderId, orderNumber: '83001',
  despatchedAt: '2034-04-04 09:00:00', warehouse: 'uk', centre: 'Invented centre', service: 'Invented service',
  carrier: 'Invented carrier', country: 'GB', boxedGrams: 400, currency, postageMinor: 240, pickPackMinor: 160,
  customerPaidPence: 0, gbpPerUsd: 0.8, uploadId: 'invented-upload', replacedEstimatePence: null, rateBaselinePence: null, flags: []});

test('replacement costs add every landed line and all actual parcels, or existing fulfilment estimates, once per order', () => {
  const current = [order('83001'), order('83002', undefined, {tags: ['resend-0123'], totalPence: 500, shippingPence: 500})];
  const previous = order('83003', '2034-03-15T12:00:00Z');
  const orders = [...current, previous];
  const parcels = [parcel('one', '83001'), parcel('two', '83001')];
  const fulfilment = orders.map(row => ({orderId: row.id, ...estimateOrder(row, parcels, emptyModel(), settings)}));
  const result = buildIssueCosts(facts([...orders, orders[0]!]), history, fulfilment, settings, now);
  assert.equal(result.current.orders, 2); assert.equal(result.current.totalPence, 2700);
  assert.equal(result.current.actualFulfilmentOrders, 1); assert.equal(result.current.estimatedFulfilmentOrders, 1);
  assert.equal(result.previous.orders, 1); assert.equal(result.previous.totalPence, 1200);
  assert.equal(result.current.complete, true); assert.equal(result.previous.complete, true);
});

test('fixes require replacement/resend process tags and exclude promotional zero totals, paid purchases, cancellations and tests', () => {
  const included = [order('83001', undefined, {tags: [' Replacement ']}), order('83002', undefined, {tags: ['RESEND-9876'], totalPence: 600})];
  const excluded = [order('83003', undefined, {tags: []}), order('83004', undefined, {tags: ['marketing']}),
    order('83005', undefined, {tags: ['resend-12345']}), order('83006', undefined, {tags: [], totalPence: 500}),
    order('83007', undefined, {cancelledAt: now.toISOString()}), order('83008', undefined, {test: true}),
    order('83009', undefined, {financialStatus: 'PENDING'})];
  assert.equal(isFreeOrder(excluded[0]!), true); assert.equal(isReplacementOrder(excluded[0]!), false);
  assert.equal(isFreeOrder(included[1]!), true); assert.equal(isReplacementOrder(included[1]!), true);
  const all = [...included, ...excluded], result = buildIssueCosts(facts(all), history, estimates(all), settings, now);
  assert.equal(result.current.orders, 2); assert.equal(result.current.totalPence, 2200);
});

test('legacy orders without stored tags cannot certify zero replacement costs', () => {
  const legacy = order('83001', undefined, {tags: undefined});
  const missing = buildIssueCosts(facts([legacy]), history, estimates([legacy]), settings, now);
  assert.equal(missing.current.orders, null); assert.equal(missing.current.unknownClassificationOrders, 1);
  assert.equal(missing.current.totalPence, null); assert.equal(missing.current.knownPence, null);
  const known = order('83002'), partial = buildIssueCosts(facts([legacy, known]), history, estimates([known]), settings, now);
  assert.equal(partial.current.orders, 1); assert.equal(partial.current.knownPence, 1100); assert.equal(partial.current.totalPence, null);
  const refreshed = buildIssueCosts(facts([{...legacy, tags: []}]), history, estimates([legacy]), settings, now);
  assert.equal(refreshed.current.totalPence, 0); assert.equal(refreshed.current.orders, 0);
});

test('missing goods or fulfilment remain unknown while an explicit partial subtotal preserves known components', () => {
  const mixed = order('83001', undefined, {lines: [{id: 'known', variantId: 'variant-a', productId: 'product-a', sku: 'BOX_A', quantity: 1},
    {id: 'unknown', variantId: 'variant-b', productId: 'product-b', sku: 'BOX_B', quantity: 1}]});
  const result = buildIssueCosts(facts([mixed]), history, [], settings, now);
  assert.equal(result.current.totalPence, null); assert.equal(result.current.knownPence, 350);
  assert.equal(result.current.unknownLineCostOrders, 1); assert.equal(result.current.unknownFulfilmentOrders, 1);
  const empty = buildIssueCosts(facts([order('83002', undefined, {lines: []})]), [], [], settings, now);
  assert.equal(empty.current.knownPence, null); assert.equal(empty.current.totalPence, null);
  assert.equal(empty.current.unknownLineCostOrders, 1);
  const unknownCurrency = estimateOrder(mixed, [parcel('unknown', mixed.id, null)], emptyModel(), settings);
  assert.equal(unknownCurrency.costPence, null);
  assert.equal(buildIssueCosts(facts([mixed]), history, [{orderId: mixed.id, ...unknownCurrency}], settings, now).current.unknownFulfilmentOrders, 1);
});

test('unknown or partial read coverage does not claim zero costs; a completed empty month does', () => {
  const missing = buildIssueCosts(facts([], now, {jobs: []}), [], [], settings, now);
  assert.equal(missing.status, 'pending'); assert.equal(missing.current.orders, null); assert.equal(missing.current.totalPence, null);
  assert.equal(missing.current.knownPence, null);
  const complete = buildIssueCosts(facts([]), [], [], settings, now);
  assert.equal(complete.current.orders, 0); assert.equal(complete.current.totalPence, 0);
  const partial = facts([order('83001')]); partial.jobs[0]!.state.from = '2034-04-04';
  const result = buildIssueCosts(partial, history, estimates([order('83001')]), settings, now);
  assert.equal(result.current.historyComplete, false); assert.equal(result.current.totalPence, null); assert.equal(result.current.knownPence, 1100);
  const failed = facts([order('83001')]); failed.jobs[1]!.failures = 1;
  const retained = buildIssueCosts(failed, history, estimates([order('83001')]), settings, now);
  assert.equal(retained.status, 'unavailable'); assert.equal(retained.current.totalPence, null); assert.equal(retained.current.knownPence, 1100);
});

test('order creation uses UK months across summer midnight, clock changes and year end, never its stored UTC-looking day', () => {
  const examples = [
    {now: '2034-04-01T00:05:00Z', current: '2034-03-31T23:15:00Z', previous: '2034-03-31T22:45:00Z', month: '2034-04'},
    {now: '2034-11-01T00:05:00Z', current: '2034-11-01T00:01:00Z', previous: '2034-10-31T23:45:00Z', month: '2034-11'},
    {now: '2035-01-01T00:05:00Z', current: '2035-01-01T00:01:00Z', previous: '2034-12-31T23:45:00Z', month: '2035-01'},
  ];
  for (const example of examples) {
    const at = new Date(example.now), orders = [order('83001', example.current), order('83002', example.previous),
      order('83003', new Date(+at + 60_000).toISOString())];
    const result = buildIssueCosts(facts(orders, at), history, estimates(orders), settings, at);
    assert.equal(result.current.month, example.month); assert.equal(result.current.orders, 1); assert.equal(result.previous.orders, 1);
  }
});

test('pagination and poll query bounds cannot turn an earlier read into current-month coverage', () => {
  const at = new Date('2034-04-01T00:05:00Z'), input = facts([], at);
  input.jobs[1]!.state = {query: 'updated_at:>=2034-03-31T21:00:00Z updated_at:<=2034-03-31T22:59:00Z'};
  const earlier = buildIssueCosts(input, [], [], settings, at);
  assert.equal(earlier.current.historyComplete, false); assert.equal(earlier.previous.historyComplete, false);
  input.jobs[1]!.state = {query: 'updated_at:>=2034-03-31T21:00:00Z updated_at:<=2034-03-31T23:30:00Z'};
  assert.equal(buildIssueCosts(input, [], [], settings, at).current.historyComplete, true);
  input.jobs[1]!.state.continuing = true;
  assert.equal(buildIssueCosts(input, [], [], settings, at).current.totalPence, null);
  for (const query of ['bad query', 'updated_at:>=2034-04-02T00:00:00Z updated_at:<=2034-04-01T00:00:00Z',
    'updated_at:>=2034-04-01T00:00:00Z updated_at:<=2034-05-01T00:00:00Z']) {
    input.jobs[1]!.state = {query};
    assert.equal(buildIssueCosts(input, [], [], settings, at).current.historyComplete, false);
  }
  input.jobs[1]!.state = {query: 'updated_at:>=2034-03-31T21:00:00Z updated_at:<=2034-03-31T23:30:00Z'};
  input.jobs[1]!.last_success_at = new Date(+at + 60_000);
  assert.equal(buildIssueCosts(input, [], [], settings, at).current.historyComplete, false);
});

test('existing observed-cost history and Settings fallback rules are retained and disclosed', () => {
  const replacement = order('83001'), costs = [{...history[0]!, first_seen_at: '2034-04-05T00:00:00Z'}];
  const firstObserved = buildIssueCosts(facts([replacement]), costs, estimates([replacement]), settings, now);
  assert.equal(firstObserved.current.totalPence, 1100, 'Earlier orders use the earliest observed cost, as existing profit does');
  const fallback = buildIssueCosts(facts([replacement]), [], estimates([replacement]), {...settings, startingCogs: [{sku: 'BOX_A', unitCostGbp: 2}]}, now);
  assert.equal(fallback.current.totalPence, 800); assert.equal(fallback.current.settingsCostOrders, 1);
});

test('sample replacement costs are invented through the same calculator and never appear beside live Issues', () => {
  const sample = sampleIssueCosts(settings, now);
  assert.equal(sample.status, 'sample'); assert.equal(sample.current.orders, 2); assert.equal(sample.current.totalPence, 1950);
  assert.equal(sample.previous.totalPence, 850); assert.equal(sample.current.actualFulfilmentOrders, 1);
  assert.equal(sample.current.estimatedFulfilmentOrders, 1);
  const rows = [order('83001')], suppressed = buildIssueCosts(facts(rows, now, {mode: 'sample'}), history, estimates(rows), settings, now, 'live');
  assert.equal(suppressed.status, 'suppressed'); assert.equal(suppressed.checkedAt, null);
  for (const month of [suppressed.current, suppressed.previous]) {
    assert.equal(month.orders, null); assert.equal(month.totalPence, null); assert.equal(month.knownPence, null);
  }
});
