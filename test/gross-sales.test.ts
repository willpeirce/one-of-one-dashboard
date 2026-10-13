import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { dailyRows, shopifyHero, type Facts } from '../src/shopify/metrics.js';
import { cleanOrder, cleanSales, type Order } from '../src/shopify/model.js';
import { fixture, SampleShopify } from '../src/shopify/sample.js';
import { defaultSettings } from '../src/settings.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { dashboardPage } from '../src/dashboard-view.js';
import { applyShopifyDashboard } from '../src/shopify/dashboard.js';
import { ShopifyWorker } from '../src/shopify/worker.js';
import { createTestDatabase } from './helpers/database.js';
import { readSourceHealth, syncSourceHealth } from '../src/sources.js';
const now = new Date('2026-10-01T12:00:00Z');
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: 'GBP' } });
const connection = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
function facts(orders: Order[]): Facts {
  return { mode: 'live', sample: false, counts: {}, pendingWebhooks: 0, geoNotice: null, notices: [], noticeDetails: [], jobs: [{ name: 'backfill', state: { from: '2026-09-01', allOrders: true, ordersDone: true }, last_success_at: now, failures: 0 }], records: orders.map(data => ({ kind: 'order', data, fetched_at: now })) };
}
async function refundedOrder(market: 'UK' | 'US'): Promise<Order> {
  const raw = (await fixture(market === 'UK' ? 'order-uk-tax-inclusive-refund' : 'order-us-tax-exclusive')).data.order;
  raw.id = market === 'UK' ? 'gid://shopify/Order/990301' : 'gid://shopify/Order/990302'; raw.totalPriceSet = money(market === 'UK' ? '114.00' : '118.80');
  raw.refunds[0].refundShippingLines = connection([{ subtotalAmountSet: money('2.00'), taxAmountSet: money(market === 'UK' ? '0.40' : '0.16') }]); return cleanOrder(raw);
}
test('gross includes paid shipping and tax once and subtracts partial item/shipping refunds for inclusive UK and exclusive US orders', async () => {
  const uk = await refundedOrder('UK'), us = await refundedOrder('US');
  const h = shopifyHero(facts([uk, us]), '2026-10-01', '2026-09-30', '2026-09-30', defaultSettings());
  assert.equal(h.net.n, 105); assert.equal(h.gross, 131.04); assert.equal(h.markets!.uk.net.n, 45); assert.equal(h.markets!.uk.gross, 57.60); assert.equal(h.markets!.us.net.n, 60); assert.equal(h.markets!.us.gross, 73.44); assert.equal(h.grossUnavailable, false);
  for (const view of Object.values(h.markets!)) assert.deepEqual(view.net.d.extra!.find(([key]) => key === 'Total sales (incl. shipping and tax)'), ['Total sales (incl. shipping and tax)', view.market === 'uk' ? '£57.60' : view.market === 'us' ? '£73.44' : '£131.04']);
  const alteredTotal = { ...uk, totalPence: 99999 }, changed = shopifyHero(facts([alteredTotal, us]), '2026-10-01', '2026-09-30', '2026-09-30', defaultSettings());
  assert.equal(changed.net.n, h.net.n); assert.equal(changed.net.state, h.net.state); assert.equal(changed.net.ss, h.net.ss); assert.equal(changed.orders.n, h.orders.n);
});
test('gross assigns the original charge and refund to separate UK dates and respects All/UK/US including empty zeroes', async () => {
  const order = await refundedOrder('UK'); order.refunds[0]!.createdAt = '2026-09-30T23:30:00Z';
  const rows = dailyRows(facts([order]), '2026-10-01'); assert.equal(rows.find(row => row.date === '2026-09-30')!.gross, 114); assert.equal(rows.find(row => row.date === '2026-10-01')!.gross, -56.4);
  const original = shopifyHero(facts([order]), '2026-10-01', '2026-09-30', '2026-09-30', defaultSettings()), refund = shopifyHero(facts([order]), '2026-10-01', '2026-10-01', '2026-10-01', defaultSettings());
  assert.equal(original.gross, 114); assert.equal(original.net.n, 90); assert.equal(refund.gross, -56.4); assert.equal(refund.net.n, -45); assert.equal(refund.markets!.uk.gross, -56.4); assert.equal(refund.markets!.us.gross, 0);
  const empty = shopifyHero(facts([]), '2026-10-01', '2026-09-30', '2026-09-30', defaultSettings()); assert.equal(empty.gross, 0); assert.equal(empty.grossUnavailable, false);
  const snapshot = getSampleDashboard(); snapshot.hero.today = empty;
  const html = dashboardPage(snapshot), net = /<button[^>]*data-k="net"[^>]*>([\s\S]*?)<\/button>/.exec(html)![1]!;
  assert.match(net, /class="gross">Total £0\.00<\/span>/); assert.ok(net.indexOf('class="gross"') > net.indexOf('class="sv big"')); assert.doesNotMatch(net, /data-k="gross"|data-sheet="gross"/);
});
test('Shopify full refund total is authoritative and legacy originals have the exact inclusive-tax fallback', async () => {
  const raw = (await fixture('order-uk-tax-inclusive-refund')).data.order; raw.refunds[0].totalRefundedSet = money('57.00'); delete raw.refunds[0].refundShippingLines;
  const order: Order = cleanOrder(raw), h = shopifyHero(facts([order]), '2026-10-01', '2026-09-30', '2026-09-30', defaultSettings());
  assert.equal(order.totalPence, 11400); assert.equal(order.refunds[0]!.totalPence, 5700); assert.equal(h.gross, 57); assert.equal(h.grossUnavailable, false);
  delete order.totalPence; assert.equal(shopifyHero(facts([order]), '2026-10-01', '2026-09-30', '2026-09-30', defaultSettings()).gross, 57);
});
test('older ShopifyQL total sales is gross and absent old totals remain unavailable until read', () => {
  const data = facts([]); data.jobs[0]!.state = { from: '2026-09-25', olderFrom: '2026-09-01', olderTo: '2026-09-24', allOrders: false, ordersDone: true, historyDone: true };
  const table = { columns: [{ name: 'day' }, { name: 'orders' }, { name: 'net_sales' }, { name: 'total_sales' }], rows: [['2026-09-10', 2, '100.00', '126.00']] };
  const cleaned = cleanSales(table); assert.equal(cleaned[0]!.grossSalesPence, 12600); data.records.push({ kind: 'sales', data: cleaned[0]!, fetched_at: now });
  const h = shopifyHero(data, '2026-10-01', '2026-09-10', '2026-09-10', defaultSettings()); assert.equal(h.gross, 126); assert.equal(h.grossUnavailable, false); assert.equal(h.net.n, 100); assert.equal(h.markets!.uk.grossUnavailable, true);
  assert.equal(shopifyHero(data, '2026-10-01', '2026-09-11', '2026-09-11', defaultSettings()).grossUnavailable, true);
});
test('old gross history refresh runs in seven-day blocks, stores authoritative zeroes and resumes after restart without failing source health', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); const credentials = { SHOPIFY_CLIENT_ID: randomUUID(), SHOPIFY_CLIENT_SECRET: randomUUID() }; let clock = new Date('2026-09-30T12:00:00Z');
  class Reader extends SampleShopify { reads: string[] = []; override async report(query: string) { this.reads.push(query); return { columns: [{ name: 'day' }, { name: 'orders' }, { name: 'net_sales' }, { name: 'total_sales' }], rows: query.includes('SINCE 2026-09-01') ? [['2026-09-01', 2, '100.00', '126.00']] : [] }; } }
  const reader = new Reader(); let worker = new ShopifyWorker(db, credentials, 'https://pulse.example.test', { reader, clock: () => clock });
  await syncSourceHealth(db, credentials); await worker.initialize(); await db.query("UPDATE pulse.source_health SET status='healthy',last_success_at=$1 WHERE source='shopify'", [clock]);
  await db.query("UPDATE pulse.shopify_jobs SET next_run_at='9999-01-01' WHERE name <> 'gross_history'"); await db.query("UPDATE pulse.shopify_jobs SET state=$1 WHERE name='backfill'", [JSON.stringify({ from: '2026-09-25', olderFrom: '2026-09-01', olderTo: '2026-09-10', allOrders: false, ordersDone: true, historyDone: true })]); await worker.tick();
  assert.equal(reader.reads.length, 1); assert.match(reader.reads[0]!, /SHOW orders, net_sales, total_sales.*SINCE 2026-09-01 UNTIL 2026-09-07/);
  let stored = (await db.query<{ data: { grossSalesPence: number } }>("SELECT data FROM pulse.shopify_records WHERE kind='sales' ORDER BY source_id")).rows; assert.equal(stored.length, 7); assert.equal(stored[0]!.data.grossSalesPence, 12600); assert.equal(stored[1]!.data.grossSalesPence, 0);
  worker = new ShopifyWorker(db, credentials, 'https://pulse.example.test', { reader, clock: () => clock }); clock = new Date(clock.getTime() + 60_000); await worker.initialize(); await worker.tick();
  assert.equal(reader.reads.length, 2); assert.match(reader.reads[1]!, /SINCE 2026-09-08 UNTIL 2026-09-10/); stored = (await db.query<{ data: { grossSalesPence: number } }>("SELECT data FROM pulse.shopify_records WHERE kind='sales' ORDER BY source_id")).rows;
  assert.equal(stored.length, 10); assert.equal(stored[9]!.data.grossSalesPence, 0); assert.equal((await readSourceHealth(db)).find(row => row.source === 'shopify')!.status, 'healthy');
});
test('gross remains unavailable during first backfill and cannot masquerade as a measured zero', () => {
  const pending = facts([]); pending.jobs[0]!.state.ordersDone = false;
  const hero = shopifyHero(pending, '2026-10-01', '2026-09-30', '2026-09-30', defaultSettings()); for (const view of [hero, ...Object.values(hero.markets!)]) { assert.equal(view.net.unavailable, true); assert.equal(view.grossUnavailable, true); }
});

test('presets before available history keep Gross unavailable in every market sheet', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const raw = (await fixture('order-uk-tax-inclusive-refund')).data.order;
  raw.createdAt = raw.updatedAt = '2026-10-01T09:00:00Z'; raw.refunds = [];
  const data = facts([cleanOrder(raw)]);
  data.jobs[0]!.state.from = '2026-10-01';
  const snapshot = await applyShopifyDashboard(getSampleDashboard(), db, data, defaultSettings(), [], now);
  assert.equal(snapshot.hero.today.gross, 114);
  assert.equal(snapshot.hero.today.grossUnavailable, false);
  for (const period of ['yday', '7d', '30d'] as const) {
    for (const view of [snapshot.hero[period], ...Object.values(snapshot.hero[period].markets!)]) {
      assert.equal(view.grossUnavailable, true);
      assert.equal(view.net.unavailable, true);
      const row = view.net.d.extra!.find(([label]) => label === 'Total sales (incl. shipping and tax)');
      assert.ok(row);
      assert.match(row[1], /Unavailable.*history unavailable/);
      assert.doesNotMatch(row[1], /£/);
    }
  }
});
test('an empty report without the gross column preserves cached historical money and retry position', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); const credentials = { SHOPIFY_CLIENT_ID: randomUUID(), SHOPIFY_CLIENT_SECRET: randomUUID() }; const clock = new Date('2026-09-30T12:00:00Z');
  class Reader extends SampleShopify { override async report() { return { columns: [{ name: 'day' }, { name: 'orders' }, { name: 'net_sales' }], rows: [] }; } }
  const worker = new ShopifyWorker(db, credentials, 'https://pulse.example.test', { reader: new Reader(), clock: () => clock }); await worker.initialize();
  await db.query("UPDATE pulse.shopify_jobs SET next_run_at='9999-01-01' WHERE name <> 'gross_history'"); await db.query("UPDATE pulse.shopify_jobs SET state=$1 WHERE name='backfill'", [JSON.stringify({ from: '2026-09-25', olderFrom: '2026-09-01', olderTo: '2026-09-07', allOrders: false, ordersDone: true, historyDone: true })]);
  await worker.store.put('sales', '2026-09-01', { day: '2026-09-01', netSalesPence: 10000, orders: 2 }, clock);
  const logs: string[] = []; t.mock.method(console, 'error', (line: string) => logs.push(line)); await worker.tick();
  const rows = (await db.query<{ data: { netSalesPence: number; grossSalesPence?: number } }>("SELECT data FROM pulse.shopify_records WHERE kind='sales'")).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0]!.data.netSalesPence, 10000); assert.equal(rows[0]!.data.grossSalesPence, undefined);
  const job = (await db.query<{ state: { next?: string }; failures: number }>("SELECT state,failures FROM pulse.shopify_jobs WHERE name='gross_history'")).rows[0]!;
  assert.equal(job.state.next, '2026-09-01'); assert.equal(job.failures, 1); assert.deepEqual(logs, []);
});
test('cached orders with complete tags and shipping fields still refresh an absent original refund charge total', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); const raw = (await fixture('order-uk-tax-inclusive-refund')).data.order; raw.refunds[0].totalRefundedSet = money('57.00');
  const original: Order = cleanOrder(raw); delete original.refunds[0]!.totalPence; const credentials = { SHOPIFY_CLIENT_ID: randomUUID(), SHOPIFY_CLIENT_SECRET: randomUUID() };
  class Reader extends SampleShopify { reads = 0; override async order() { this.reads++; return raw; } }
  const reader = new Reader(), worker = new ShopifyWorker(db, credentials, 'https://pulse.example.test', { reader, clock: () => now });
  await worker.initialize(); await worker.store.put('order', original.id, original, now, new Date(original.updatedAt)); await db.query("UPDATE pulse.shopify_jobs SET next_run_at='9999-01-01' WHERE name <> 'shipping_refunds'"); await db.query("UPDATE pulse.shopify_jobs SET state=$1 WHERE name='backfill'", [JSON.stringify({ from: '2026-09-01', address: true })]); await worker.tick();
  assert.equal(reader.reads, 1); const updated = (await db.query<{ data: Order }>("SELECT data FROM pulse.shopify_records WHERE kind='order'")).rows[0]!.data; assert.equal(updated.refunds[0]!.totalPence, 5700);
});
