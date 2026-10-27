import assert from 'node:assert/strict';
import {dashboardPage} from '../src/dashboard-view.js';
import type {DashboardSnapshot} from '../src/dashboard-types.js';
import type {Page} from 'playwright';
export async function checkAdSets(page:Page,origin:string):Promise<void>{
 const response=await page.request.get(origin+'/api/dashboard');assert.equal(response.status(),200);
 const fixture=await response.json() as DashboardSnapshot;
 // Exercise sample Decisions without Shopify; live Shopify deliberately suppresses sample decisions.
 delete fixture.shopify;
 await page.route('**/api/dashboard',route=>route.fulfill({json:fixture}));
 await page.route('**/api/events',route=>route.fulfill({contentType:'text/event-stream',body:`retry: 60000\nevent: dashboard\ndata: ${JSON.stringify(fixture)}\n\n`}));
 await page.route(origin+'/',route=>route.fulfill({contentType:'text/html',body:dashboardPage(fixture)}));
 await page.goto(origin+'/');await page.locator('#act [data-adset-verdict]').first().waitFor();
 assert.deepEqual(await page.locator('#act [data-adset-verdict]').evaluateAll(rows=>rows.map(r=>r.getAttribute('data-adset-verdict'))),['Kill','Slipping','Step']);
 assert.deepEqual(await page.locator('#watch .wrow[data-adset-verdict]').evaluateAll(rows=>rows.map(r=>r.getAttribute('data-adset-verdict'))),['Delivery','Test share']);
 await page.locator('#act [data-adset-open]').first().click();await page.locator('#adset-sheet[open]').waitFor();assert.match(await page.locator('#adset-sheet').innerText(),/Last 7 UK days/);await page.locator('[data-adset-close]').click();
 await page.unroute('**/api/dashboard');await page.unroute('**/api/events');await page.unroute(origin+'/');
 await page.goto(origin+'/ads');assert.equal(await page.locator('[data-adset-row]').count(),8);
 if(process.env.PULSE_SCREENSHOT_DIR)await page.locator('.adset-table').screenshot({path:`${process.env.PULSE_SCREENSHOT_DIR}/adset-cards-${page.viewportSize()!.width}-${await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}.png`});
 assert.match(await page.locator('[data-owner=freelancer]').innerText(),/3d under trigger/);
 await page.locator('[data-adset-market=us]').click();assert.equal(await page.locator('[data-adset-row]').count(),0);
 await page.locator('[data-adset-market=all]').click();await page.locator('[data-adset-open]').first().click();await page.locator('#adset-sheet[open]').waitFor();await page.locator('[data-adset-close]').click();
 if(page.viewportSize()!.width===390){
  assert.ok((await page.locator('td[data-label=Reason]').first().boundingBox())!.width>300,'phone reason uses the full row width');
  assert.ok((await page.locator('.adset-table caption').boundingBox())!.width>300,'phone caption uses the full table width');
 }
 const top=(await page.locator('header.top').boundingBox())!,main=(await page.locator('main').boundingBox())!;assert.ok(main.y>=top.y+top.height,'Ads content clears the shared header');
 if(process.env.PULSE_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.PULSE_SCREENSHOT_DIR}/adsets-${page.viewportSize()!.width}-${await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}.png`,fullPage:false});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
}
