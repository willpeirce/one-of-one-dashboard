import {addDays, ukToday} from '../hero-range.js';
import {emptyModel, estimateOrder, type Parcel} from '../fulfilment/model.js';
import type {Settings} from '../settings.js';
import type {Order} from '../shopify/model.js';
import type {ShopifyCost} from '../shopify/costs.js';
import {buildIssueCosts, type IssueCosts} from './costs.js';

/** Invented replacement examples use the Issues clock, never a live-source fallback. */
export function sampleIssueCosts(settings: Settings, now: Date): IssueCosts {
  const today = ukToday(now), first = `${today.slice(0, 7)}-01`, previous = addDays(first, -1);
  const order = (id: string, day: string, quantity: number): Order => ({
    id, day, orderNumber: id.slice(-5), createdAt: `${day}T00:00:00.000Z`, updatedAt: `${day}T00:00:00.000Z`,
    cancelledAt: null, test: false, channel: 'Draft Orders', paidAt: `${day}T00:00:00.000Z`,
    fulfillmentStatus: 'UNFULFILLED', discountSignals: [], financialStatus: 'PAID', currency: 'GBP',
    taxesIncluded: true, itemTaxPence: 0, itemsAfterDiscountsPence: 0, taxPence: 0, shippingPence: 0,
    totalPence: 0, tags: ['replacement'], firstOrder: 'unknown', market: 'UK', marketBasis: 'country',
    country: 'GB', region: null, postcodeArea: null, giftTest: null, refunds: [], fulfillments: [], firstVisit: null, lastVisit: null,
    lines: [{id: `gid://shopify/LineItem/${id.slice(-5)}`, variantId: 'gid://shopify/ProductVariant/83001',
      productId: 'gid://shopify/Product/82001', sku: 'BOX_A', quantity}],
  });
  const orders = [order('gid://shopify/Order/81001', first, 2), order('gid://shopify/Order/81002', first, 1),
    order('gid://shopify/Order/81003', previous, 1)];
  const history: ShopifyCost[] = [{variant_id: 'gid://shopify/ProductVariant/83001', inventory_item_id: '84001',
    product_id: 'gid://shopify/Product/82001', sku: 'BOX_A', amount_pence: 350, currency: 'GBP',
    first_seen_at: `${previous.slice(0, 7)}-01T00:00:00.000Z`, last_seen_at: now}];
  const parcel: Parcel = {id: 'invented-parcel', orderId: orders[0]!.id, orderNumber: '81001',
    despatchedAt: `${first} 09:00:00`, warehouse: 'uk', centre: 'Invented centre', service: 'Invented service',
    carrier: 'Invented carrier', country: 'GB', boxedGrams: 400, currency: 'GBP', postageMinor: 240,
    pickPackMinor: 160, customerPaidPence: 0, gbpPerUsd: 0.8, uploadId: 'invented-upload',
    replacedEstimatePence: null, rateBaselinePence: null, flags: []};
  const sampleSettings = {...settings, startingCogs: [], flatFulfilmentUkGbp: 5};
  const estimates = orders.map(row => ({orderId: row.id, ...estimateOrder(row, [parcel], emptyModel(), sampleSettings)}));
  return buildIssueCosts({mode: 'sample', records: orders.map(data => ({kind: 'order', data, fetched_at: now})),
    jobs: [{name: 'backfill', state: {from: `${previous.slice(0, 7)}-01`, ordersDone: true, until: now.toISOString()},
      last_success_at: now, failures: 0}, {name: 'poll', state: {}, last_success_at: now, failures: 0}]},
  history, estimates, sampleSettings, now);
}
