import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { appConfig } from '../src/config.js';
import type { Database } from '../src/db.js';
import { readStockDaily, takeStockDaily } from '../src/scorecard/stock-daily.js';
import { defaultSettings } from '../src/settings.js';
import { SampleShopify } from '../src/shopify/sample.js';
import { ShopifyStore } from '../src/shopify/store.js';
import { nextStockSnapshot, ShopifyWorker } from '../src/shopify/worker.js';
import { blankObservation, evaluateWatchdogs } from '../src/shopify/watchdogs.js';
import { readSourceHealth, syncSourceHealth, type SourceMode } from '../src/sources.js';
import { createTestDatabase } from './helpers/database.js';

// Invented stored projections; no product or location value comes from the private spec.
async function inventory(db: Database, mode: SourceMode, fetched: Date, available: number | null, suffix = '1') {
  const data = { productId:`gid://shopify/Product/98910${suffix}`,variantId:`gid://shopify/ProductVariant/98920${suffix}`,
    inventoryItemId:`gid://shopify/InventoryItem/98930${suffix}`,locationId:'gid://shopify/Location/989401',sku:`invented-stock-${suffix}`,
    quantities:available===null?[{name:'on_hand',quantity:4}]:[{name:'available',quantity:available}] };
  await new ShopifyStore(db,mode).put('inventory',`${data.inventoryItemId}:${data.locationId}`,data,fetched);
  return data;
}
const env=()=>({SHOPIFY_CLIENT_ID:randomUUID(),SHOPIFY_CLIENT_SECRET:randomUUID()});

test('stock_daily migration creates only an empty additive table in seconds',async t=>{
  const db=await createTestDatabase({migrate:false});t.after(()=>db.close());
  await db.query('CREATE SCHEMA pulse');
  const sql=await readFile(new URL('../migrations/054_stock_daily.sql',import.meta.url),'utf8');
  const started=performance.now();await db.query(sql);const elapsed=performance.now()-started;
  assert.ok(elapsed<5000,`Empty stock_daily table took ${elapsed.toFixed(1)} ms`);
  t.diagnostic(`stock_daily additive migration: ${elapsed.toFixed(1)} ms`);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM pulse.stock_daily')).rows[0]!.n,0);
});

test('daily stock preserves zero, negatives, product and mode provenance; missing availability stays unknown',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());const now=new Date('2026-10-25T00:05:00Z');
  const zero=await inventory(db,'live',new Date('2026-10-24T23:02:00Z'),0);
  await inventory(db,'live',now,-2,'2');await inventory(db,'live',now,null,'3');
  await inventory(db,'sample',now,31);
  assert.deepEqual(await takeStockDaily(db,'live',now),{day:'2026-10-25',freshRows:2,inserted:2});
  await takeStockDaily(db,'sample',now);
  const rows=await readStockDaily(db,'live','2026-10-24','2026-10-26');
  assert.deepEqual(rows.map(row=>[row.day,row.available]),[['2026-10-25',0],['2026-10-25',-2]]);
  assert.equal(rows[0]!.productId,zero.productId);assert.equal(rows[0]!.source,'shopify');assert.equal(rows[0]!.brand,'one-of-one');
  assert.equal(rows[0]!.sourceId,`${zero.inventoryItemId}:${zero.locationId}`);
  assert.equal(rows[0]!.fetchedAt,'2026-10-24T23:02:00.000Z');assert.equal(rows[0]!.takenAt,now.toISOString());
  assert.equal((await readStockDaily(db,'sample','2026-10-25','2026-10-25'))[0]!.available,31);
  assert.deepEqual(await readStockDaily(db,'live','2026-10-24','2026-10-24'),[]);
  await inventory(db,'live',new Date('2026-10-25T02:00:00Z'),42);
  await takeStockDaily(db,'live',new Date('2026-10-25T02:05:00Z'));
  assert.equal((await readStockDaily(db,'live','2026-10-25','2026-10-25'))[0]!.available,0,'Later captures cannot rewrite a daily observation');
});

test('UK-day freshness follows both sides of the autumn clock change and never backfills an outage',async t=>{
  const db=await createTestDatabase();t.after(()=>db.close());
  await inventory(db,'live',new Date('2026-10-24T22:59:59Z'),12);
  assert.equal((await takeStockDaily(db,'live',new Date('2026-10-24T23:05:00Z'))).freshRows,0);
  await inventory(db,'live',new Date('2026-10-24T23:00:00Z'),12);
  assert.equal((await takeStockDaily(db,'live',new Date('2026-10-24T23:05:00Z'))).freshRows,1);
  assert.equal((await takeStockDaily(db,'live',new Date('2026-10-26T00:05:00Z'))).freshRows,0);
  await inventory(db,'live',new Date('2026-10-26T00:00:00Z'),9);
  await takeStockDaily(db,'live',new Date('2026-10-26T00:05:00Z'));
  await inventory(db,'live',new Date('2026-10-29T00:02:00Z'),7);
  await takeStockDaily(db,'live',new Date('2026-10-29T00:05:00Z'));
  assert.deepEqual((await readStockDaily(db,'live','2026-10-24','2026-10-29')).map(row=>row.day),['2026-10-25','2026-10-26','2026-10-29']);
});

test('daily worker waits until 00:05 UK and retries at inventory cadence until a fresh stored row exists',async t=>{
  const db=await createTestDatabase();let clock=new Date('2026-10-24T12:00:00Z');
  class StoredOnlyReader extends SampleShopify {
    override async inventory():Promise<any[]> { assert.fail('Daily stock must use stored inventory, never a source read'); }
  }
  const worker=new ShopifyWorker(db,env(),'https://pulse.example.test',{reader:new StoredOnlyReader(true),clock:()=>clock});
  t.after(async()=>{await worker.stop();await db.close();});await worker.initialize();
  const scheduled=(await db.query("SELECT next_run_at FROM pulse.shopify_jobs WHERE name='stock_daily'")).rows[0]!;
  assert.equal(new Date(scheduled.next_run_at as Date).toISOString(),nextStockSnapshot(clock).toISOString());
  await db.query("UPDATE pulse.shopify_jobs SET next_run_at='9999-01-01' WHERE name<>'stock_daily'");
  await worker.tick();assert.deepEqual(await readStockDaily(db,'live','2026-10-24','2026-10-25'),[]);
  clock=new Date('2026-10-24T23:05:00Z');await worker.tick();
  const waiting=(await db.query("SELECT next_run_at,state FROM pulse.shopify_jobs WHERE name='stock_daily'")).rows[0]!;
  assert.equal(new Date(waiting.next_run_at as Date).toISOString(),'2026-10-24T23:10:00.000Z');
  assert.equal((waiting.state as {waitingForInventory:boolean}).waitingForInventory,true);
  await inventory(db,'live',new Date('2026-10-24T23:06:00Z'),5);
  clock=new Date('2026-10-24T23:10:00Z');await worker.tick();
  const done=(await db.query("SELECT next_run_at,state FROM pulse.shopify_jobs WHERE name='stock_daily'")).rows[0]!;
  assert.equal(new Date(done.next_run_at as Date).toISOString(),'2026-10-26T00:05:00.000Z');
  assert.equal((done.state as {waitingForInventory:boolean}).waitingForInventory,false);
  assert.equal((await readStockDaily(db,'live','2026-10-25','2026-10-25'))[0]!.available,5);
  clock=new Date('2026-10-29T00:10:00Z');await worker.initialize();
  await inventory(db,'live',clock,3);await worker.tick();
  assert.deepEqual((await readStockDaily(db,'live','2026-10-25','2026-10-29')).map(row=>row.day),['2026-10-25','2026-10-29'],'An overdue job observes today without backfilling the missed days');
  await new ShopifyWorker(db,{},'https://pulse.example.test',{reader:new StoredOnlyReader(true)}).initialize();
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pulse.shopify_jobs WHERE mode='sample' AND name='stock_daily'")).rows[0]!.n,0);
});

test('daily and kit stock snapshot failures cannot fail one another or the main Shopify health',async t=>{
  for(const failed of ['stock_daily','stock_snapshots'] as const)await t.test(failed,async t=>{
    const db=await createTestDatabase();const now=new Date('2026-10-25T00:05:00Z'),credentials=env();
    await syncSourceHealth(db,credentials);
    await db.query("UPDATE pulse.source_health SET status='healthy' WHERE source='shopify'");
    await inventory(db,'live',now,0);
    const wrapped:Database={...db,query:async <Row extends Record<string,unknown>>(sql:string,values?:unknown[])=>{
      if(sql.includes(`INSERT INTO pulse.${failed} `)||sql.includes(`INSERT INTO pulse.${failed}\n`))throw new Error('invented-private-database-error');
      return db.query<Row>(sql,values);
    }};
    class KitReader extends SampleShopify {
      override async inventory(){return Object.values(appConfig.shopify.locations).map(location=>({
        productId:`gid://shopify/Product/${appConfig.shopify.stockProducts[0]!.id}`,variantId:'gid://shopify/ProductVariant/989501',
        inventoryItemId:'gid://shopify/InventoryItem/989601',sku:'oneofone1',location:{id:location.id},
        quantities:[{name:'available',quantity:11}],unitCost:null,
      }));}
    }
    const worker=new ShopifyWorker(wrapped,credentials,'https://pulse.example.test',{reader:new KitReader(true),clock:()=>now});
    t.after(async()=>{await worker.stop();await db.close();});await worker.initialize();
    await db.query("UPDATE pulse.shopify_jobs SET next_run_at=CASE WHEN name IN ('stock_daily','stock_snapshot') THEN $1::timestamptz ELSE '9999-01-01'::timestamptz END",[now]);
    await db.query('UPDATE pulse.shopify_jobs SET last_success_at=$1',[now]);
    const logs:string[]=[];t.mock.method(console,'error',(message:string)=>logs.push(message));
    await worker.tick();
    if(failed==='stock_daily'){
      await db.query("UPDATE pulse.shopify_jobs SET next_run_at=$1 WHERE name='stock_daily'",[now]);await worker.tick();
      assert.equal((await db.query("SELECT failures FROM pulse.shopify_jobs WHERE name='stock_daily'")).rows[0]!.failures,2);
      const facts=await worker.store.facts(now);
      const self=evaluateWatchdogs(facts,now,defaultSettings(),blankObservation(),[],await readSourceHealth(db)).find(check=>check.id==='self')!;
      assert.equal(self.status,'pass','A scorecard-only snapshot failure cannot create a Home self-check warning');
      assert.doesNotMatch(self.why,/stock_daily/);
    }
    const daily=(await readStockDaily(db,'live','2026-10-25','2026-10-25')).length;
    const kits=(await db.query('SELECT count(*)::int AS n FROM pulse.stock_snapshots')).rows[0]!.n;
    assert.equal(daily,failed==='stock_daily'?0:1);assert.equal(kits,failed==='stock_snapshots'?0:2);
    assert.deepEqual(logs,Array(failed==='stock_daily'?2:1).fill(`Shopify ${failed==='stock_daily'?'stock_daily':'stock_snapshot'} failed (unknown).`));
    assert.equal((await readSourceHealth(db)).find(row=>row.source==='shopify')!.status,'healthy');
  });
});
