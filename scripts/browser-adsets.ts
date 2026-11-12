import assert from 'node:assert/strict';
import type {Page} from 'playwright';
import type {DashboardSnapshot} from '../src/dashboard-types.js';
import {adSetName} from '../src/meta-adsets/name.js';
export async function checkAdSets(page:Page,origin:string):Promise<void>{
 // Ad-set decisions left Home on 12 Nov 2026 (Morning has them); /ads keeps the cards and the sheet.
 await page.goto(origin+'/ads');assert.equal(await page.locator('[data-adset-row]').count(),8);
 if(process.env.PULSE_SCREENSHOT_DIR)await page.locator('.adset-table').screenshot({path:`${process.env.PULSE_SCREENSHOT_DIR}/adset-cards-${page.viewportSize()!.width}-${await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}.png`});
 assert.match(await page.locator('[data-owner=freelancer]').innerText(),/3d under trigger/);
 await page.locator('[data-adset-market=us]').click();assert.equal(await page.locator('[data-adset-row]').count(),0);
 await page.locator('[data-adset-market=all]').click();await page.locator('[data-adset-open]').first().click();await page.locator('#adset-sheet[open]').waitFor();await page.locator('[data-adset-close]').click();
 if(page.viewportSize()!.width===1280)assert.ok((await page.locator('td[data-label=Set]').first().boundingBox())!.width>=200,'desktop Set column keeps a readable minimum width');
 if(page.viewportSize()!.width===390){
  assert.ok((await page.locator('td[data-label=Reason]').first().boundingBox())!.width>300,'phone reason uses the full row width');
  assert.ok((await page.locator('.adset-table caption').boundingBox())!.width>300,'phone caption uses the full table width');
 }
 const top=(await page.locator('header.top').boundingBox())!,main=(await page.locator('main').boundingBox())!;assert.ok(main.y>=top.y+top.height,'Ads content clears the shared header');
 if(process.env.PULSE_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.PULSE_SCREENSHOT_DIR}/adsets-${page.viewportSize()!.width}-${await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}.png`,fullPage:false});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 const response=await page.request.get(origin+'/api/dashboard');assert.equal(response.status(),200);
 const fixture=await response.json() as DashboardSnapshot;
 const linked=fixture.adSets!.rows.slice(0,2);
 const firstId=linked[0]!.set.id;
 await page.goto(`${origin}/ads#%${firstId.charCodeAt(0).toString(16)}${encodeURIComponent(firstId.slice(1))}`);
 await page.locator('#adset-sheet[open]').waitFor();
 assert.equal(await page.locator('#adset-sheet-content h2').innerText(),adSetName(linked[0]!.set.name));
 await page.locator('[data-adset-close]').click();
 await page.evaluate(id=>{location.hash=encodeURIComponent(id);},linked[1]!.set.id);
 await page.locator('#adset-sheet[open]').waitFor();
 assert.equal(await page.locator('#adset-sheet-content h2').innerText(),adSetName(linked[1]!.set.name));
 await page.locator('[data-adset-close]').click();
 for(const hash of ['','%E0%A4%A','invented-adset-not-listed']){
  await page.evaluate(value=>new Promise<void>(resolve=>{addEventListener('hashchange',()=>requestAnimationFrame(()=>resolve()),{once:true});location.hash=value;}),hash);
  assert.equal(await page.locator('#adset-sheet[open]').count(),0,'Unknown or malformed subject hashes do not open a sheet');
 }
 await page.goto(origin+'/ads');
 assert.equal(await page.locator('#adset-sheet[open]').count(),0,'No-hash navigation keeps the sheet closed');
}
