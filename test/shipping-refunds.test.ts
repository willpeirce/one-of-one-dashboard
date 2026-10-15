import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { applySpend } from '../src/ad-spend/metrics.js';
import { sampleSpend } from '../src/ad-spend/store.js';
import { defaultSettings } from '../src/settings.js';
import { profitAndMargin } from '../src/profit.js';
import { cleanOrder, type Order } from '../src/shopify/model.js';
import { fixture, SampleShopify } from '../src/shopify/sample.js';
import { dailyRows, shopifyHero, type Facts } from '../src/shopify/metrics.js';
import { ShopifyWorker } from '../src/shopify/worker.js';
import { ShopifyError } from '../src/shopify/http.js';
import { readSourceHealth, syncSourceHealth } from '../src/sources.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2026-09-30T12:00:00Z');
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: 'GBP' } });
const connection = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
const settings = { ...defaultSettings(), paymentFeePercent: 2,
  startingCogs: [{ sku: 'sample-refund-kit', unitCostGbp: 10 }] };
function facts(orders: Order[]): Facts {
  return { mode: 'live', sample: false, counts: {}, pendingWebhooks: 0, geoNotice: null, notices: [], noticeDetails: [],
    jobs: [{ name: 'backfill', state: { from: '2026-09-01', allOrders: true, ordersDone: true }, last_success_at: now, failures: 0 }],
    records: orders.map(data => ({ kind: 'order', data, fetched_at: now })) };
}
async function rawOrder(taxesIncluded = true): Promise<any> {
  const raw = (await fixture('order')).data.order;
  raw.createdAt = '2026-09-30T09:00:00Z'; raw.updatedAt = now.toISOString();
  raw.displayFinancialStatus = 'PARTIALLY_REFUNDED'; raw.taxesIncluded = taxesIncluded;
  raw.subtotalPriceSet = money(taxesIncluded ? '120.00' : '100.00');
  raw.lineItems.nodes[0].taxLines = [{ priceSet: money('20.00') }];
  raw.lineItems.nodes[0].sku = 'sample-refund-kit'; raw.lineItems.nodes[0].quantity = 1;
  raw.totalTaxSet = money('21.00'); raw.totalShippingPriceSet = money(taxesIncluded ? '6.00' : '5.00');
  raw.refunds = [{ id: 'gid://shopify/Refund/990001', createdAt: '2026-09-30T10:00:00Z',
    refundLineItems: connection([]), refundShippingLines: connection([
      { subtotalAmountSet: money('2.00'), taxAmountSet: money('0.40') },
    ]) }];
  return raw;
}
function margin(orders: Order[], day = '2026-09-30') {
  const h = shopifyHero(facts(orders), '2026-09-30', day, day, settings);
  const spend = sampleSpend(day, day); spend.rows = [{ ...spend.rows[0]!, amount: '20.000000' }];
  // Pass raw stored orders too: applySpend must share net sales' eligibility predicate.
  applySpend(h, orders, settings, '2026-10-09', { spend, costs: [],
    estimates: orders.map(order => ({ orderId: order.id, costPence: 500, source: 'exact' })), now });
  return h;
}

test('shipping refund subtotal is already net of tax for inclusive and exclusive orders', async () => {
  for (const taxesIncluded of [true, false]) {
    const order = cleanOrder(await rawOrder(taxesIncluded));
    assert.equal(order.refunds[0].shippingNetPence, 200);
    assert.equal(order.refunds[0].shippingTaxPence, 40);
    const hero = margin([order]);
    assert.equal(hero.net.n, 100); assert.equal(hero.margin.n, 66); assert.equal(hero.profit.n, 66);
    assert.deepEqual(hero.margin.d.extra!.find(([label]) => label === 'Shipping charged'),
      ['Shipping charged', '£3.00 · net of tax; £2.00 shipping refunds deducted']);
    assert.equal(profitAndMargin({ netSales: 100, shippingIncome: 5, shippingRefunds: 2 }).profit, 103);
  }
});

test('shipping refunds reduce the refund UK day even for an earlier order and never change net sales', async () => {
  const earlier = cleanOrder(await rawOrder());
  earlier.day = '2026-09-28'; earlier.refunds[0]!.createdAt = '2026-09-29T23:30:00Z';
  const current = { ...earlier, id: 'gid://shopify/Order/990002', day: '2026-09-30', shippingPence: 0, refunds: [] };
  const hero = margin([earlier, current]);
  assert.equal(hero.net.n, 100); assert.equal(hero.profit.n, 61);
  assert.equal(hero.contribution.n, 81);
  assert.deepEqual(hero.contribution.d.extra!.slice(0, 3), [
    ['Net sales', '£100.00'], ['Shipping income net of tax', '£0.00'], ['Shipping refunds', '£2.00'],
  ]);
  assert.match(hero.margin.d.extra!.find(([label]) => label === 'Shipping charged')![1], /^-£2.00/);
  const before = margin([earlier], '2026-09-28');
  assert.equal(before.net.n, 100); assert.equal(before.profit.n, 68);
});

test('unpaid orders add neither net sales nor margin shipping, costs or fees', async () => {
  const paid = cleanOrder(await rawOrder());
  const unpaid = ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'VOIDED', 'EXPIRED'].map((financialStatus, i) => ({
    ...paid, id: `gid://shopify/Order/${990010 + i}`, financialStatus, shippingPence: 90000,
    itemsAfterDiscountsPence: 90000, lines: [{ ...paid.lines[0]!, quantity: 100 }],
    refunds: [{ ...paid.refunds[0]!, shippingNetPence: 80000 }],
  }));
  assert.deepEqual(dailyRows(facts([paid, ...unpaid]), '2026-09-30'), dailyRows(facts([paid]), '2026-09-30'));
  const baseline = margin([paid]), withUnpaid = margin([paid, ...unpaid]);
  assert.deepEqual(withUnpaid.margin, baseline.margin);
  assert.deepEqual(withUnpaid.profit, baseline.profit);
  assert.deepEqual(withUnpaid.contribution, baseline.contribution);
  assert.equal(withUnpaid.net.n, baseline.net.n);
});

test('legacy shipping refund enrichment is bounded, resumes after restart, and skips completed orders', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  let clock = now;
  const raw = await rawOrder(), credentials = { SHOPIFY_CLIENT_ID: randomUUID(), SHOPIFY_CLIENT_SECRET: randomUUID() };
  class Reader extends SampleShopify {
    reads: string[] = [];
    override async order(id: string) { this.reads.push(id); return { ...raw, id }; }
  }
  const reader = new Reader();
  let worker = new ShopifyWorker(db, credentials, 'https://pulse.example.test', { reader, clock: () => clock });
  await worker.initialize(); assert.equal(reader.reads.length, 0);
  await db.query("UPDATE pulse.shopify_jobs SET next_run_at='9999-01-01' WHERE name <> 'shipping_refunds'");
  await db.query("UPDATE pulse.shopify_jobs SET state=$1 WHERE name='backfill'", [JSON.stringify({ from: '2026-09-01', address: true })]);
  for (const id of ['gid://shopify/Order/990021', 'gid://shopify/Order/990022']) {
    const legacy = cleanOrder({ ...raw, id }); delete legacy.refunds[0]!.shippingNetPence;
    await worker.store.put('order', id, legacy, now);
  }
  await worker.tick(); assert.equal(reader.reads.length, 1);
  const first = (await db.query<{ data: Order }>("SELECT data FROM pulse.shopify_records WHERE source_id=$1", [reader.reads[0]!])).rows[0]!.data;
  assert.equal(first.refunds[0]!.shippingNetPence, 200);
  worker = new ShopifyWorker(db, credentials, 'https://pulse.example.test', { reader, clock: () => clock });
  await worker.initialize(); clock = new Date(now.getTime() + 60_000); await worker.tick();
  assert.deepEqual(reader.reads, ['gid://shopify/Order/990021', 'gid://shopify/Order/990022']);
  for (let i = 0; i < 3; i++) { clock = new Date(clock.getTime() + 60_000); await worker.tick(); }
  assert.equal(reader.reads.length, 2);
  const idle = (await db.query<{ state: { idle: boolean }; last_success_at: Date; next_run_at: Date }>(
    "SELECT state,last_success_at,next_run_at FROM pulse.shopify_jobs WHERE name='shipping_refunds' AND mode='live'")).rows[0]!;
  assert.equal(idle.state.idle, true);
  assert.equal(new Date(idle.last_success_at).getTime(), now.getTime() + 120_000);
  assert.equal(new Date(idle.next_run_at).getTime() - new Date(idle.last_success_at).getTime(), 3_600_000);
});

test('denied historical refund reads keep unknowns and back off without changing Shopify health', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const credentials = { SHOPIFY_CLIENT_ID: randomUUID(), SHOPIFY_CLIENT_SECRET: randomUUID() };
  let calls = 0;
  class Reader extends SampleShopify {
    override async order() { calls++; throw new ShopifyError('denied', 403); }
  }
  const worker = new ShopifyWorker(db, credentials, 'https://pulse.example.test', { reader: new Reader(), clock: () => now });
  await syncSourceHealth(db, credentials);
  await db.query("UPDATE pulse.source_health SET status='healthy', last_success_at=$1 WHERE source='shopify'", [now]);
  await worker.initialize(); await db.query("UPDATE pulse.shopify_jobs SET next_run_at='9999-01-01' WHERE name <> 'shipping_refunds'");
  await db.query("UPDATE pulse.shopify_jobs SET state=$1 WHERE name='backfill'", [JSON.stringify({ from: '2026-09-01', address: false })]);
  const legacy = cleanOrder(await rawOrder()); delete legacy.refunds[0]!.shippingNetPence;
  await worker.store.put('order', legacy.id, legacy, now);
  const logs: string[] = []; t.mock.method(console, 'error', (line: string) => logs.push(line));
  await worker.tick(); await worker.tick(); assert.equal(calls, 1);
  assert.deepEqual(logs, ['Shopify shipping_refunds failed (denied, http 403).']);
  assert.equal((await readSourceHealth(db)).find(row => row.source === 'shopify')!.status, 'healthy');
  const job = (await db.query<{ next_run_at: Date }>("SELECT next_run_at FROM pulse.shopify_jobs WHERE name='shipping_refunds'")).rows[0]!;
  assert.equal(new Date(job.next_run_at).getTime() - now.getTime(), 3_600_000);
  const stored = (await db.query<{ data: Order }>("SELECT data FROM pulse.shopify_records WHERE source_id=$1", [legacy.id])).rows[0]!.data;
  assert.equal(stored.refunds[0]!.shippingNetPence, undefined);
  assert.match(margin([stored]).margin.ss, /older shipping refund detail/);
});
