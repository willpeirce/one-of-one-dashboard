import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';
import type { DashboardSnapshot, Detail } from '../src/dashboard-types.js';
import { dashboardPage } from '../src/dashboard-view.js';
import { applyMailchimpDashboard } from '../src/mailchimp/dashboard.js';
import { mailchimpPresentationFacts } from '../test/helpers/mailchimp-facts.js';
import { defaultSettings } from '../src/settings.js';

/** Separate invented email data never alters the dense Home budget fixture. */
export async function checkMailchimpWidgets(context: BrowserContext): Promise<void> {
  const base=await(await context.request.get('/api/dashboard')).json() as DashboardSnapshot;
  const page=await context.newPage(),now=new Date('2026-10-26T12:00:00Z');
  let snapshot=structuredClone(base);
  const detail: Detail={why:'Invented Shopify view in GBP: 2 last-visit email orders.',rule:'Only last-visit medium=email.',src:'Shopify live · invented read'};
  await page.addInitScript(`(() => { const Native=window.EventSource; window.EventSource=class extends Native { constructor(url,options){super(url,options);window.mailchimpTestStream=this;} }; })();`);
  await page.route('**/api/dashboard',route=>route.fulfill({json:snapshot}));
  await page.route('**/api/events',route=>route.fulfill({contentType:'text/event-stream',body:`retry: 60000\nevent: dashboard\ndata: ${JSON.stringify(snapshot)}\n\n`}));
  await page.route('**/',route=>route.fulfill({contentType:'text/html',body:dashboardPage(snapshot)}));
  const publish=async()=>{
    snapshot.generatedAt=new Date(Date.parse(snapshot.generatedAt)+1000).toISOString();
    await page.evaluate(next=>(window as unknown as {mailchimpTestStream:EventSource}).mailchimpTestStream.dispatchEvent(new MessageEvent('dashboard',{data:JSON.stringify(next)})),snapshot);
    await page.waitForFunction(stamp=>document.documentElement.dataset.updatedAt===stamp,snapshot.generatedAt);
  };
  try {
    for(const viewport of [{width:390,height:844},{width:1280,height:960}]) {
      snapshot=structuredClone(base);snapshot.generatedAt=now.toISOString();
      for(const hero of Object.values(snapshot.hero)) {
        for(const [market,view] of [['all',hero],...Object.entries(hero.markets??{})] as const) {
          view.net.mode='live';
          view.business={email:{count:2,value:market==='uk'?'£15.00':market==='us'?'£30.00':'£45.00',partial:false,detail:structuredClone(detail)},refill:{count:0,detail:structuredClone(detail)},orderDays:[]};
        }
      }
      snapshot.widgets.w039={kind:'detail',source:['shopify'],mode:'live',state:'info',value:structuredClone(detail)};
      snapshot.textValues.t0268={source:['shopify'],mode:'live',value:'Email sales · Shopify'};
      applyMailchimpDashboard(snapshot,{...mailchimpPresentationFacts(),status:'pending',audience:null},defaultSettings(),now);
      await page.setViewportSize(viewport);await page.goto('/');
      await page.locator('html[data-dashboard-ready="true"]').waitFor();
      await page.locator('#tabs [data-tab="growth"]').click();
      assert.equal(await page.locator('#p-growth [data-sample-dials] [data-model-id="w038"]').count(),1);
      assert.equal(await page.locator('[data-model-id="w039"] .sv').innerText(),'£45.00');
      applyMailchimpDashboard(snapshot,{...mailchimpPresentationFacts(),flowCoverage:'unavailable'},defaultSettings(),now);await publish();
      assert.equal(await page.locator('#p-growth [data-primary-dials] [data-model-id="w038"]').count(),1);
      assert.match(await page.locator('[data-model-id="w038"]').getAttribute('aria-label')??'',/Email audience: Read/);
      for(const id of ['w043','w044','w045'])assert.equal(await page.locator(`#p-growth [data-sample-dials] [data-model-id="${id}"]`).count(),1);
      await page.locator('#market [data-market="us"]').click();
      assert.equal(await page.locator('[data-model-id="w039"] .sv').innerText(),'£30.00');
      assert.match(await page.locator('[data-model-id="w038"] .ds').innerText(),/all markets/);
      await page.locator('[data-model-id="w039"]').click();
      assert.match(await page.locator('#sh-extra').innerText(),/not available by API/);
      await publish();assert.equal(await page.locator('[data-model-id="w039"] .sv').innerText(),'£30.00');
      await page.locator('#sh-x').click();
      await page.locator('#p-growth .sample-dials > summary').click();
      assert.match(await page.locator('[data-model-id="w043"]').innerText(),/Mailchimp.*\$64\.00.*USD/s);
      assert.equal(await page.locator('[data-model-id="w043"] .sample-label').count(),1);
      await page.locator('[data-model-id="w043"]').click();
      assert.match(await page.locator('#sh-why').innerText(),/not available by API.*4 credited orders and \$64\.00 USD/s);
      await page.locator('#sh-x').click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.ok((await page.locator('[data-model-id="w038"]').boundingBox())!.height>=44);
    }
  } finally {await page.close();}
}
