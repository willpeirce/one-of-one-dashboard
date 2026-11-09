import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMailchimpDashboard } from '../src/mailchimp/dashboard.js';
import { mailchimpPresentationFacts } from './helpers/mailchimp-facts.js';
import { getSampleDashboard } from '../src/sample-dashboard.js';
import { defaultSettings } from '../src/settings.js';
import { fixture } from '../src/shopify/sample.js';
import { cleanOrder, type Order } from '../src/shopify/model.js';
import { emailFlow, isLastVisitEmail, shopifyHero, type Facts } from '../src/shopify/metrics.js';
import { applyShopifyDashboard } from '../src/shopify/dashboard.js';
import { createTestDatabase } from './helpers/database.js';

const now = new Date('2026-10-26T12:00:00Z'), settings = defaultSettings();
function facts(orders: Order[]): Facts {
  return {mode:'live',sample:false,counts:{},pendingWebhooks:0, failedWebhooks: [],notices:[],geoNotice:null,noticeDetails:[],
    jobs:['backfill','poll','sessions','inventory','reconcile','subscriptions'].map(name=>({name,state:name==='backfill'?{from:'2026-09-01',until:now.toISOString(),ordersDone:true,allOrders:true}:{},last_success_at:now,failures:0})),
    records:orders.map(data=>({kind:'order',data,fetched_at:now}))};
}
async function emailOrders(): Promise<Order[]> {
  const base = cleanOrder((await fixture('order')).data.order);
  return [
    {...base,id:'invented-email-uk',day:'2026-10-25',market:'UK',itemsAfterDiscountsPence:2000,refunds:[],lastVisit:{medium:' Email ',campaign:'invented-email'}},
    {...base,id:'invented-email-us',day:'2026-10-25',market:'US',itemsAfterDiscountsPence:3000,refunds:[],lastVisit:{medium:'email',campaign:'invented-email'}},
    {...base,id:'invented-discount-only',day:'2026-10-25',itemsAfterDiscountsPence:4000,refunds:[],lastVisit:null,discountSignals:['REFILLSHIP']},
    {...base,id:'invented-first-only',day:'2026-10-25',itemsAfterDiscountsPence:5000,refunds:[],firstVisit:{medium:'email'},lastVisit:{medium:'organic'},order_referrer_source:'email'},
    {...base,id:'invented-old-email-refund',day:'2026-10-10',market:'UK',itemsAfterDiscountsPence:1200,lastVisit:{medium:'email'},refunds:[{id:'invented-email-refund',createdAt:'2026-10-25T12:00:00Z',itemsPence:500,taxPence:0}]},
  ] as Order[];
}

test('Shopify email money uses only last-visit email, keeps refund event dates and changes by market', async t => {
  const orders = await emailOrders(), f = facts(orders);
  assert.deepEqual(orders.map(isLastVisitEmail),[true,true,false,false,true]);
  assert.equal(emailFlow(orders[2]!), 'D30 refill (code backup)', 'refill code attribution remains available separately');
  const hero=shopifyHero(f,'2026-10-26','2026-10-20','2026-10-26',settings,undefined,undefined,undefined,now);
  assert.equal(hero.business!.email.count,2); assert.equal(hero.business!.email.value,'£45.00');
  assert.equal(hero.markets!.uk.business!.email.value,'£15.00'); assert.equal(hero.markets!.us.business!.email.value,'£30.00');
  assert.match(hero.business!.email.detail.rule,/Shopify view in GBP/);
  const db=await createTestDatabase();t.after(()=>db.close());
  const snapshot=await applyShopifyDashboard(getSampleDashboard(),db,f,settings,[],now);
  assert.equal(snapshot.textValues.t0268!.value,'Email sales · Shopify'); assert.equal(snapshot.textValues.t0269!.value,'£45.00');
  assert.deepEqual(snapshot.widgets.w039!.source,['shopify']);
});

test('early attribution and incomplete or continuing reads never become measured zero email sales', () => {
  const f=facts([]);
  const early=shopifyHero(f,'2026-10-26','2026-09-20','2026-09-26',settings,undefined,undefined,undefined,now).business!.email;
  assert.equal(early.value,'Partial');assert.match(early.detail.why,/partial/);assert.doesNotMatch(early.detail.why,/£0\.00|0 last-visit/);
  f.jobs.find(job=>job.name==='backfill')!.state.until='2026-10-19T12:00:00Z';
  f.jobs.find(job=>job.name==='poll')!.last_success_at=new Date('2026-10-19T12:00:00Z');
  let unavailable=shopifyHero(f,'2026-10-26','2026-10-20','2026-10-26',settings,undefined,undefined,undefined,now).business!.email;
  assert.equal(unavailable.value,'Unavailable');assert.match(unavailable.detail.why,/history incomplete/);assert.doesNotMatch(unavailable.detail.why,/£0\.00|0 last-visit/);
  f.jobs.find(job=>job.name==='poll')!.last_success_at=now;f.jobs.find(job=>job.name==='poll')!.state.continuing=true;
  unavailable=shopifyHero(f,'2026-10-26','2026-10-20','2026-10-26',settings,undefined,undefined,undefined,now).business!.email;
  assert.equal(unavailable.value,'Unavailable');
  const poll=f.jobs.find(job=>job.name==='poll')!;
  poll.state.continuing=false;poll.last_success_at=new Date('2026-10-26T00:02:00Z');
  poll.state.query='updated_at:>=2026-10-25T21:00:00Z updated_at:<=2026-10-25T23:59:00Z';
  unavailable=shopifyHero(f,'2026-10-26','2026-10-20','2026-10-26',settings,undefined,undefined,undefined,now).business!.email;
  assert.equal(unavailable.value,'Unavailable','finishing yesterday’s paginated query after midnight does not cover today');
});

test('Mailchimp audience promotes independently with approximate total, neutral plan context and no inferred country split', () => {
  const source=mailchimpPresentationFacts(), snapshot=getSampleDashboard();
  applyMailchimpDashboard(snapshot,source,settings,now);
  const audience=snapshot.widgets.w038!;if(audience.kind!=='dial')return assert.fail();
  assert.equal(audience.mode,'live');assert.equal(audience.value.t,'Read');assert.equal(audience.value.hidePointer,true);
  assert.match(audience.value.s,/all markets.*plan not set/);assert.match(audience.value.d.why,/approximately 720/);
  assert.ok(audience.value.z.every(zone=>zone[2]==='info'));
  const withPlan=getSampleDashboard();applyMailchimpDashboard(withPlan,source,{...settings,mailchimpPlanLimit:1000,mailchimpBillingDay:7},now);
  const dial=withPlan.widgets.w038!;if(dial.kind!=='dial')return assert.fail();
  assert.equal(dial.value.v,72);assert.equal(dial.value.t,'≈72.0%');assert.match(dial.value.d.why,/not an exact billing count/);
  for(const altered of [{...source,mode:'sample' as const},{...source,status:'pending' as const},{...source,status:'unavailable' as const},
    {...source,fetchedAt:'2026-10-25T12:00:00Z'},{...source,fetchedAt:'2026-10-27T12:00:00Z'},
    {...source,audience:{...source.audience!,contacts:null}}]) {
    const waiting=getSampleDashboard();applyMailchimpDashboard(waiting,altered,settings,now);assert.equal(waiting.widgets.w038!.mode,'sample');
  }
});

test('Mailchimp per-flow dollars remain sample and API gaps are stated beside the independent Shopify GBP view', async () => {
  const source=mailchimpPresentationFacts(), snapshot=getSampleDashboard();
  const hero=shopifyHero(facts(await emailOrders()),'2026-10-26','2026-10-20','2026-10-26',settings,undefined,undefined,undefined,now);
  snapshot.hero.today=hero;snapshot.widgets.w039={kind:'detail',source:['shopify'],mode:'live',value:hero.business!.email.detail};
  applyMailchimpDashboard(snapshot,{...source,flowCoverage:'unavailable'},settings,now);
  for(const id of ['w043','w044','w045']) {
    const widget=snapshot.widgets[id]!;if(widget.kind!=='detail')return assert.fail();
    assert.equal(widget.mode,'sample');assert.equal(widget.state,'info');assert.match(widget.value.why,/not available by API/);
  }
  assert.equal(snapshot.widgets.w039.mode,'live');assert.equal(snapshot.hero.today.business!.email.value,'£45.00');
  assert.match(snapshot.textValues.t0279!.value,/Sample own credit · USD/);
  const mailchimp = snapshot.widgets.w043!; if (mailchimp.kind !== 'detail') return assert.fail();
  assert.match(mailchimp.value.why, /4 credited orders and \$64\.00 USD/);
  assert.ok(snapshot.hero.today.markets!.uk.business!.email.detail.extra!.some(([key,value])=>key==='Mailchimp view'&&value.includes('not available by API')));
});
