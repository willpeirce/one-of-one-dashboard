import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ShopifyClient } from '../src/shopify/client.js';
import { ShopifyError, Transport } from '../src/shopify/http.js';
import { cleanOrder } from '../src/shopify/model.js';
import { SampleShopify, fixture } from '../src/shopify/sample.js';
import { ShopifyStore } from '../src/shopify/store.js';
import { costOrder } from '../src/shopify/costs.js';
import { ShopifyWorker } from '../src/shopify/worker.js';
import { defaultSettings } from '../src/settings.js';
import { settingsPage } from '../src/settings-view.js';
import { sourceHealthPage } from '../src/views.js';
import { createTestDatabase } from './helpers/database.js';

const first = new Date('2026-09-28T12:00:00Z');
const change = new Date('2026-09-30T12:00:00Z');
async function stock() { return (await new SampleShopify().inventory())[0]!; }

test('PulseStock includes unitCost, preserves variants with no levels, and propagates cost access denial without a workaround', async () => {
  const queries: string[] = []; let denied = false;
  const client = new ShopifyClient(new Transport({ sleep: async () => {}, fetch: async (url, init) => {
    if (String(url).endsWith('access_token')) return Response.json({ ...await fixture('token'), access_token: randomUUID() });
    const q = JSON.parse(String(init?.body)).query as string; queries.push(q);
    if (denied) return Response.json({ errors: [{ extensions: { code: 'ACCESS_DENIED' }, path: ['product','variants','inventoryItem','unitCost'] }] });
    if (q.includes('PulseStock')) return Response.json(await fixture('product'));
    return Response.json({ data: { inventoryItem: { id: 'gid://shopify/InventoryItem/900001', inventoryLevels: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } });
  } }), { SHOPIFY_CLIENT_ID: randomUUID(), SHOPIFY_CLIENT_SECRET: randomUUID() }, 'https://pulse.example.test');
  const rows = await client.inventory();
  assert.match(queries.find(q => q.includes('PulseStock'))!, /inventoryItem\s*\{\s*id\s+unitCost\s*\{\s*amount\s+currencyCode/);
  assert.ok(queries.filter(q => q.includes('PulseLevels')).every(q => !q.includes('unitCost')));
  assert.equal(rows[0]!.location, null); assert.equal(rows[0]!.unitCost.amount, '4.21');
  denied = true; const before = queries.length;
  await assert.rejects(client.inventory(), (e: unknown) => e instanceof ShopifyError && e.code === 'denied');
  assert.equal(queries.length, before + 1);
});

test('poll observations append only changed costs, update last seen, retain null/zero, and isolate modes', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const store = new ShopifyStore(db, 'live'); const row = await stock();
  await store.inventory([row,row], first);
  await store.inventory([row], new Date('2026-09-29T12:00:00Z'));
  let h = await store.costHistory(); assert.equal(h.length, 1); assert.equal(Number(h[0]!.amount_pence), 421);
  assert.equal(new Date(h[0]!.last_seen_at).toISOString(), '2026-09-29T12:00:00.000Z');
  const revised = { ...row, unitCost: { amount: '5.6750', currencyCode: 'GBP' } };
  await Promise.all([store.inventory([revised], change), store.inventory([revised], change)]);
  h = await store.costHistory(); assert.equal(h.length, 2); assert.equal(Number(h[1]!.amount_pence), 568);
  assert.equal((await store.costSummary()).known, 1);
  assert.equal(new Date((await store.costSummary()).changed!).toISOString(), change.toISOString());
  await store.inventory([row], first); assert.equal((await store.costHistory()).length, 2);
  await store.inventory([{ ...row, unitCost: null }], new Date('2026-10-01T12:00:00Z'));
  assert.equal((await store.costSummary()).missing, 1);
  await store.inventory([{ ...row, unitCost: { amount: '0.00', currencyCode: 'GBP' } }], new Date('2026-10-02T12:00:00Z'));
  assert.equal(Number((await store.latestCosts())[0]!.amount_pence), 0);
  assert.equal((await new ShopifyStore(db,'sample').costHistory()).length, 0);
});

test('order costs use observation time, earliest cost for older orders, variant/SKU matching, Settings fallback and unknown propagation', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const store = new ShopifyStore(db,'live'), row = await stock();
  await store.inventory([row], first);
  await store.inventory([{ ...row, unitCost: { amount:'5.67',currencyCode:'GBP' } }], change);
  const history = await store.costHistory();
  const order = cleanOrder((await fixture('order')).data.order);
  const settings = { ...defaultSettings(), startingCogs: [{ sku:'ultimate',unitCostGbp:9.99 },{sku:'invented-fallback',unitCostGbp:1.23}] };
  order.lines[0].variantId = row.variantId; order.lines[0].quantity = 2;
  order.createdAt = '2026-09-01T12:00:00Z'; assert.equal(costOrder(order,history,settings).costPence, 842);
  order.createdAt = '2026-09-30T11:59:59Z'; assert.equal(costOrder(order,history,settings).costPence, 842);
  order.createdAt = '2026-09-30T12:00:01Z'; assert.equal(costOrder(order,history,settings).costPence, 1134);
  assert.equal(costOrder(order,history,settings).source, 'shopify');
  order.lines[0].variantId = null; assert.equal(costOrder(order,history,settings).costPence, 1134);
  const fallback = { ...order.lines[0], id:'gid://shopify/LineItem/990301',sku:'invented-fallback' };
  const mixed = costOrder({ ...order, lines:[order.lines[0],fallback] },history,settings);
  assert.deepEqual(mixed.lines.map(l=>l.source), ['shopify','settings']); assert.equal(mixed.costPence,1380); assert.equal(mixed.source,'settings');
  const unknown = { ...fallback, id:'gid://shopify/LineItem/990302',sku:'invented-unknown' };
  const result = costOrder({ ...order, lines:[order.lines[0],unknown] },history,settings);
  assert.equal(result.costPence,null); assert.equal(result.source,'unknown'); assert.equal(result.lines[1]!.unitCostPence,null);
  assert.equal(costOrder(order,[],settings).lines[0]!.source,'settings');
  assert.equal(costOrder(order,history.map(c=>({...c,amount_pence:null,currency:null})),settings).lines[0]!.source,'settings');
  assert.equal(costOrder(order,history.map(c=>({...c,currency:'USD'})),settings).costPence,null);
  assert.equal(costOrder(order,history.map(c=>({...c,amount_pence:0})),settings).costPence,0);
});

test('Settings and Source health show observed live costs and provenance, never replace editable fallbacks', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const store = new ShopifyStore(db,'live'); await store.inventory([await stock()],change);
  const snapshot = { version:1, values:{...defaultSettings(),startingCogs:[{sku:'ultimate',unitCostGbp:null},{sku:'invented-missing',unitCostGbp:null}]} };
  const html = settingsPage(snapshot,await store.latestCosts(),'live');
  assert.match(html,/Shopify · live: £4\.21 · last seen 30 Sept 2026/); assert.match(html,/Not in Shopify/); assert.match(html,/fallback/);
  assert.match(html,/name="startingCogs.0.unitCostGbp"[^>]+value=""/);
  assert.match(sourceHealthPage([],await store.summary(),await store.costSummary()),/1 stock variants with a cost · 0 without/);
});

test('inventory webhook refreshes cost history through the existing worker job', async t => {
  const db = await createTestDatabase(); t.after(() => db.close()); const row = await stock();
  class Reader extends SampleShopify { override async inventory() { return [row]; } override async subscribe() {} }
  let clock = first;
  const worker = new ShopifyWorker(db,{SHOPIFY_CLIENT_ID:randomUUID(),SHOPIFY_CLIENT_SECRET:randomUUID()},'https://pulse.example.test',{reader:new Reader(),clock:()=>clock});
  await worker.initialize(); await worker.tick(); const jobs = (await worker.store.summary()).jobs.length;
  row.unitCost = { amount:'6.54',currencyCode:'GBP' }; clock = change;
  await db.query(`INSERT INTO pulse.shopify_webhook_inbox (source_id,topic,payload,next_attempt_at) VALUES ($1,'inventory_levels/update','{}',$2)`,[randomUUID(),clock]);
  await worker.drainInbox(); assert.equal((await worker.store.costHistory()).length,2);
  assert.equal((await worker.store.summary()).jobs.length,jobs);
});
