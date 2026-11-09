import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';
import type { DashboardSnapshot } from '../src/dashboard-types.js';
import { dashboardPage } from '../src/dashboard-view.js';
import { applyGoogleDashboard } from '../src/google-ads/dashboard.js';
import { googlePresentationFacts } from '../test/helpers/google-facts.js';
import { defaultSettings } from '../src/settings.js';

/** Google promotion has its own invented fixture; compact Home counts and budgets are untouched. */
export async function checkGoogleWidgets(context: BrowserContext): Promise<void> {
  const base = await (await context.request.get('/api/dashboard')).json() as DashboardSnapshot;
  const page = await context.newPage(), now = new Date('2026-10-26T12:00:00Z');
  let fixture = structuredClone(base);
  await page.addInitScript(`(() => { const Native=window.EventSource; window.EventSource=class extends Native { constructor(url,options){super(url,options);window.googleTestStream=this;} }; })();`);
  await page.route('**/api/dashboard', route => route.fulfill({json:fixture}));
  await page.route('**/api/events', route => route.fulfill({contentType:'text/event-stream',body:`retry: 60000\nevent: dashboard\ndata: ${JSON.stringify(fixture)}\n\n`}));
  await page.route('**/', route => route.fulfill({contentType:'text/html',body:dashboardPage(fixture)}));
  const publish = async () => {
    fixture.generatedAt = new Date(Date.parse(fixture.generatedAt) + 1000).toISOString();
    await page.evaluate(next => (window as unknown as {googleTestStream:EventSource}).googleTestStream.dispatchEvent(new MessageEvent('dashboard',{data:JSON.stringify(next)})),fixture);
    await page.waitForFunction(stamp => document.documentElement.dataset.updatedAt === stamp,fixture.generatedAt);
  };
  try {
    for (const viewport of [{width:390,height:844},{width:1280,height:960}]) {
      fixture = structuredClone(base); fixture.generatedAt = now.toISOString();
      for (const id of ['w001','w002','w019','w017']) fixture.widgets[id]!.mode = 'live';
      for (const hero of Object.values(fixture.hero)) for (const view of [hero, ...Object.values(hero.markets ?? {})]) {
        view.ukcpo.mode = 'live'; view.uscpo.mode = 'live';
      }
      await page.setViewportSize(viewport); await page.goto('/');
      await page.locator('html[data-dashboard-ready="true"]').waitFor();
      await page.locator('#tabs [data-tab="ads"]').click();
      assert.equal(await page.locator('#p-ads [data-sample-dials] [data-model-id="w024"]').count(),1);
      const onlyNetwork = googlePresentationFacts(); onlyNetwork.jobs = onlyNetwork.jobs.filter(job => job.kind !== 'conversions');
      applyGoogleDashboard(fixture,onlyNetwork,{mode:'sample',orders:[],ready:false,from:'2026-10-26'},defaultSettings(),undefined,now);
      await publish();
      assert.deepEqual((await page.locator('#p-ads [data-primary-dials] > [data-model-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-model-id')))).slice(0,5),['w001','w002','w019','w017','w024']);
      assert.equal(await page.locator('#p-ads [data-sample-dials] [data-model-id="w025"]').count(),1);
      assert.equal(await page.locator('[data-model-id="w024"] .sample-label').count(),0);
      applyGoogleDashboard(fixture,googlePresentationFacts(),{mode:'sample',orders:[],ready:false,from:'2026-10-26'},defaultSettings(),{
        hasRead:true,lastRead:now.toISOString(),error:null,events:[],notOurs:0,line:'Meta activity: invented successful read',
      },now);
      await publish();
      for (const id of ['w024','w025','w026','w028']) {
        assert.equal(await page.locator(`#p-ads [data-primary-dials] [data-model-id="${id}"]`).count(),1);
        assert.equal(await page.locator(`[data-model-id="${id}"]`).getAttribute('data-state'),'info');
      }
      await page.locator('#market [data-market="us"]').click();
      assert.match(await page.locator('[data-model-id="w024"]').getAttribute('aria-label') ?? '', /YouTube share: 0.0%/);
      assert.match(await page.locator('[data-model-id="w025"]').getAttribute('aria-label') ?? '', /50.0%/);
      await page.locator('[data-model-id="w026"]').click();
      assert.match(await page.locator('#sh-why').innerText(),/Shopify comparison unavailable/);
      assert.match(await page.locator('#sh-src').innerText(),/lag about 3 hours/);
      await publish();
      assert.equal(await page.locator('#market [aria-selected="true"]').getAttribute('data-market'),'us');
      assert.match(await page.locator('[data-model-id="w025"]').getAttribute('aria-label') ?? '', /50.0%/);
      assert.match(await page.locator('#sh-why').innerText(),/7.00 conversions/);
      await page.locator('#sh-x').click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.ok((await page.locator('[data-model-id="w024"]').boundingBox())!.height>=44);
      await page.locator('#market [data-market="all"]').click();
    }
  } finally { await page.close(); }
}
