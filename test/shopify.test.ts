import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { appConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { readRuntime } from '../src/runtime.js';
import { readSourceHealth, syncSourceHealth } from '../src/sources.js';
import { ShopifyClient, orderFields, type Page } from '../src/shopify/client.js';
import { Transport, ShopifyError } from '../src/shopify/http.js';
import { TokenManager } from '../src/shopify/token.js';
import { cleanOrder, cleanInventory, cleanSessions } from '../src/shopify/model.js';
import { fixture, SampleShopify } from '../src/shopify/sample.js';
import { ShopifyStore } from '../src/shopify/store.js';
import { backfillWindow, nextNight, ShopifyWorker, sessionQuery, ukDayStart } from '../src/shopify/worker.js';
import { replayPayload, validSignature, webhookTopics } from '../src/shopify/webhooks.js';
import { createTestDatabase } from './helpers/database.js';
const credentials = () => ({ SHOPIFY_CLIENT_ID: randomUUID(), SHOPIFY_CLIENT_SECRET: randomUUID() });
const noSleep = async (_ms: number) => {};
const now = new Date(appConfig.shopify.sampleNow);
class Reader extends SampleShopify {
  grants = ['read_all_orders'];
  calls: { query: string; after: string | null; address: boolean }[] = [];
  created: { topic: string; uri: string }[] = [];
  listed: any[] = [];
  pages: Page[] = [];
  deniedAddress = false;
  deniedReports = false;
  broken = false;
  override async scopes() { return this.grants; }
  override async orders(query: string, after: string | null, address: boolean) {
    this.calls.push({ query, after, address });
    if (this.broken) throw new Error('Private diagnostic');
    if (address && this.deniedAddress) throw new ShopifyError('denied');
    return this.pages.shift() ?? super.orders(query, after, address);
  }
  override async report(query: string) { if (this.deniedReports) throw new ShopifyError('denied'); return super.report(query); }
  override async subscriptions() { return { nodes: this.listed, pageInfo: { hasNextPage: false, endCursor: null } }; }
  override async subscribe(topic: string, uri: string) { this.created.push({ topic, uri }); this.listed.push({ topic, endpoint: { callbackUrl: uri } }); }
}

test('token grant uses form encoding, one exchange for concurrent calls, renews at 20 hours and never persists credentials', async () => {
  let time = 0, exchanges = 0;
  const env = credentials(), token = randomUUID();
  const transport = new Transport({ now: () => time, sleep: noSleep, fetch: async (url, init) => {
    exchanges++;
    assert.equal(String(url), `https://${appConfig.shopify.storeDomain}/admin/oauth/access_token`);
    assert.equal(init?.method, 'POST');
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get('grant_type'), 'client_credentials'); assert.equal(form.get('client_id'), env.SHOPIFY_CLIENT_ID);
    assert.equal(form.get('client_secret'), env.SHOPIFY_CLIENT_SECRET);
    return Response.json({ ...await fixture('token'), access_token: token });
  } });
  const manager = new TokenManager(env, transport);
  assert.deepEqual(await Promise.all([manager.get(), manager.get(), manager.get()]), [token, token, token]);
  time = 20 * 3600_000 - 1; await manager.get(); assert.equal(exchanges, 1);
  time++; await manager.get(); assert.equal(exchanges, 2);
  manager.invalidate(); await manager.get(); assert.equal(exchanges, 3);
});

test('transport has 3 retries, safe errors/request ids, abort timeout, HTTP rate limits and GraphQL throttle budget', async () => {
  const delays: number[] = [], logs: unknown[] = []; let calls = 0;
  const privateDetail = randomUUID();
  const transport = new Transport({ now: () => 0, sleep: async ms => { delays.push(ms); }, log: entry => { logs.push(entry); }, fetch: async (_url, init) => {
    assert.ok(init?.signal); assert.equal(init?.redirect, 'error'); calls++;
    return new Response(privateDetail, { status: calls === 1 ? 429 : 503, headers: { 'retry-after': '2', 'x-request-id': 'request-123' } });
  } });
  await assert.rejects(transport.request('https://example.invalid', {}), e => e instanceof ShopifyError && !e.message.includes(privateDetail));
  assert.equal(calls, 4); assert.ok(delays.includes(2000)); assert.ok(delays.includes(250)); assert.ok(delays.includes(500)); assert.ok(delays.includes(1000));
  assert.ok(!JSON.stringify(logs).includes(privateDetail));
  const throttle = new Transport({ now: () => 0, sleep: async ms => { delays.push(ms); }, fetch: async () => Response.json({ data: {}, extensions: { cost: { requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 0, restoreRate: 50 } } } }) });
  await throttle.request('https://example.invalid', {}); await throttle.request('https://example.invalid', {});
  assert.equal(delays.at(-1), 2000);
  let attempts = 0;
  const denied = new Transport({ sleep: noSleep, fetch: async () => { attempts++; return Response.json({ errors: [{ message: privateDetail, extensions: { code: 'ACCESS_DENIED' } }] }); } });
  await assert.rejects(denied.request('https://example.invalid', {}), e => e instanceof ShopifyError && e.code === 'denied' && !e.message.includes(privateDetail)); assert.equal(attempts, 1);
});

test('401 renews once; read client allows only fixed queries and owned subscription creation', async () => {
  const sent: any[] = []; let grants = 0, unauthorized = true;
  const transport = new Transport({ sleep: noSleep, fetch: async (url, init) => {
    if (String(url).endsWith('access_token')) { grants++; return Response.json({ ...await fixture('token'), access_token: randomUUID() }); }
    assert.ok(String(url).includes('/2026-10/graphql.json'));
    const request = JSON.parse(String(init?.body)); sent.push(request);
    if (unauthorized) { unauthorized = false; return new Response('', { status: 401 }); }
    return Response.json(await fixture(request.query.startsWith('mutation') ? 'subscription-created' : 'scopes'));
  } });
  const client = new ShopifyClient(transport, credentials(), 'https://pulse.example.test');
  assert.ok((await client.scopes()).includes('read_all_orders')); assert.equal(grants, 2);
  await client.subscribe('ORDERS_CREATE', 'https://pulse.example.test/webhooks/shopify');
  assert.equal(sent.filter(x => x.query.startsWith('mutation')).length, 1);
  assert.equal(sent.at(-1).variables.input.callbackUrl, 'https://pulse.example.test/webhooks/shopify');
  assert.deepEqual(sent.at(-1).variables.input.includeFields, ['id', 'admin_graphql_api_id']);
  assert.equal('graphql' in client, false);
  await assert.rejects(client.subscribe('ORDERS_CREATE', 'https://other.example.test/webhooks/shopify'));
  await assert.rejects(client.subscribe('PRODUCTS_CREATE', 'https://pulse.example.test/webhooks/shopify'));
  assert.ok(!/\b(name|email|phone|address1|address2|city)\b/.test(orderFields(true)));
  assert.ok(!orderFields(false).includes('shippingAddress'));
});

test('4.1 UK days and nightly reconcile follow Europe/London through both clock changes', () => {
  assert.equal(cleanOrder({ ...(orderStub()), createdAt: '2026-10-24T23:30:00Z' }).day, '2026-10-25');
  assert.equal(cleanOrder({ ...(orderStub()), createdAt: '2026-10-25T23:30:00Z' }).day, '2026-10-25');
  assert.equal(ukDayStart('2026-10-25').toISOString(), '2026-10-24T23:00:00.000Z');
  assert.equal(ukDayStart('2026-10-26').toISOString(), '2026-10-26T00:00:00.000Z');
  assert.equal(nextNight(new Date('2026-10-24T12:00:00Z')).toISOString(), '2026-10-24T23:01:00.000Z');
  assert.equal(nextNight(new Date('2026-10-25T12:00:00Z')).toISOString(), '2026-10-26T00:01:00.000Z');
  assert.equal(nextNight(new Date('2027-03-28T12:00:00Z')).toISOString(), '2027-03-28T23:01:00.000Z');
});
function orderStub(): any {
  const m = { shopMoney: { amount: '1.00', currencyCode: 'GBP' } };
  return { id: 'gid://shopify/Order/900001', createdAt: now.toISOString(), updatedAt: now.toISOString(), test: false, displayFinancialStatus: 'PAID', currencyCode: 'GBP', taxesIncluded: false, subtotalPriceSet: m, totalTaxSet: m, totalShippingPriceSet: m, lineItems: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, refunds: [], fulfillments: [], customAttributes: [] };
}

test('section 5: UK tax-inclusive items and partial returns exclude item VAT and paid shipping VAT', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const raw = (await fixture('order-uk-tax-inclusive-refund')).data.order;
  await new ShopifyStore(db, 'sample').orders([raw], now);
  const order = (await db.query("SELECT data FROM pulse.shopify_records WHERE kind = 'order'")).rows[0]!.data as ReturnType<typeof cleanOrder>;
  assert.equal(order.taxesIncluded, true);
  assert.equal(order.itemTaxPence, 1800); assert.equal(order.taxPence, 1900); assert.equal(order.shippingPence, 600);
  // £120 gross less £12 discounts includes £18 item VAT; £6 shipping includes £1 VAT.
  assert.equal(order.itemsAfterDiscountsPence, 9000);
  assert.equal(order.refunds[0].taxPence, 900); assert.equal(order.refunds[0].itemsPence, 4500);
  assert.equal(order.itemsAfterDiscountsPence - order.refunds.reduce((n: number, r: any) => n + r.itemsPence, 0), 4500);
  // Shipping and its VAT cannot affect net item sales, including after a return.
  const changedShipping = structuredClone(raw);
  changedShipping.totalShippingPriceSet.shopMoney.amount = '12.00'; changedShipping.totalTaxSet.shopMoney.amount = '20.00';
  assert.equal(cleanOrder(changedShipping).itemsAfterDiscountsPence, 9000);
  assert.deepEqual(cleanOrder(changedShipping).refunds, order.refunds);
  assert.throws(() => cleanOrder({ ...raw, taxesIncluded: undefined }), ShopifyError);
  const missingItemTax = structuredClone(raw); delete missingItemTax.lineItems.nodes[0].taxLines;
  assert.throws(() => cleanOrder(missingItemTax), ShopifyError);
});

test('section 5: US tax-exclusive items and partial returns never subtract separately charged sales tax', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const raw = (await fixture('order-us-tax-exclusive')).data.order;
  await new ShopifyStore(db, 'live').orders([raw], now);
  const order = (await db.query("SELECT data FROM pulse.shopify_records WHERE kind = 'order'")).rows[0]!.data as ReturnType<typeof cleanOrder>;
  assert.equal(order.market, 'US'); assert.equal(order.taxesIncluded, false);
  assert.equal(order.itemTaxPence, 800); assert.equal(order.taxPence, 880); assert.equal(order.shippingPence, 1000);
  assert.equal(order.itemsAfterDiscountsPence, 10000);
  assert.equal(order.refunds[0].taxPence, 320); assert.equal(order.refunds[0].itemsPence, 4000);
  assert.equal(order.itemsAfterDiscountsPence - order.refunds.reduce((n: number, r: any) => n + r.itemsPence, 0), 6000);
  const exempt = structuredClone(raw); exempt.lineItems.nodes[0].taxLines = []; exempt.totalTaxSet.shopMoney.amount = '0.00'; exempt.refunds = [];
  assert.equal(cleanOrder(exempt).itemsAfterDiscountsPence, 10000);
});

test('4.2 privacy strips webhook personal data, preserves only replay ids and checks original-byte HMAC', async () => {
  const secret = randomUUID(), bytes = Buffer.from(JSON.stringify(await fixture('webhook-order')));
  const signature = createHmac('sha256', secret).update(bytes).digest('base64');
  assert.ok(validSignature(bytes, signature, secret)); assert.ok(!validSignature(Buffer.concat([bytes, Buffer.from(' ')]), signature, secret));
  assert.ok(!validSignature(bytes, 'malformed', secret)); assert.ok(!validSignature(bytes, signature, randomUUID()));
  for (const topic of Object.keys(webhookTopics) as (keyof typeof webhookTopics)[]) {
    const name = topic.startsWith('orders/') ? 'webhook-order' : topic.startsWith('fulfillments/') ? 'webhook-fulfillment' : topic.startsWith('refunds/') ? 'webhook-refund' : 'webhook-inventory';
    const projection = replayPayload(topic, await fixture(name));
    assert.ok(!JSON.stringify(projection).includes('Invented')); assert.ok(!JSON.stringify(projection).includes('example.invalid'));
    if (topic === 'inventory_levels/update') assert.ok(projection.inventoryItemId); else assert.equal(projection.orderId, 'gid://shopify/Order/900001');
  }
});

test('4.2 addresses keep outward postcode only, fallback markets use currency/warehouse; tier mix uses ordered product', async () => {
  const raw = (await fixture('order')).data.order;
  raw.name = 'Invented Fixture'; raw.email = 'fixture-person@example.invalid'; raw.phone = 'fixture-only'; raw.shippingAddress.address1 = 'Fictional Street';
  raw.customAttributes.push({ key: 'private-note', value: 'Invented Fixture' });
  const clean = cleanOrder(raw);
  assert.equal(clean.postcodeArea, 'SW1A'); assert.equal(clean.market, 'UK'); assert.equal(clean.marketBasis, 'country');
  assert.equal(clean.lines[0].productId, 'gid://shopify/Product/10896502063438'); assert.equal(clean.giftTest, 'A');
  const stored = JSON.stringify(clean); for (const text of ['Invented', 'example.invalid', 'Fictional', '1AA', 'private-note']) assert.ok(!stored.includes(text));
  raw.shippingAddress.zip = 'SW1A1AA'; assert.equal(cleanOrder(raw).postcodeArea, 'SW1A');
  delete raw.shippingAddress; raw.currencyCode = 'USD'; assert.equal(cleanOrder(raw).market, 'US');
  raw.currencyCode = 'EUR'; raw.fulfillments = [{ id: 'gid://shopify/Fulfillment/900001', status: 'SUCCESS', createdAt: now.toISOString(), updatedAt: now.toISOString(), location: { id: appConfig.shopify.locations.uk.id } }];
  assert.equal(cleanOrder(raw).market, 'UK');
  raw.shippingAddress = { countryCodeV2: 'FR' }; assert.equal(cleanOrder(raw).market, 'EU');
  raw.shippingAddress = { countryCodeV2: 'AU' }; assert.equal(cleanOrder(raw).market, 'unknown');
});

test('4.2 stock includes configured products and J&J locations only; TikTok duplicates remain order lines', async () => {
  const reader = new SampleShopify(); const row = (await reader.inventory())[0];
  assert.equal(cleanInventory(row)?.quantities[0].quantity, 120);
  assert.equal(cleanInventory({ ...row, productId: `gid://shopify/Product/${appConfig.shopify.tiktokOrderOnlyProductIds[0]}` }), null);
  assert.equal(cleanInventory({ ...row, location: { id: 'gid://shopify/Location/999' } }), null);
  const raw = (await fixture('order')).data.order; raw.lineItems.nodes[0].product.id = `gid://shopify/Product/${appConfig.shopify.tiktokOrderOnlyProductIds[0]}`;
  assert.equal(cleanOrder(raw).lines.length, 1);
});

test('4.2 session guards mask both broken dates and Missouri above 10%; exclude only the phantom pattern', async () => {
  const table = (await fixture('sessions')).data.shopifyqlQuery.tableData;
  const clean = cleanSessions(table)[0]; assert.equal(clean.sessions, 152); assert.equal(clean.us, 52); assert.equal(clean.marketReliable, true);
  for (const date of ['2026-09-22', '2026-09-23']) {
    const copy = structuredClone(table); copy.rows.forEach((r: any) => { r[0] = date; }); assert.equal(cleanSessions(copy)[0].marketReliable, false);
  }
  const copy = structuredClone(table); copy.rows[2][6] = 20; assert.equal(cleanSessions(copy)[0].marketReliable, false);
  copy.rows[3][7] = 1; assert.equal(cleanSessions(copy)[0].sessions, 370);
  copy.rows[3][7] = 0; copy.rows[3][4] = 'mobile'; assert.equal(cleanSessions(copy)[0].sessions, 370);
  // Live 5 Oct: Shopify rejected `device_type` ("Column Not Found"); its sessions column is `session_device_type`.
  const groups = ['day', 'session_country', 'session_region', 'landing_page_path', 'session_device_type', 'referrer_source'];
  assert.ok(sessionQuery('2026-09-29', '2026-09-30').includes(`GROUP BY ${groups.join(', ')} SINCE`));
  assert.deepEqual(table.columns.slice(0, groups.length).map((c: any) => c.name), groups);
});

test('400-day/60-day backfill checkpoints survive restart and fall back to ShopifyQL history', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); const env = credentials(); await syncSourceHealth(db, env);
  let clock = now; const reader = new Reader(); reader.grants = ['read_orders'];
  const raw = (await fixture('orders')).data.orders;
  reader.pages.push({ ...raw, pageInfo: { hasNextPage: true, endCursor: 'page-two' } });
  let worker = new ShopifyWorker(db, env, 'https://pulse.example.test', { reader, clock: () => clock });
  await worker.initialize(); await worker.tick();
  const checkpoint = (await db.query("SELECT state FROM pulse.shopify_jobs WHERE name = 'backfill'")).rows[0]!.state as any;
  assert.equal(checkpoint.after, 'page-two'); assert.equal(checkpoint.allOrders, false);
  assert.equal(checkpoint.from, backfillWindow(now, false).from);
  clock = new Date(now.getTime() + 2000);
  worker = new ShopifyWorker(db, env, 'https://pulse.example.test', { reader, clock: () => clock }); await worker.initialize(); await worker.tick();
  assert.ok(reader.calls.some(c => c.after === 'page-two'));
  const summary = await worker.store.summary(); assert.equal(summary.counts.order, 1); assert.equal(summary.counts.sales, 1);
  assert.equal((await readSourceHealth(db))[0]!.status, 'healthy');
  assert.equal(backfillWindow(now, true).from, '2025-08-27'); assert.equal(backfillWindow(now, false).from, '2026-08-02');
  const rows = (await db.query('SELECT * FROM pulse.shopify_records')).rows;
  assert.ok(rows.every(r => r.source === 'shopify' && r.brand === 'one-of-one' && r.fetched_at));
  for (const value of Object.values(env)) assert.ok(!JSON.stringify(rows).includes(value));
});

test('address denial retries without address; Level 2 denial retains unknown reports and retries slowly', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); const env = credentials(); await syncSourceHealth(db, env);
  const reader = new Reader(); reader.grants = ['read_orders']; reader.deniedAddress = true; reader.deniedReports = true;
  const worker = new ShopifyWorker(db, env, 'https://pulse.example.test', { reader, clock: () => now }); await worker.initialize(); await worker.tick();
  assert.ok(reader.calls.some(c => !c.address)); const summary = await worker.store.summary();
  assert.ok(summary.notices.includes('address_unavailable')); assert.ok(summary.notices.includes('reports_unavailable')); assert.equal(summary.counts.sessions, undefined); assert.equal(summary.counts.sales, undefined);
  const sessions = (await db.query("SELECT next_run_at FROM pulse.shopify_jobs WHERE name = 'sessions'")).rows[0]!;
  assert.equal(new Date(sessions.next_run_at as string).getTime(), now.getTime() + 3_600_000);
  assert.equal((await readSourceHealth(db))[0]!.status, 'error');
});

test('5-minute overlap poll, hourly missing-subscription repair, nightly reconcile and failure recovery', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); const env = credentials(); await syncSourceHealth(db, env);
  let clock = now; const reader = new Reader(); const worker = new ShopifyWorker(db, env, 'https://pulse.example.test', { reader, clock: () => clock });
  await worker.initialize(); await worker.tick(); assert.equal(reader.created.length, 7);
  assert.ok(reader.created.every(s => s.uri === 'https://pulse.example.test/webhooks/shopify'));
  assert.ok(reader.calls.some(c => c.query.includes('updated_at:>=2026-09-30T11:50:00.000Z')));
  assert.ok(reader.calls.some(c => c.query.startsWith('created_at:>=2026-09-22T23:00:00.000Z')));
  const count = reader.calls.length; clock = new Date(now.getTime() + 299_999); await worker.tick(); assert.equal(reader.calls.length, count);
  clock = new Date(now.getTime() + 300_000); reader.broken = true; await worker.tick(); assert.equal((await readSourceHealth(db))[0]!.status, 'error');
  reader.broken = false; clock = new Date(now.getTime() + 360_000); await worker.tick(); assert.equal((await readSourceHealth(db))[0]!.status, 'healthy');
  reader.listed.pop(); clock = new Date(now.getTime() + 3_600_000); await worker.tick(); assert.equal(reader.created.length, 8);
  assert.ok((await worker.store.summary()).notices.includes('webhook_recreated'));
  clock = nextNight(now); await worker.tick(); assert.ok(reader.calls.some(c => c.query.startsWith('created_at:>=2026-09-23T23:00:00.000Z')));
});

test('ingest is idempotent and stale updates cannot overwrite cancellations/refunds', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); const store = new ShopifyStore(db, 'live');
  const raw = (await fixture('order')).data.order; await store.orders([raw, raw], now);
  const newer = structuredClone(raw); newer.updatedAt = '2026-09-30T12:30:00Z'; newer.cancelledAt = newer.updatedAt; newer.displayFinancialStatus = 'REFUNDED';
  newer.refunds = [{ id: 'gid://shopify/Refund/900001', createdAt: newer.updatedAt, refundLineItems: { nodes: [{ quantity: 1, subtotalSet: { shopMoney: { amount: '79.95', currencyCode: 'GBP' } }, totalTaxSet: { shopMoney: { amount: '13.33', currencyCode: 'GBP' } } }], pageInfo: { hasNextPage: false, endCursor: null } } }];
  await store.orders([newer], now); await store.orders([raw], new Date(now.getTime() + 3600_000));
  const rows = (await db.query("SELECT data FROM pulse.shopify_records WHERE kind = 'order'")).rows; assert.equal(rows.length, 1);
  const value = rows[0]!.data as any; assert.equal(value.financialStatus, 'REFUNDED'); assert.equal(value.refunds[0].itemsPence, 6662); assert.ok(value.cancelledAt);
  await new ShopifyStore(db, 'sample').orders([raw], now); assert.equal((await store.summary()).counts.order, 1);
  await assert.rejects(store.orders([raw, { ...raw, id: 'invalid' }], now)); assert.equal((await store.summary()).counts.order, 1);
});

test('real app webhook boundary accepts no Origin, deduplicates safely and replays after failure/restart', async t => {
  const db = await createTestDatabase(); const env = credentials(), reader = new Reader();
  const config = readRuntime({ DATABASE_URL: 'postgresql://localhost/pulse_test', APP_ORIGIN: 'https://pulse.example.test' });
  const app = await createApp(db, config, env, { reader, clock: () => now });
  t.after(async () => { await app.close(); await db.close(); });
  const raw = JSON.stringify(await fixture('webhook-order')), event = randomUUID();
  const headers = { 'content-type': 'application/json', 'x-shopify-shop-domain': appConfig.shopify.storeDomain, 'x-shopify-topic': 'orders/create', 'x-shopify-webhook-id': event, 'x-shopify-hmac-sha256': createHmac('sha256', env.SHOPIFY_CLIENT_SECRET).update(raw).digest('base64') };
  assert.equal((await app.inject({ method: 'POST', url: '/webhooks/shopify', headers: { ...headers, 'x-shopify-hmac-sha256': randomUUID() }, payload: raw })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/webhooks/shopify', headers: { ...headers, 'x-shopify-shop-domain': 'wrong.myshopify.com' }, payload: raw })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/webhooks/shopify', headers, payload: raw })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/webhooks/shopify', headers, payload: raw })).statusCode, 200);
  assert.equal((await app.inject('/api/shopify')).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/settings', payload: {} })).statusCode, 403);
  await app.close();
  const inbox = (await db.query('SELECT * FROM pulse.shopify_webhook_inbox')).rows; assert.equal(inbox.length, 1);
  assert.ok(!JSON.stringify(inbox).includes('Invented')); assert.ok(!JSON.stringify(inbox).includes('example.invalid'));
  await db.query('UPDATE pulse.shopify_webhook_inbox SET processed_at = NULL, next_attempt_at = $1', [now]);
  const brokenReader = new Reader(); brokenReader.order = async () => { throw new Error('private'); };
  const broken = new ShopifyWorker(db, env, config.origin, { reader: brokenReader, clock: () => now }); await broken.drainInbox();
  assert.equal((await db.query('SELECT processed_at FROM pulse.shopify_webhook_inbox')).rows[0]!.processed_at, null);
  const restarted = new ShopifyWorker(db, env, config.origin, { reader, clock: () => new Date(now.getTime() + 60_000) }); await restarted.drainInbox();
  assert.ok((await db.query('SELECT processed_at FROM pulse.shopify_webhook_inbox')).rows[0]!.processed_at);
  assert.equal((await restarted.store.summary()).counts.order, 1);
});

test('sample mode uses real API fixtures without network/subscriptions; source health stays waiting for keys', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); await syncSourceHealth(db, {});
  const worker = new ShopifyWorker(db, {}, 'http://localhost:3000', { fetch: async () => { throw new Error('No network in sample mode'); } });
  await worker.initialize(); await Promise.all([worker.tick(), worker.tick()]);
  const summary = await worker.store.summary(); assert.equal(summary.sample, true); assert.equal(summary.counts.order, 1); assert.equal(summary.counts.inventory, 1); assert.equal(summary.counts.sessions, 1);
  assert.equal((await readSourceHealth(db))[0]!.status, 'waiting_for_keys'); assert.equal((await readSourceHealth(db))[0]!.lastSuccessAt, null);
  const sql = await readFile(new URL('../migrations/004_shopify.sql', import.meta.url), 'utf8'); assert.ok(!sql.includes('CREATE TABLE public.'));
});

test('4.2 Level 2 refusal can ingest a dated routine file, with daily provenance and no fabricated today', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); const env = credentials(); await syncSourceHealth(db, env);
  const reader = new Reader(); reader.deniedReports = true;
  const table = (await fixture('sessions')).data.shopifyqlQuery.tableData; table.rows.forEach((r: any) => { r[0] = '2026-09-29'; });
  const worker = new ShopifyWorker(db, env, 'https://pulse.example.test', { reader, clock: () => now, fallback: { read: async day => { assert.equal(day, '2026-09-29'); return table; } } });
  await worker.initialize(); await worker.tick();
  const rows = (await db.query("SELECT source_id, data FROM pulse.shopify_records WHERE kind = 'sessions'")).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0]!.source_id, '2026-09-29'); assert.equal((rows[0]!.data as any).provenance, 'routine_daily');
  assert.equal((rows[0]!.data as any).partial, false);
  assert.equal((await worker.store.summary()).jobs.find(j => j.name === 'sessions')?.state.cadence, 'daily');
});

test('routine adapter reads only the fixed dated GitHub file and rejects wrong-day or missing data', async () => {
  const { RoutineSessions } = await import('../src/shopify/fallback.js');
  const env = { GITHUB_HQ_TOKEN: randomUUID() };
  const table = (await fixture('sessions')).data.shopifyqlQuery.tableData;
  const transport = new Transport({ sleep: noSleep, fetch: async (url, init) => {
    assert.equal(init?.method, 'GET'); assert.equal(String(url), 'https://api.github.com/repos/willpeirce/one-of-one-hq/contents/ops/shopify-daily/2026-09-30.json?ref=main');
    return Response.json({ ...(JSON.parse(await readFile(new URL('fixtures/github-hq/shopify-daily.json', import.meta.url), 'utf8'))), content: Buffer.from(JSON.stringify(table)).toString('base64') });
  } });
  const adapter = new RoutineSessions(transport, env); assert.equal(cleanSessions(await adapter.read('2026-09-30'))[0].sessions, 152);
  await assert.rejects(new RoutineSessions(transport, {}).read('2026-09-30'));
  table.rows[0][0] = '2026-09-29'; await assert.rejects(adapter.read('2026-09-30'));
});

test('GraphQL client paginates nested order lines, refunds, variants and stock levels on API-shaped fixtures', async () => {
  const requests: any[] = [];
  const transport = new Transport({ sleep: noSleep, fetch: async (url, init) => {
    if (String(url).endsWith('access_token')) return Response.json({ ...await fixture('token'), access_token: randomUUID() });
    const request = JSON.parse(String(init?.body)); requests.push(request); const q = request.query;
    if (q.includes('PulseOrders')) {
      const body = await fixture('orders'); const order = body.data.orders.nodes[0];
      order.subtotalPriceSet.shopMoney.amount = '80.95'; order.totalTaxSet.shopMoney.amount = '13.50';
      order.lineItems.pageInfo = { hasNextPage: true, endCursor: 'line-2' };
      order.refunds = [{ id: 'gid://shopify/Refund/900001', createdAt: now.toISOString(), refundLineItems: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'refund-2' } } }];
      return Response.json(body);
    }
    if (q.includes('PulseLines')) return Response.json({ data: { order: { lineItems: { nodes: [{ id: 'gid://shopify/LineItem/900002', sku: 'oneofone-slab', quantity: 1, product: { id: 'gid://shopify/Product/15948268306766' }, taxLines: [{ priceSet: { shopMoney: { amount: '0.17', currencyCode: 'GBP' } } }] }], pageInfo: { hasNextPage: false, endCursor: null } } } } });
    if (q.includes('PulseRefundLines')) return Response.json({ data: { node: { refundLineItems: { nodes: [{ quantity: 1, subtotalSet: { shopMoney: { amount: '1.00', currencyCode: 'GBP' } }, totalTaxSet: { shopMoney: { amount: '0.17', currencyCode: 'GBP' } } }], pageInfo: { hasNextPage: false, endCursor: null } } } } });
    if (q.includes('PulseStock')) {
      if (request.variables.id !== 'gid://shopify/Product/10896502063438') return Response.json({ data: { product: null } });
      const body = await fixture('product'); if (!request.variables.after) body.data.product.variants.pageInfo = { hasNextPage: true, endCursor: 'variant-2' };
      else body.data.product.variants.nodes = [];
      return Response.json(body);
    }
    if (q.includes('PulseLevels')) {
      const body = await fixture('levels'); if (!request.variables.after) body.data.inventoryItem.inventoryLevels.pageInfo = { hasNextPage: true, endCursor: 'level-2' };
      else body.data.inventoryItem.inventoryLevels.nodes[0].location.id = appConfig.shopify.locations.us.id;
      return Response.json(body);
    }
    throw new Error('Unexpected query');
  } });
  const client = new ShopifyClient(transport, credentials(), 'https://pulse.example.test');
  const result = await client.orders('created_at:>=2026-09-01', null, true);
  const order = cleanOrder(result.nodes[0]); assert.equal(order.lines.length, 2); assert.equal(order.refunds[0].itemsPence, 83);
  assert.equal(order.itemTaxPence, 1350); assert.equal(order.itemsAfterDiscountsPence, 6745);
  assert.match(orderFields(true), /taxesIncluded/); assert.match(orderFields(false), /taxesIncluded/);
  assert.ok(requests.filter(r => /PulseOrders|PulseLines/.test(r.query)).every(r => /taxLines\s*\{\s*priceSet\s*\{\s*shopMoney/.test(r.query)));
  const stock = await client.inventory(); assert.equal(stock.length, 2); assert.ok(stock.every(s => cleanInventory(s)));
  assert.ok(requests.some(r => r.variables.after === 'variant-2')); assert.ok(requests.some(r => r.variables.after === 'level-2'));
  assert.ok(requests.filter(r => r.query.includes('PulseStock')).every(r => !appConfig.shopify.tiktokOrderOnlyProductIds.some(id => r.variables.id.endsWith(id))));
});

test('source page shows ingestion counts from its own store and labels sample/live separately from business examples', async t => {
  const { sourceHealthPage } = await import('../src/views.js');
  const db = await createTestDatabase(); t.after(() => db.close()); await syncSourceHealth(db, {});
  const worker = new ShopifyWorker(db, {}, 'http://localhost:3000'); await worker.initialize(); await worker.tick();
  const health = await readSourceHealth(db), summary = await worker.store.summary();
  const html = sourceHealthPage(health, summary); assert.match(html, /Shopify imports · sample data/); assert.match(html, /1 orders · 1 inventory rows · 1 session days/); assert.match(html, /Business cards remain sample data until part 1b/);
  const live = sourceHealthPage(health, { ...summary, mode: 'live', sample: false, counts: { order: 7 } }); assert.match(live, /Shopify imports · live/); assert.match(live, /7 orders/); assert.match(live, /Business cards remain sample data/);
});
