import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { appConfig } from '../src/config.js';
import { defaultSettings } from '../src/settings.js';
import { addDays } from '../src/hero-range.js';
import { cleanOrder, cleanSessions, type Order } from '../src/shopify/model.js';
import { ShopifyStore } from '../src/shopify/store.js';
import { fixture, SampleShopify } from '../src/shopify/sample.js';
import { ShopifyWorker, channelQuery } from '../src/shopify/worker.js';
import { dataset, dailyRows, emailFlow, shopifyHero, stockCover, type Facts } from '../src/shopify/metrics.js';
import { blankObservation, dispatchLate, evaluateWatchdogs, observe, updateObservation } from '../src/shopify/watchdogs.js';
import { applyShopifyDashboard } from '../src/shopify/dashboard.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { dashboardPage } from '../src/dashboard-view.js';
import { needsHtml } from '../src/shopify/presentation.js';
import { createTestDatabase } from './helpers/database.js';
const now = new Date(appConfig.shopify.sampleNow);
const settings = defaultSettings();
function facts(orders: Order[], from = '2026-08-01', extra: Facts['records'] = []): Facts {
  return { mode: 'live', sample: false, counts: {}, pendingWebhooks: 0, notices: [], noticeDetails: [],
    jobs: ['backfill','poll','sessions','inventory','reconcile','subscriptions'].map(name => ({ name, state: name === 'backfill' ? { from, allOrders: true, ordersDone: true } : {}, last_success_at: now, failures: 0 })),
    records: [...orders.map(data => ({ kind: 'order', data, fetched_at: now })), ...extra] };
}
async function order(): Promise<Order> { return cleanOrder((await fixture('order')).data.order); }

test('4.1/4.2 net sales use UK order/refund dates, inclusive item tax, and exclude shipping and old recently updated orders', async () => {
  const uk = cleanOrder((await fixture('order-uk-tax-inclusive-refund')).data.order) as Order;
  const us = cleanOrder((await fixture('order-us-tax-exclusive')).data.order) as Order;
  const total = dailyRows(facts([uk], '2026-09-01'), '2026-09-30').reduce((n, r) => n + r.net, 0);
  assert.equal(total, 45);
  assert.equal(dailyRows(facts([us], '2026-09-01'), '2026-09-30').reduce((n, r) => n + r.net, 0), 60);
  const base = await order(); base.day = '2026-09-28'; base.createdAt = '2026-09-28T09:00:00Z';
  base.refunds = [{ id: 'gid://shopify/Refund/990001', createdAt: '2026-09-29T23:30:00Z', itemsPence: 1500, taxPence: 300 }];
  const old = { ...base, id: 'gid://shopify/Order/990002', day: '2026-06-01', createdAt: '2026-06-01T09:00:00Z', updatedAt: now.toISOString(), itemsAfterDiscountsPence: 900_000 };
  const cancelled = { ...base, id: 'gid://shopify/Order/990003', cancelledAt: now.toISOString() };
  const testOrder = { ...base, id: 'gid://shopify/Order/990004', test: true };
  const f = facts([base, old, cancelled, testOrder]);
  assert.equal(dataset(f, '2026-09-30').orders.length, 1);
  const rows = dailyRows(f, '2026-09-30');
  assert.equal(rows.find(r => r.date === '2026-09-28')!.net, 66.62);
  assert.equal(rows.find(r => r.date === '2026-09-30')!.net, -15);
  const hero = shopifyHero(f, '2026-09-30', '2026-09-28', '2026-09-30', settings);
  assert.equal(hero.net.n, 51.62); assert.equal(hero.orders.n, 1);
  assert.equal(hero.spend.unavailable, true); assert.equal(hero.roas.unavailable, true); assert.equal(hero.cr.unavailable, true);
  assert.match(hero.orders.d.rule, /before the order backfill window are excluded/);
});

test('4.2 geo guards and phantom exclusion reach hero conversion without hiding store totals or orders', async () => {
  const o = await order();
  const table = (await fixture('sessions')).data.shopifyqlQuery.tableData;
  const sessions = cleanSessions(table)[0]!;
  const hero = shopifyHero(facts([o], '2026-08-01', [{ kind:'sessions',data:sessions,fetched_at:now }]), '2026-09-30','2026-09-30','2026-09-30',settings);
  assert.equal(sessions.sessions, 152); assert.equal(hero.orders.n, 1); assert.equal(hero.cr.unavailable, false);
  assert.equal(hero.cr.n, Math.round(100/152*10)/10);
  const bad = { ...sessions, marketReliable: false };
  const guarded = shopifyHero(facts([o], '2026-08-01', [{ kind:'sessions',data:bad,fetched_at:now }]), '2026-09-30','2026-09-30','2026-09-30',settings);
  assert.equal(guarded.cr.unavailable,false); assert.match(guarded.cr.ss,/unknown/);
  const historic = { ...o, day:'2026-09-23' };
  const historicSessions = { ...sessions, day:'2026-09-23', marketReliable:false };
  assert.match(shopifyHero(facts([historic], '2026-08-01', [{kind:'sessions',data:historicSessions,fetched_at:now}]),'2026-09-30','2026-09-23','2026-09-23',settings).cr.ss,/unknown/);
});

test('4.3 tiers, TikTok orders and spike dates; 4.5 UTM email/refill attribution are source facts', async () => {
  const o = await order();
  const tiktok = structuredClone(o); tiktok.id = 'gid://shopify/Order/990005'; tiktok.channel = 'TikTok';
  const refill = structuredClone(o); refill.id = 'gid://shopify/Order/990006'; refill.lines[0]!.sku='REFILL'; refill.lines[0]!.productId='gid://shopify/Product/16062800658766';
  refill.lastVisit={medium:'email',campaign:appConfig.mailchimp.utmCampaigns.find(c=>c.flow==='D30 refill')!.campaign};
  const hero = shopifyHero(facts([o,tiktok,refill]),'2026-09-30','2026-09-30','2026-09-30',settings);
  assert.equal(hero.orders.n,3); assert.equal(hero.business!.orderDays[0]!.TikTok,1);
  assert.equal(hero.business!.orderDays[0]!.UK,2); assert.match(hero.orders.d.extra!.find(([k])=>k==='Spike days')![1],/30 Sep/);
  assert.equal(hero.business!.refill.count,1); assert.equal(hero.business!.email.count,3);
  assert.equal(emailFlow(refill),'D30 refill');
  const discountOnly={...refill,lastVisit:null,discountSignals:['SLABPACK']}; assert.equal(emailFlow(discountOnly),null);
  assert.match(shopifyHero(facts([o]),'2026-09-30','2026-09-20','2026-09-30',settings).business!.email.detail.why,/partial/);
});

test('stock uses allocated lines by warehouse, 60 complete days and Settings; missing facts stay unknown', async () => {
  const o=await order(); o.day='2026-09-29'; o.lines[0]!.productId='gid://shopify/Product/10476514214222'; o.lines[0]!.quantity=10;
  o.fulfillments=[{id:'gid://shopify/Fulfillment/990007',status:'SUCCESS',createdAt:now.toISOString(),updatedAt:now.toISOString(),locationId:appConfig.shopify.locations.uk.id,lines:[{lineId:o.lines[0]!.id,quantity:4}]},
    {id:'gid://shopify/Fulfillment/990008',status:'SUCCESS',createdAt:now.toISOString(),updatedAt:now.toISOString(),locationId:appConfig.shopify.locations.us.id,lines:[{lineId:o.lines[0]!.id,quantity:6}]}];
  const stock={ productId:o.lines[0]!.productId,locationId:appConfig.shopify.locations.uk.id,quantities:[{name:'available',quantity:8}] };
  const f=facts([o],'2026-07-01',[{kind:'inventory',data:stock,fetched_at:now}]);
  let cover=stockCover(f,'2026-09-30',{...settings,seasonalMultiplier:2}).find(s=>s.name==='ONE OF ONE · Northampton')!;
  assert.equal(cover.dailyRate,4/60*2); assert.equal(cover.cover,60); assert.match(cover.basis,/no restock/);
  assert.equal(stockCover(f,'2026-09-30',settings).find(s=>s.name===cover.name)!.cover,null);
  assert.equal(stockCover(facts([o],'2026-09-01',[{kind:'inventory',data:stock,fetched_at:now}]),'2026-09-30',{...settings,seasonalMultiplier:1}).find(s=>s.name===cover.name)!.cover,null);
  assert.ok(stockCover(f,'2026-09-30',settings).some(s=>s.available===null));
});

test('dispatch uses payment time, working days, bank holidays, both cutoffs and unknowns', async () => {
  const o=await order();o.paidAt='2026-08-28T14:30:00Z';o.fulfillmentStatus='UNFULFILLED';
  const holidays=[{warehouse:'uk',day:'2026-08-31'}];
  assert.equal(dispatchLate(o,new Date('2026-09-01T14:59:00Z'),settings,holidays),false);
  assert.equal(dispatchLate(o,new Date('2026-09-01T15:00:00Z'),settings,holidays),true);
  assert.equal(dispatchLate({...o,paidAt:'2026-08-28T15:00:00Z'},new Date('2026-09-01T16:00:00Z'),settings,holidays),false);
  assert.equal(dispatchLate({...o,market:'US',paidAt:'2026-09-28T18:00:00Z'},new Date('2026-09-29T19:00:00Z'),settings,[]),true);
  assert.equal(dispatchLate({...o,paidAt:null},now,settings,[]),null);
  assert.equal(dispatchLate({...o,fulfillmentStatus:'FULFILLED'},now,settings,[]),false);
  assert.equal(dispatchLate(o,new Date('2028-01-02T12:00:00Z'),settings,holidays),null);
});

test('watchdogs trip and recover on synthetic order, cart, checkout, refund and feed silence', async () => {
  const o=await order();o.day='2026-09-23';o.paidAt='2026-09-23T10:30:00Z';o.fulfillmentStatus='FULFILLED';
  const sessions={day:'2026-09-30',sessions:100,carts:1,checkouts:10,completed:0,uk:0,us:100,usCarts:0,ukCarts:1,ukCheckouts:10,usCheckouts:0,ukCompleted:0,usCompleted:0,missouri:0,marketReliable:true};
  const f=facts([o],'2026-08-01',[{kind:'sessions',data:sessions,fetched_at:now}]);
  const observation={...blankObservation(),lastObserved:now.toISOString(),initialized:true,cartless:75,checkoutSince:'2026-09-30T10:30:00Z'};
  const map=Object.fromEntries(evaluateWatchdogs(f,now,settings,observation,[],[]).map(c=>[c.id,c]));
  assert.equal(map.orders!.status,'tripped');assert.equal(map.us_cart!.status,'tripped');assert.equal(map.checkout!.status,'tripped');assert.equal(map.geo!.status,'pass');
  const current={...o,id:'gid://shopify/Order/990009',day:'2026-09-30',paidAt:'2026-09-30T11:59:00Z'};
  const recovered=evaluateWatchdogs(facts([o,current],'2026-08-01',f.records.filter(r=>r.kind==='sessions')),now,settings,{...observation,cartless:0,checkoutSince:null},[],[]);
  assert.equal(recovered.find(c=>c.id==='orders')!.status,'pass');assert.equal(recovered.find(c=>c.id==='checkout')!.status,'pass');
  const noBaseline=evaluateWatchdogs(facts([current]),now,settings,blankObservation(),[],[]);assert.equal(noBaseline.find(c=>c.id==='us_cart')!.status,'unknown');
  const failing=facts([o]);failing.jobs.find(j=>j.name==='poll')!.failures=2;
  assert.equal(evaluateWatchdogs(failing,now,{...settings,keyExpiryDates:[{keyName:'SHOPIFY_CLIENT_SECRET',expiresOn:'2026-10-14'}]},blankObservation(),[],[]).find(c=>c.id==='self')!.status,'tripped');
  const refund={...current,refunds:[{id:'gid://shopify/Refund/990010',createdAt:now.toISOString(),itemsPence:500,taxPence:100}]};
  assert.equal(evaluateWatchdogs(facts([refund]),now,settings,blankObservation(),[],[]).find(c=>c.id==='refunds')!.status,'tripped');
});

test('report observations are persistent, idempotent and reset on carts/completions and report corrections', async t => {
  const db=await createTestDatabase();t.after(()=>db.close());
  const s=cleanSessions((await fixture('sessions')).data.shopifyqlQuery.tableData)[0]!;
  const f=facts([], '2026-08-01',[{kind:'sessions',data:s,fetched_at:now}]);
  const initial=await updateObservation(db,'live',f,now);assert.equal(initial.initialized,false);
  const later=new Date(now.getTime()+300_000); f.records[0]!.data={...s,us:s.us+80};f.records[0]!.fetched_at=later;
  const changed=await updateObservation(db,'live',f,later);assert.equal(changed.cartless,80);assert.equal(changed.initialized,true);
  assert.deepEqual(await updateObservation(db,'live',f,later),changed);
  const withCart={...f.records[0]!.data,usCarts:s.usCarts+1};
  assert.equal(observe(changed,withCart,new Date(later.getTime()+300_000),later).cartless,0);
  assert.equal(observe({...changed,checkoutSince:now.toISOString()},{...withCart,completed:s.completed+1},new Date(later.getTime()+300_000),later).checkoutSince,null);
  assert.equal(observe(changed,{...s,us:1},new Date(later.getTime()+300_000),later).cartless,0);
});

test('daily channels check reports shortage and recovery over the same UK dates; bad reports keep the last good notice', async t => {
  const db=await createTestDatabase();t.after(()=>db.close());
  class Reader extends SampleShopify {
    short=true;bad=false;
    override async report(query:string) {
      if (!query.includes('sales_channel')) return super.report(query);
      assert.equal(query,channelQuery('2026-09-23','2026-09-29'));
      return {columns:[{name:'day'},{name:'sales_channel'},{name:'orders'}],rows:[['2026-09-29','TikTok',this.bad ? 'bad' : this.short ? 2 : 0]]};
    }
    override async subscribe() {}
  }
  const reader=new Reader();const worker=new ShopifyWorker(db,{SHOPIFY_CLIENT_ID:randomUUID(),SHOPIFY_CLIENT_SECRET:randomUUID()},'https://pulse.example.test',{reader,clock:()=>now});
  await worker.initialize();await worker.tick();
  let notices=(await worker.store.facts()).noticeDetails.filter(n=>n.kind==='channel_short');assert.equal(notices.length,1);assert.deepEqual(notices[0]!.detail,{channel:'tiktok',stored:0,reported:2,from:'2026-09-23',to:'2026-09-29'});
  reader.bad=true;await db.query("UPDATE pulse.shopify_jobs SET next_run_at=$1 WHERE name='reconcile'",[now]);await worker.tick();assert.equal((await worker.store.facts()).noticeDetails.filter(n=>n.kind==='channel_short').length,1);
  reader.bad=false;reader.short=false;await db.query("UPDATE pulse.shopify_jobs SET next_run_at=$1 WHERE name='reconcile'",[now]);await worker.tick();assert.equal((await worker.store.facts()).noticeDetails.filter(n=>n.kind==='channel_short').length,0);
});

test('integrated live dashboard has no example Shopify values; mode changes cannot read sample records; rendered data is escaped', async t => {
  const db=await createTestDatabase();t.after(()=>db.close());
  const store=new ShopifyStore(db,'sample');await store.orders([(await fixture('order')).data.order],now);
  assert.equal((await new ShopifyStore(db,'live').facts()).records.length,0);
  const o=await order();o.paidAt=now.toISOString();o.fulfillmentStatus='UNFULFILLED';
  const snap=await applyShopifyDashboard(getSampleDashboard(),db,facts([o]),settings,[],now);
  assert.equal(snap.hero.today.net.mode,'live');assert.equal(snap.hero.today.net.n,66.62);assert.equal(snap.hero.today.spend.unavailable,true);
  assert.equal(snap.widgets.w037!.mode,'live');assert.match(snap.banner!,/Advertising.*sample/);
  const html=dashboardPage(snap);assert.match(html,/£66.62/);assert.ok(!html.includes('£296'));assert.match(html,/New reviews/);
  snap.shopify!.needs=[{id:'unsafe',state:'warn',title:'<script>alert(1)</script>',why:'<img src=x onerror=alert(1)>',link:'https://admin.shopify.com/store/example'}];
  assert.ok(!needsHtml(snap.shopify!).includes('<script>'));assert.match(needsHtml(snap.shopify!),/&lt;img/);
});
