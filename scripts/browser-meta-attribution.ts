import assert from 'node:assert/strict';
import type {BrowserContext} from 'playwright';
import type {DashboardSnapshot,DialModel} from '../src/dashboard-types.js';
export async function checkMetaAttribution(context:BrowserContext):Promise<void>{
 const page=await context.newPage();
 try{
  const fixture=await (await context.request.get('/api/dashboard')).json() as DashboardSnapshot;
  const sample=fixture.widgets.w019!;assert.equal(sample.kind,'dial');if(sample.kind!=='dial')return;
  const dial=(market:string,value:number,cap:DialModel['cap']):DialModel=>({...sample.value,v:value,t:`${value.toFixed(2)}×`,cap,s:`${market} · last 14 complete UK days`,d:{...sample.value.d,why:`Invented ${market} ratio detail`}});
  fixture.widgets.w019={...sample,mode:'live',value:dial('All',1.5,'good'),markets:{all:dial('All',1.5,'good'),uk:dial('UK',1.8,'warn'),us:dial('US',1.81,'alarm')}};
  await page.route('**/api/dashboard',route=>route.fulfill({json:fixture}));
  await page.route('**/api/events',route=>route.fulfill({contentType:'text/event-stream',body:`event: dashboard\ndata: ${JSON.stringify(fixture)}\n\n`}));
  for(const width of [390,1280]){
   await page.setViewportSize({width,height:960});await page.goto('/');await page.locator('html[data-dashboard-ready=true]').waitFor();
   const tile=page.locator('[data-model-id=w019]');
   for(const [market,value,state] of [['all','1.50','good'],['uk','1.80','warn'],['us','1.81','alarm']]){
    await page.locator(`#market [data-market=${market}]`).click();
    assert.equal(await tile.getAttribute('data-state'),state);
    assert.match(await tile.innerText(),new RegExp(`${value}×`));
    await tile.click();assert.match(await page.locator('#sh-why').innerText(),/Invented .* ratio detail/);
    await page.keyboard.press('Escape');
   }
  }
 }finally{await page.close();}
}
