import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {cleanOrder} from '../src/shopify/model.js';
import {orderFields,type ShopifyReader} from '../src/shopify/client.js';
import {backfillFirstOrders} from '../src/shopify/first-order.js';
import {applySpend} from '../src/ad-spend/metrics.js';
import {buildHeroRange} from '../src/hero-range.js';
import {defaultSettings} from '../src/settings.js';
import {createTestDatabase} from './helpers/database.js';
import {ShopifyStore} from '../src/shopify/store.js';
import {SampleShopify} from '../src/shopify/sample.js';
import type {SpendFacts} from '../src/ad-spend/store.js';
const rawOrder=async()=>JSON.parse(await readFile(new URL('./fixtures/shopify/orders.json',import.meta.url),'utf8')).data.orders.nodes[0];
const now=new Date('2026-10-26T12:00:00Z'),day='2026-10-25';
test('first-order projection reads only the index and stores a flag without a customer identifier',async()=>{
 const raw=await rawOrder();
 assert.match(orderFields(true),/customerJourneySummary \{ customerOrderIndex/);assert.doesNotMatch(orderFields(true),/customer \{/);
 for(const [index,flag] of [[1,'first'],[2,'repeat'],[null,'unknown'],[undefined,'unknown']] as const){
  const order=cleanOrder({...raw,customerJourneySummary:{customerOrderIndex:index}});
  assert.equal(order.firstOrder,flag);assert.ok(!('customerId' in order));assert.ok(!('customerOrderIndex' in order));
 }
});
test('CAC waits for every counted flag, then uses first orders and keeps market denominators',async()=>{
 const base=cleanOrder(await rawOrder());
 const orders=[{...base,day,market:'UK' as const,firstOrder:'first' as const},{...base,day,market:'UK' as const,firstOrder:'repeat' as const},{...base,day,market:'US' as const,firstOrder:'unknown' as const}];
 const spend:SpendFacts={mode:'live',rows:(['uk','us'] as const).map(m=>({source:'meta',accountId:'invented-cac-account',campaignId:`invented-cac-${m}`,campaignName:`Invented ${m.toUpperCase()}`,adSetId:`invented-cac-set-${m}`,adSetName:`Invented ${m.toUpperCase()} set`,owner:'ours',market:m,day,amount:m==='uk'?'80':'40',currency:'GBP'})),days:[{source:'meta',day}],sources:[{source:'meta',live:true,ready:true,status:'live',fetchedAt:now.toISOString()}]};
 for(const market of ['all','uk','us'] as const){
  const selected=orders.filter(o=>market==='all'||o.market.toLowerCase()===market),count=selected.length;
  const hero=buildHeroRange([{date:day,net:100,o:count,uk:market==='us'?0:2,us:market==='uk'?0:1,sess:3,ukS:2,ukM:0,usM:0,g:0,ours:0}],day,day,{today:'2026-10-26',market});
  applySpend(hero,selected,defaultSettings(),'2026-10-26',{spend,costs:[],estimates:[],market,now});
  assert.equal(hero.cac.n,market==='uk'?80:40);
  assert.match(hero.cac.ss,market==='uk'?/^first orders ·/:/all orders · 1 waiting/);
 }
});
test('flag backfill commits a cursor, yields to the poll and resumes without re-saving an order',async t=>{
 const db=await createTestDatabase();t.after(()=>db.close());const store=new ShopifyStore(db,'live'),raw=await rawOrder();
 for(let i=0;i<26;i++)await store.orders([{...raw,id:`gid://shopify/Order/${990000+i}`}],now);
 await db.query("INSERT INTO pulse.shopify_jobs(mode,name,next_run_at) VALUES('live','poll',$1)",[new Date(now.getTime()+300000)]);
 let calls=0,clock=now;
 const reader:ShopifyReader=Object.assign(new SampleShopify(true),{firstOrderFlags:async(ids:string[])=>{
  calls++;clock=new Date(now.getTime()+300000);return ids.map(id=>({id,firstOrder:'first' as const}));
 }});
 await backfillFirstOrders(db,reader,()=>clock,()=>false);assert.equal(calls,1);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM pulse.shopify_records WHERE data->>'firstOrder'='first'")).rows[0]!.n,25);
 assert.ok((await db.query('SELECT cursor FROM pulse.shopify_first_order_backfill')).rows[0]!.cursor);
 await db.query("UPDATE pulse.shopify_jobs SET next_run_at=$1",[new Date(clock.getTime()+300000)]);
 await backfillFirstOrders(db,reader,()=>clock,()=>false);assert.equal(calls,2);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM pulse.shopify_records WHERE data->>'firstOrder'='first'")).rows[0]!.n,26);
 await store.orders([{...raw,id:'gid://shopify/Order/990000'}],now); // A normal missing-index read preserves a known immutable flag when one exists.
 const first=(await db.query("SELECT data FROM pulse.shopify_records WHERE source_id='gid://shopify/Order/990000'")).rows[0]!.data as any;
 assert.equal(first.firstOrder,'first');assert.ok(!first.customerId);
});


test('first-order CAC history and comparisons use first orders and refuse incomplete flag history',()=>{
 const rows=Array.from({length:8},(_,i)=>({date:`2026-10-${String(11+i).padStart(2,'0')}`,net:100,o:2,uk:2,us:0,sess:10,ukS:10,ukM:40,usM:0,g:0,ours:40,firstOrders:1,flaggedOrders:2}));
 const hero=buildHeroRange(rows,'2026-10-18','2026-10-18',{today:'2026-10-26'});
 assert.equal(hero.cac.n,40);assert.deepEqual(hero.cac.d.hist,[40,40,40,40,40,40,40]);assert.match(hero.cac.ss,/40.00/);
 rows[1]!.flaggedOrders=1;
 const incomplete=buildHeroRange(rows,'2026-10-18','2026-10-18',{today:'2026-10-26'});
 assert.match(incomplete.cac.ss,/no earlier days to compare/);assert.deepEqual(incomplete.cac.d.hist,[]);
});
