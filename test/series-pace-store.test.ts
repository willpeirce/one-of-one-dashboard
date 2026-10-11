import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { appConfig } from '../src/config.js';
import { addDays } from '../src/hero-range.js';
import { missingSeriesPaceWindow, parseSeriesPaceSales, readSeriesPaceFacts, saveSeriesPaceSales, seriesPaceCountry, seriesPaceQuery, snapshotIsLate, takeStockSnapshot } from '../src/series-pace/store.js';
import { ShopifyError } from '../src/shopify/http.js';
import { SampleShopify } from '../src/shopify/sample.js';
import { ShopifyStore } from '../src/shopify/store.js';
import { nextStockSnapshot, ShopifyWorker } from '../src/shopify/worker.js';
import { readSourceHealth, syncSourceHealth } from '../src/sources.js';
import { createTestDatabase } from './helpers/database.js';
const env = () => ({ SHOPIFY_CLIENT_ID: randomUUID(), SHOPIFY_CLIENT_SECRET: randomUUID() });
const now = new Date('2026-09-30T12:00:00Z');
function stock(uk = 130, us = 210) {
  const product = appConfig.shopify.stockProducts.find(value => 'sku' in value && value.sku === 'oneofone1')!;
  return ([['uk', uk], ['us', us]] as const).map(([market, available]) => ({
    productId: `gid://shopify/Product/${product.id}`, variantId: 'gid://shopify/ProductVariant/990001', sku: 'oneofone1', inventoryItemId: 'gid://shopify/InventoryItem/990001', unitCost: null,
    location: { id: appConfig.shopify.locations[market].id }, quantities: [{ name: 'available', quantity: available }, { name: 'on_hand', quantity: available + 4 }],
  }));
}
const table = (rows: unknown[][]) => ({ columns: ['day', 'shipping_country', 'net_items_sold'].map(name => ({ name })), rows });
class PaceReader extends SampleShopify {
  queries: string[] = []; stockCalls: (string | undefined)[] = []; fail = false;
  override async inventory(sku?: string) { this.stockCalls.push(sku); return stock(); }
  override async report(query: string) {
    this.queries.push(query);
    if (this.fail) throw new ShopifyError('denied', 403);
    return super.report(query);
  }
}

test('stock snapshots stay at 00:05 UK over the autumn and spring clock changes', () => {
  assert.equal(nextStockSnapshot(new Date('2026-10-24T12:00:00Z')).toISOString(), '2026-10-24T23:05:00.000Z');
  assert.equal(nextStockSnapshot(new Date('2026-10-25T12:00:00Z')).toISOString(), '2026-10-26T00:05:00.000Z');
  // The spring transition is 28 March; the requested 29 March date remains 00:05 BST.
  assert.equal(nextStockSnapshot(new Date('2027-03-27T12:00:00Z')).toISOString(), '2027-03-28T00:05:00.000Z');
  assert.equal(nextStockSnapshot(new Date('2027-03-28T12:00:00Z')).toISOString(), '2027-03-28T23:05:00.000Z');
  assert.equal(nextStockSnapshot(new Date('2027-03-29T12:00:00Z')).toISOString(), '2027-03-29T23:05:00.000Z');
  assert.equal(snapshotIsLate(new Date('2026-10-24T23:05:00Z')), false);
  assert.equal(snapshotIsLate(new Date('2026-10-25T02:00:00Z')), false);
  assert.equal(snapshotIsLate(new Date('2026-10-25T02:00:01Z')), true);
  assert.equal(snapshotIsLate(new Date('2027-03-28T01:01:00Z')), true);
  assert.equal(snapshotIsLate(new Date('2026-09-29T23:05:00Z'), true), true);
});

test('snapshot stores kit available once per location and UK day, never historical backfill', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const taken = new Date('2026-09-29T23:05:00Z');
  await takeStockSnapshot(db, stock(), taken);
  await takeStockSnapshot(db, stock(1, 2), new Date('2026-09-30T12:00:00Z'), true);
  const rows = (await db.query('SELECT day::text, available, taken_at, late FROM pulse.stock_snapshots ORDER BY available')).rows;
  assert.deepEqual(rows.map(row => [row.day, row.available, row.late]), [['2026-09-30', 130, false], ['2026-09-30', 210, false]]);
  assert.ok(rows.every(row => new Date(row.taken_at as string).toISOString() === taken.toISOString()));
  await takeStockSnapshot(db, stock(120, 190), new Date('2026-10-03T12:00:00Z'), true);
  const days = (await db.query('SELECT DISTINCT day::text FROM pulse.stock_snapshots ORDER BY day')).rows.map(row => row.day);
  assert.deepEqual(days, ['2026-09-30', '2026-10-03']);
  await assert.rejects(takeStockSnapshot(db, stock().map(row => ({ ...row, sku: 'accessory' })), new Date('2026-10-04T12:00:00Z')), ShopifyError);
});

test('new live installs wait until next night; overdue existing jobs catch up today and are late', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  let clock = now; const credentials = env(), reader = new PaceReader();
  let worker = new ShopifyWorker(db, credentials, 'https://pulse.example.test', { reader, clock: () => clock });
  await worker.initialize();
  const scheduled = (await db.query("SELECT next_run_at FROM pulse.shopify_jobs WHERE name='stock_snapshot'")).rows[0]!;
  assert.equal(new Date(scheduled.next_run_at as string).toISOString(), nextStockSnapshot(now).toISOString());
  await db.query("UPDATE pulse.shopify_jobs SET next_run_at='9999-01-01' WHERE name <> 'stock_snapshot'");
  await worker.tick(); assert.equal(reader.stockCalls.length, 0);
  clock = new Date('2026-10-02T00:10:00Z');
  worker = new ShopifyWorker(db, credentials, 'https://pulse.example.test', { reader, clock: () => clock });
  await worker.initialize(); await worker.tick();
  assert.deepEqual(reader.stockCalls, ['oneofone1']);
  assert.deepEqual((await db.query('SELECT day::text, late FROM pulse.stock_snapshots')).rows, [{ day: '2026-10-02', late: true }, { day: '2026-10-02', late: true }]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pulse.stock_snapshots WHERE day < '2026-10-02'")).rows[0]!.n, 0);
  await worker.tick(); assert.equal(reader.stockCalls.length, 1);
  await new ShopifyWorker(db, {}, 'http://localhost:3000', { reader }).initialize();
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pulse.shopify_jobs WHERE mode='sample' AND name IN ('stock_snapshot','series_pace')")).rows[0]!.n, 0);
});

test('daily source prefers usable snapshots, falls back across late/missing pairs and preserves negatives and current inventory', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  await takeStockSnapshot(db, stock(130, 210), new Date('2026-09-27T23:05:00Z'));
  await takeStockSnapshot(db, stock(135, 195), new Date('2026-09-28T23:05:00Z'));
  await takeStockSnapshot(db, stock(100, 180), new Date('2026-09-30T02:30:00Z'));
  await saveSeriesPaceSales(db, table([['2026-09-28', 'GB', 7], ['2026-09-29', 'GB', -2], ['2026-09-29', 'US', 6]]), '2026-09-23', '2026-09-29', now);
  await new ShopifyStore(db, 'live').inventory(stock(93, 178), now);
  const facts = await readSeriesPaceFacts(db, now);
  assert.equal(facts.UK.stock, 93); assert.equal(facts.US.stock, 178);
  assert.deepEqual(facts.UK.days, [{ day: '2026-09-28', sold: -5, source: 'snapshot' }, { day: '2026-09-29', sold: -2, source: 'shopifyql' }]);
  assert.deepEqual(facts.US.days, [{ day: '2026-09-28', sold: 15, source: 'snapshot' }, { day: '2026-09-29', sold: 6, source: 'shopifyql' }]);
  assert.equal(facts.UK.snapshots.at(-1)!.late, true);
  assert.equal(facts.UK.snapshots[0]!.takenAt, '2026-09-27T23:05:00.000Z');
  assert.deepEqual(await missingSeriesPaceWindow(db, now), { from: '2026-09-23', to: '2026-09-29' });
});

test('fallback maps island and EU countries to UK, only US to US, preserves explicit zeros and ignores elsewhere', () => {
  for (const country of ['GB', 'JE', 'GG', 'IM', ...appConfig.shopify.euCountries, 'United Kingdom', 'Jersey']) assert.equal(seriesPaceCountry(country), 'UK');
  assert.equal(seriesPaceCountry('US'), 'US'); assert.equal(seriesPaceCountry('United States'), 'US');
  assert.equal(seriesPaceCountry('CA'), null); assert.equal(seriesPaceCountry(null), null);
  const parsed = parseSeriesPaceSales(table([['2026-09-29', 'GB', 2], ['2026-09-29', 'JE', 1], ['2026-09-29', 'DE', -4], ['2026-09-29', 'US', 0], ['2026-09-29', 'CA', 100]]), '2026-09-29', '2026-09-29');
  assert.deepEqual(parsed, [{ day: '2026-09-29', market: 'UK', sold: -1, source: 'shopifyql' }, { day: '2026-09-29', market: 'US', sold: 0, source: 'shopifyql' }]);
  assert.throws(() => parseSeriesPaceSales(table([['2026-09-29', 'GB', null]]), '2026-09-29', '2026-09-29'), ShopifyError);
});

test('exact kit-product ShopifyQL fixture counts a Duo as two and excludes accessories', async () => {
  const query = seriesPaceQuery('2026-09-28', '2026-09-29');
  assert.equal(query, "FROM sales SHOW net_items_sold WHERE product_title = 'ONE OF ONE' GROUP BY shipping_country TIMESERIES day SINCE 2026-09-28 UNTIL 2026-09-29");
  const rows = parseSeriesPaceSales(await new SampleShopify().report(query), '2026-09-28', '2026-09-29');
  assert.equal(rows.find(row => row.market === 'UK')!.sold, 2);
  assert.equal(rows.filter(row => row.market === 'US').reduce((sum, row) => sum + row.sold, 0), 2);
});

test('fallback attempts at most hourly across failure and restart, retains known sales and cannot fail primary health', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const credentials = env(); await syncSourceHealth(db, credentials);
  await db.query("UPDATE pulse.source_health SET status='healthy', last_success_at=$1 WHERE source='shopify'", [now]);
  let clock = now; const reader = new PaceReader();
  let worker = new ShopifyWorker(db, credentials, 'https://pulse.example.test', { reader, clock: () => clock });
  await worker.initialize();
  await db.query("UPDATE pulse.shopify_jobs SET next_run_at='9999-01-01' WHERE name <> 'series_pace'");
  await worker.tick(); assert.equal(reader.queries.length, 1);
  assert.equal((await readSeriesPaceFacts(db, now)).UK.days.at(-1)!.sold, 2);
  reader.fail = true; clock = new Date(now.getTime() + 3_600_000);
  const logs: string[] = [], previous = console.error; console.error = value => logs.push(String(value));
  try {
    await worker.tick(); assert.equal(reader.queries.length, 2);
    clock = new Date(clock.getTime() + 1000);
    worker = new ShopifyWorker(db, credentials, 'https://pulse.example.test', { reader, clock: () => clock });
    await worker.initialize(); await worker.tick(); assert.equal(reader.queries.length, 2);
  } finally { console.error = previous; }
  assert.deepEqual(logs, ['Shopify series_pace failed (denied, http 403).']);
  assert.equal((await readSeriesPaceFacts(db, now)).UK.days.at(-1)!.sold, 2);
  assert.equal((await readSourceHealth(db))[0]!.status, 'healthy');
  // A primary healthy poll must also ignore a secondary job's persisted failure.
  reader.fail = false;
  await db.query("UPDATE pulse.shopify_jobs SET next_run_at=$1 WHERE name='poll'", [clock]); await worker.tick();
  assert.equal((await readSourceHealth(db))[0]!.status, 'healthy');
});

test('complete usable snapshot window needs no report; missing successful report days stay unknown', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  for (let i = 0; i <= 7; i++) {
    const day = addDays('2026-09-23', i);
    await takeStockSnapshot(db, stock(200 - i * 3, 300 - i * 4), new Date(`${addDays(day, -1)}T23:05:00Z`));
  }
  assert.equal(await missingSeriesPaceWindow(db, now), null);
  const reader = new PaceReader(), worker = new ShopifyWorker(db, env(), 'https://pulse.example.test', { reader, clock: () => now });
  await worker.initialize(); await db.query("UPDATE pulse.shopify_jobs SET next_run_at='9999-01-01' WHERE name <> 'series_pace'"); await worker.tick();
  assert.equal(reader.queries.length, 0);
  await db.query('DELETE FROM pulse.stock_snapshots');
  await saveSeriesPaceSales(db, table([['2026-09-29', 'GB', 4]]), '2026-09-23', '2026-09-29', now);
  const facts = await readSeriesPaceFacts(db, now);
  assert.deepEqual(facts.UK.days, [{ day: '2026-09-29', sold: 4, source: 'shopifyql' }]); assert.deepEqual(facts.US.days, []);
});
