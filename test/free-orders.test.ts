import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { orderFields } from '../src/shopify/client.js';
import { cleanOrder, isFreeOrder, paidOrder, type Order } from '../src/shopify/model.js';
import { fixture, SampleShopify } from '../src/shopify/sample.js';
import { ShopifyStore } from '../src/shopify/store.js';
import { ShopifyWorker } from '../src/shopify/worker.js';
import { createTestDatabase } from './helpers/database.js';
import { sampleSpend } from '../src/ad-spend/store.js';
import { applyShopifyDashboard } from '../src/shopify/dashboard.js';
import { dailyRows, dataset, shopifyHero, type Facts } from '../src/shopify/metrics.js';
import { defaultSettings } from '../src/settings.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';

test('one free-order predicate covers zero original charge and process tags without treating refunded purchases as free', async () => {
  const zero = cleanOrder((await fixture('order-zero-total-paid')).data.order) as Order;
  assert.equal(paidOrder(zero), true);
  assert.equal(isFreeOrder(zero), true);
  const paid = cleanOrder((await fixture('order')).data.order) as Order;
  for (const tag of ['replacement', 'Replacement', ' resend-0123 ', 'RESEND-9876']) {
    assert.equal(isFreeOrder({ ...paid, tags: [tag] }), true, tag);
  }
  for (const tag of ['resend-012', 'resend-01234', 'replacement-check', 'pre-replacement', 'resend-0123-later']) {
    assert.equal(isFreeOrder({ ...paid, tags: [tag] }), false, tag);
  }
  assert.equal(isFreeOrder({ ...paid, financialStatus: 'REFUNDED', refunds: [{
    id: 'gid://shopify/Refund/990431', createdAt: paid.createdAt,
    itemsPence: paid.itemsAfterDiscountsPence, taxPence: paid.taxPence,
  }] }), false);
  const legacyZero = { ...zero }; delete legacyZero.totalPence; delete legacyZero.tags;
  assert.equal(isFreeOrder(legacyZero), true);
  assert.equal(isFreeOrder({ ...legacyZero, shippingPence: 500 }), false);
  assert.equal(isFreeOrder({ ...legacyZero, itemsAfterDiscountsPence: 0, taxPence: 100, itemTaxPence: 100 }), false);
});

test('Shopify reads original total and retains only replacement tags, never arbitrary tag text', async () => {
  assert.match(orderFields(false), /\bdiscountCodes tags\b/);
  assert.match(orderFields(false), /\btotalPriceSet\s*\{/);
  const raw = (await fixture('order')).data.order;
  raw.tags = [' Replacement ', 'RESEND-0123', 'invented-sensitive-note', 'resend-012', 'replacement-check'];
  raw.totalPriceSet = { shopMoney: { amount: '0.00', currencyCode: 'GBP' } };
  const cleaned = cleanOrder(raw) as Order;
  assert.equal(cleaned.totalPence, 0);
  assert.deepEqual(cleaned.tags, ['replacement', 'resend-0123']);
  assert.equal(isFreeOrder(cleaned), true);
  assert.ok(!JSON.stringify(cleaned).includes('invented-sensitive-note'));
  for (const name of ['order-uk-tax-inclusive-refund', 'order-us-tax-exclusive']) {
    const o = cleanOrder((await fixture(name)).data.order);
    assert.equal(o.totalPence, o.itemsAfterDiscountsPence + o.shippingPence + (o.taxesIncluded ? o.itemTaxPence : o.taxPence));
  }
});

test('existing bounded legacy refresh persists free-order totals and tags across restarts without an extra polling job', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  let now = new Date('2026-09-30T12:00:00Z');
  const raw = (await fixture('order')).data.order;
  raw.id = 'gid://shopify/Order/990432'; raw.refunds = [];
  raw.tags = ['resend-0123', 'invented-sensitive-note'];
  raw.totalPriceSet = { shopMoney: { amount: '25.00', currencyCode: 'GBP' } };
  const legacy = cleanOrder(raw) as Order;
  delete legacy.totalPence; delete legacy.tags;
  await new ShopifyStore(db, 'live').put('order', legacy.id, legacy, now, new Date(legacy.updatedAt));
  const calls: string[] = [];
  class Reader extends SampleShopify {
    override async order(id: string, _address: boolean) { calls.push(id); return structuredClone(raw); }
  }
  const env = { SHOPIFY_CLIENT_ID: randomUUID(), SHOPIFY_CLIENT_SECRET: randomUUID() };
  const reader = new Reader();
  const worker = new ShopifyWorker(db, env, 'https://pulse.example.test', { reader, clock: () => now });
  await worker.initialize();
  await db.query("UPDATE pulse.shopify_jobs SET state=$1 WHERE mode='live' AND name='backfill'", [JSON.stringify({ from: '2026-08-01', ordersDone: true, address: true })]);
  await db.query("UPDATE pulse.shopify_jobs SET next_run_at='9999-01-01' WHERE name <> 'shipping_refunds'");
  await worker.tick();
  assert.deepEqual(calls, [legacy.id]);
  const saved = (await worker.store.facts()).records.find(r => r.kind === 'order')!.data as Order;
  assert.equal(saved.totalPence, 2500); assert.deepEqual(saved.tags, ['resend-0123']);
  assert.equal(isFreeOrder(saved), true);
  const state = (await db.query<{ state: { after: string } }>("SELECT state FROM pulse.shopify_jobs WHERE name='shipping_refunds'")).rows[0]!.state;
  assert.equal(state.after, legacy.id);
  now = new Date(now.getTime() + 60_000);
  const restarted = new ShopifyWorker(db, env, 'https://pulse.example.test', { reader, clock: () => now });
  await restarted.initialize(); await restarted.tick();
  assert.deepEqual(calls, [legacy.id]);
  assert.equal((await db.query<{ state: { idle: boolean } }>("SELECT state FROM pulse.shopify_jobs WHERE name='shipping_refunds'")).rows[0]!.state.idle, true);
  assert.equal((await db.query("SELECT name FROM pulse.shopify_jobs WHERE name='order_details'")).rows.length, 0);
});

test('free sends leave order ratios and sheet counts while their goods and postage reduce profit', async t => {
  const day = '2026-09-29', now = new Date('2026-09-30T12:00:00Z');
  const raw = (await fixture('order')).data.order;
  raw.createdAt = raw.updatedAt = `${day}T10:00:00Z`; raw.customer = null;
  raw.refunds = []; raw.fulfillments = []; raw.customerJourneySummary = null; raw.tags = [];
  raw.transactions = []; raw.shippingAddress = { countryCodeV2: 'GB' };
  raw.displayFinancialStatus = 'PAID'; raw.taxesIncluded = true;
  const money = (amount: string) => ({ shopMoney: { amount, currencyCode: 'GBP' } });
  raw.subtotalPriceSet = money('96.00'); raw.totalPriceSet = money('102.00');
  raw.totalShippingPriceSet = money('6.00'); raw.totalTaxSet = money('17.00');
  raw.lineItems.nodes = [{ id: 'gid://shopify/LineItem/990441', sku: 'invented-paid-kit', quantity: 1, product: null, taxLines: [{ priceSet: money('16.00') }] }];
  raw.id = 'gid://shopify/Order/990441';
  const paid = cleanOrder(raw) as Order;
  const zeroRaw = structuredClone(raw);
  zeroRaw.id = 'gid://shopify/Order/990442';
  zeroRaw.subtotalPriceSet = zeroRaw.totalPriceSet = zeroRaw.totalShippingPriceSet = zeroRaw.totalTaxSet = money('0.00');
  zeroRaw.lineItems.nodes = [{ id: 'gid://shopify/LineItem/990442', sku: 'invented-send-kit', quantity: 2, product: null, taxLines: [] }];
  const zero = cleanOrder(zeroRaw) as Order;
  const resendRaw = structuredClone(zeroRaw);
  resendRaw.id = 'gid://shopify/Order/990443'; resendRaw.tags = ['resend-0123'];
  resendRaw.totalPriceSet = resendRaw.totalShippingPriceSet = money('5.00');
  resendRaw.lineItems.nodes[0].id = 'gid://shopify/LineItem/990443'; resendRaw.lineItems.nodes[0].quantity = 1;
  const resend = cleanOrder(resendRaw) as Order;
  assert.equal(resend.totalPence, 500); assert.equal(isFreeOrder(resend), true);
  const orders = [paid, zero, resend];
  const session = { day, sessions: 100, carts: 5, checkouts: 3, completed: 1, uk: 100, us: 0, missouri: 0,
    ukCarts: 5, usCarts: 0, ukCheckouts: 3, usCheckouts: 0, ukCompleted: 1, usCompleted: 0, marketReliable: true };
  const makeFacts = (selected: Order[]): Facts => ({ mode: 'live', sample: false, counts: {}, pendingWebhooks: 0, notices: [], geoNotice: null, noticeDetails: [],
    jobs: ['backfill', 'poll', 'sessions', 'inventory', 'reconcile', 'subscriptions'].map(name => ({ name, state: name === 'backfill' ? { from: '2026-08-01', ordersDone: true, allOrders: true } : {}, last_success_at: now, failures: 0 })),
    records: [...selected.map(data => ({ kind: 'order', data, fetched_at: now })), { kind: 'sessions', data: session, fetched_at: now }],
  });
  const settings = { ...defaultSettings(), paymentFeePercent: 2,
    startingCogs: [{ sku: 'invented-paid-kit', unitCostGbp: 10 }, { sku: 'invented-send-kit', unitCostGbp: 4 }],
    overheads: [{ name: 'Invented free service', monthlyGbp: 0, startMonth: '', endMonth: '' }],
  };
  const spend = sampleSpend(day, day);
  spend.rows = [{ ...spend.rows[0]!, source: 'meta', campaignId: 'invented-free-campaign', campaignName: 'Invented UK',
    adSetId: 'invented-free-adset', adSetName: 'Invented — UK — Daily', market: 'uk', owner: 'ours', amount: '20.000000' }];
  const inputs = { spend, costs: [], now, estimates: [
    { orderId: paid.id, costPence: 700, source: 'exact' },
    { orderId: zero.id, costPence: 500, source: 'exact' },
    { orderId: resend.id, costPence: 600, source: 'exact' },
  ] };
  const facts = makeFacts(orders);
  assert.equal(dataset(facts, '2026-09-30').orders.length, 3);
  const row = dailyRows(facts, '2026-09-30').find(row => row.date === day)!;
  assert.equal(row.o, 1); assert.equal(row.uk, 1); assert.equal(row.net, 80);
  const hero = shopifyHero(facts, '2026-09-30', day, day, settings, undefined, undefined, inputs, now);
  const paidOnly = shopifyHero(makeFacts([paid]), '2026-09-30', day, day, settings, undefined, undefined, inputs, now);
  assert.equal(hero.orders.n, 1); assert.equal(hero.cr.n, 1);
  assert.equal(Reflect.get(hero, 'aov').n, 80); assert.equal(Reflect.get(hero, 'cac').n, 20);
  assert.equal(hero.ukcpo.v, 20);
  assert.equal(hero.net.n, paidOnly.net.n); assert.equal(hero.net.n, 80);
  assert.match(JSON.stringify(hero.orders.d), /Free orders \(replacements and marketing send-outs at £0\) are left out\./);
  const freeRow = hero.orders.d.extra!.find(([label]) => /free orders/i.test(label));
  assert.ok(freeRow); assert.match(freeRow[1], /\b2\b/);
  assert.equal(hero.business!.orderDays[0]!.total, 1);
  assert.equal(hero.business!.orderDays[0]!.UK, 1);
  assert.ok(Math.abs(hero.profit.n - 28.4) < 1e-10);
  assert.ok(Math.abs(paidOnly.profit.n - hero.profit.n - 18) < 1e-10);
  assert.equal(hero.margin.n, 100 * hero.profit.n / hero.net.n);
  assert.match(hero.margin.d.extra!.find(([label]) => label === 'Landed costs')![1], /£22\.00/);
  assert.match(hero.margin.d.extra!.find(([label]) => label === 'Fulfilment')![1], /£18\.00/);

  const db = await createTestDatabase(); t.after(() => db.close());
  const todayFacts = makeFacts(orders.map(o => ({ ...o, day: '2026-09-30' })));
  todayFacts.records.find(row => row.kind === 'sessions')!.data = { ...session, day: '2026-09-30' };
  const snapshot = await applyShopifyDashboard(getSampleDashboard(), db, todayFacts, settings, [], now, inputs);
  assert.equal(snapshot.widgets.w029!.kind, 'dial');
  if (snapshot.widgets.w029!.kind === 'dial') assert.equal(snapshot.widgets.w029!.value.v, 1);
});
