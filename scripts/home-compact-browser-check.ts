import assert from 'node:assert/strict';
import type { BrowserContext, Locator, Page } from 'playwright';
import type { DashboardSnapshot, DialModel } from '../src/dashboard-types.js';
import { dashboardPage } from '../src/dashboard-view.js';
import { sampleAdSetsView } from '../src/meta-adsets/presentation.js';
import { defaultSettings } from '../src/settings.js';
import { sampleSeriesPaceCard } from '../src/series-pace/presentation.js';
import { checkHomeChapters } from './chapter-browser-check.js';

const long = 'Invented compact Home fixture with deliberately long evidence that must wrap and stop cleanly instead of making a tall card. ';
const instant = '2026-10-27T12:00:00Z';

/** All identities, copy and measures are invented. The fixture stays dense when production data is sparse. */
export function compactHomeFixture(base: DashboardSnapshot): DashboardSnapshot {
  const fixture = structuredClone(base);
  fixture.generatedAt = instant;
  fixture.adSets = sampleAdSetsView(defaultSettings());
  fixture.adSets.mode = 'live';
  for (const row of fixture.adSets.rows) {
    row.set.name = `Invented ${row.verdict?.verdict ?? 'clear'} ${long}`;
    if (row.verdict) row.verdict.reason = long.repeat(3);
  }
  assert.ok(fixture.shopify && fixture.creatives, 'The fixture needs the existing presentation shapes');
  fixture.shopify.mode = 'live';
  fixture.shopify.needs = [
    { id: 'invented-alarm', state: 'alarm', source: 'pulse', title: long.repeat(2), why: long.repeat(3), link: '/sources', figure: {value: '1', label: 'check tripped'} },
    ...Array.from({length: 7}, (_, index) => ({id: `invented-watch-${index}`, state: 'warn' as const,
      source: index === 0 ? 'meta' as const : 'shopify' as const, title: `Invented watch ${index} ${long}`, why: long.repeat(3),
      link: index === 0 ? '/ads' : '/sources', figure: {value: String(index + 2), label: 'invented items'}})),
  ];
  fixture.shopify.checks = Array.from({length: 15}, (_, index) => ({id: `invented-check-${index}`, name: `Invented check ${index}`,
    status: index === 0 ? 'tripped' : 'pass', why: long, link: '/sources'}));
  fixture.shopify.stock = Array.from({length: 4}, (_, product) => ['uk','us'].map((market, index) => ({
    productId: `invented-product-${product}`, product: `Invented product ${product}`, market,
    locationId: `invented-location-${market}`, name: `Invented product ${product} · ${market}`,
    available: product === 2 && index === 0 ? 50 : 100, required: product === 2 ? 100 : null,
    dailyRate: product === 2 ? null : 1, cover: product === 0 ? index === 0 ? 10 : 30 : product === 1 ? index === 0 ? 45 : 75 : product === 2 ? null : 90,
    runOut: null, basis: 'Invented stock basis',
  }))).flat() as NonNullable<DashboardSnapshot['shopify']>['stock'];
  fixture.reviews = {mode: 'live', status: 'live', publishEnabled: false, unreadCount: 6, asOf: instant, checkedAt: instant,
    rows: Array.from({length: 6}, (_, index) => ({id: `invented-review-${index}`, rating: index < 2 ? index + 1 : 5,
      productTitle: `Invented product ${index}`, productHandle: `invented-product-${index}`, market: index % 2 ? 'UK' : null,
      verifiedBuyer: true, photoCount: 1, body: long.repeat(3), createdAt: `2026-10-${String(26 - index).padStart(2,'0')}T12:00:00Z`,
      published: false, hidden: false, flagged: false, source: null, curated: 'ok'}))};
  fixture.reviews.rows.reverse(); // Deliberately out of presentation order: low stars and newest must win.
  fixture.creatives.mode = 'live';
  fixture.creatives.selection = {...fixture.creatives.selection, window: '3d', market: 'all', owner: 'all', liftWindow: 7};
  const group = fixture.creatives.top.groups[0];
  assert.ok(group, 'Dense fixture has a top creative');
  fixture.creatives.top.groups = Array.from({length: 3}, (_, index) => ({...structuredClone(group),
    group: {...structuredClone(group.group), id: `invented-creative-${index}`, title: `Invented creative ${index}`, thumbnailUrl: group.group.thumbnailUrl}}));
  fixture.creatives.top.message = long.repeat(3);
  fixture.creatives.cards = [
    {id: 'invented-make-next', kind: 'decide', mode: 'live', groupId: 'invented-creative-0', picture: group.group.thumbnailUrl,
      title: `Make next ${long}`, reason: long.repeat(3), brief: 'Invented copy brief for the compact Home regression.'},
    {id: 'invented-creative-watch', kind: 'watch', mode: 'live', groupId: 'invented-creative-1', picture: group.group.thumbnailUrl,
      title: `Invented creative watch ${long}`, reason: long.repeat(3), brief: 'Invented watch brief.'},
  ];
  for (const kind of ['image','video'] as const) {
    const brief = fixture.creatives.homeMakeNext[kind];
    brief.bullets = Array.from({length: 3}, (_, index) => ({text: `Invented ${kind} instruction ${index} for the next sample asset.`, confidence: 'Strong', liftIds: []}));
    brief.brief = `Invented ${kind} copy brief.`;
  }
  for (const widget of Object.values(fixture.widgets)) {
    widget.mode = 'sample';
    if (widget.kind === 'dial') {widget.value.cap = 'good'; if (widget.markets) for (const dial of Object.values(widget.markets)) dial.cap = 'good';}
  }
  // Freeze every visible live dial: the real server's derived hero and earlier Settings checks
  // must not change the density of this invented fixture. Keep full pace facts and long subtitles.
  const cpo = (market: 'UK' | 'US'): DialModel & {mode:'live';source:['meta','shopify']} => ({
    v:18,min:0,max:60,t:'£18.00',l:`${market} cost per order`,s:'Invented spend per counted order · complete UK days only',
    z:[[0,30,'good'],[30,60,'warn']],cap:'good',mode:'live',source:['meta','shopify'],
    d:{why:long,rule:long,src:'Invented Meta and Shopify facts'},
  });
  for (const [key,market] of [['w001','UK'],['w002','US']] as const) {
    fixture.widgets[key]={kind:'dial',mode:'live',source:['meta','shopify'],value:cpo(market)};
  }
  const ratio: DialModel={v:1.4,min:0,max:2,t:'1.4×',l:'Counted order ratio',
    s:'Invented Meta and Shopify comparison · complete UK days only',z:[[0,1.2,'good'],[1.2,2,'warn']],cap:'warn',
    d:{why:long,rule:long,src:'Invented attribution facts'}};
  fixture.widgets.w019={kind:'dial',mode:'live',source:['meta','shopify'],value:ratio,
    markets:{all:structuredClone(ratio),uk:structuredClone(ratio),us:structuredClone(ratio)}};
  const pace=sampleSeriesPaceCard(instant);
  for (const market of Object.values(pace.markets)) {market.status='waiting';market.state='muted';}
  fixture.widgets.w017={kind:'series-pace',mode:'live',source:['shopify'],value:pace};
  for (const hero of Object.values(fixture.hero)) {
    hero.ukcpo=cpo('UK');hero.uscpo=cpo('US');
    for (const value of Object.values(hero)) if (value && typeof value === 'object' && 'state' in value) value.state = 'good';
    if (hero.markets) for (const market of Object.values(hero.markets)) {
      market.ukcpo=cpo('UK');market.uscpo=cpo('US');
      for (const value of Object.values(market)) if (value && typeof value === 'object' && 'state' in value) value.state = 'good';
    }
  }
  for (const [key, text] of Object.entries(fixture.textValues)) {
    if (['t0203','t0208','t0234','t0238','t0212'].includes(key)) text.value = long.repeat(2);
  }
  fixture.sourceHealth = [{source:'meta',name:'Meta',stage:2,requiredKeys:[],mode:'live',status:'healthy',
    lastSuccessAt:new Date(instant),lastAttemptAt:new Date(instant),consecutiveFailures:0,updatedAt:new Date(instant)}];
  return fixture;
}

async function visibleControls(scope: Locator): Promise<Locator[]> {
  const visible: Locator[] = [];
  for (const control of await scope.locator('button,a,summary').all()) {
    if (!await control.isVisible()) continue;
    const insideClosedBody = await control.evaluate(element => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(element)) return true;
      }
      return false;
    });
    if (!insideClosedBody) visible.push(control);
  }
  return visible;
}

async function assertPrimaryLiveDials(page: Page): Promise<void> {
  for (const id of ['w001','w002','w019','w017']) {
    const liveTile = page.locator(`#p-ads [data-primary-dials] [data-model-id="${id}"][data-mode=live]`);
    assert.equal(await liveTile.count(),1,`${id} belongs in the primary live dial grid`);
    assert.equal(await liveTile.isVisible(),true,`${id} is visible before expanding sample dials`);
  }
}

async function budget(page: Page, width: number): Promise<void> {
  const heights = width === 390 ? {table:1610,reviews:455,tests:680,dials:1800,foot:90} : {table:800,reviews:360,tests:380,dials:1000,foot:70};
  const controls = {table:16,reviews:6,tests:6,dials:24,foot:3};
  for (const id of ['table','reviews','tests','dials','foot'] as const) {
    const section = page.locator(`#${id}`), box = await section.boundingBox();
    assert.ok(box && box.height <= heights[id], `${width}px #${id} height ${box?.height} exceeds ${heights[id]}`);
    const shown = await visibleControls(section);
    assert.ok(shown.length <= controls[id], `${width}px #${id}: ${shown.length} visible controls exceeds ${controls[id]}`);
    for (const control of shown) {
      const bounds = await control.boundingBox();
      assert.ok(bounds && bounds.height >= 44, `${width}px #${id}: ${await control.evaluate(el => el.outerHTML.slice(0,180))} is shorter than 44px`);
    }
  }
  await assertPrimaryLiveDials(page);
  const act = page.locator('#act .dcard');
  const shown = [];
  for (const card of await act.all()) if (await card.isVisible()) shown.push(card);
  assert.equal(shown.length,3,'Exactly three act cards show before expansion');
  assert.deepEqual(await Promise.all(shown.map(card=>card.getAttribute('data-rank'))),['0','1','2']);
  assert.deepEqual(await act.evaluateAll(cards=>cards.map(card=>card.getAttribute('data-rank'))),['0','1','2','3','4']);
  for (const card of shown) {
    const actions = await visibleControls(card); assert.equal(actions.length,2);
    for (const action of actions) {const box = await action.boundingBox(); assert.ok(box && box.width>=44 && box.height>=44);}
  }
  for (const [selector,max] of [['#act .act-title',1],['#act .act-reason',2],['#watch .watch-text',2],['#tests .test-name',2],['.creative-floor',2],['#reviews .rec',1]] as const) {
    const elements = page.locator(selector); assert.ok(await elements.count(), `${selector} exists`);
    for (const element of await elements.all()) {
      if (!await element.isVisible()) continue;
      const measure = await element.evaluate(el=>({height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight),ellipsis:getComputedStyle(el).textOverflow}));
      assert.ok(Number.isFinite(measure.line) && Math.round(measure.height/measure.line)<=max,`${selector} exceeds ${max} lines: ${JSON.stringify(measure)}`);
      if(selector==='#act .act-title'||selector==='#reviews .rec')assert.equal(measure.ellipsis,'ellipsis');
    }
  }
  assert.ok(await page.locator('#tests .tcard,#tests .trow').count() >= 5);
  assert.equal(await page.locator('#creative-panel .creative-top .creative-picture').count(),3);
  assert.equal(await page.locator('#reviews .rt[data-review-open]').count(),6);
  assert.equal(await page.locator('#watch .wrow').count(),10);
  assert.equal(await page.locator('#stock [data-stock-market]').count(),8,'One cell per product and market, including fine folded products');
  assert.deepEqual(await page.locator('#stock [data-stock-market]').evaluateAll(cells=>cells.map(cell=>`${cell.getAttribute('data-stock-product')}:${cell.getAttribute('data-stock-market')}`).sort()), Array.from({length:4},(_,i)=>['uk','us'].map(m=>`Invented product ${i}:${m}`)).flat().sort());
  assert.equal(await page.locator('#stock [data-state=good]').count(),0,'Fine stock cells do not inflate good counts');
  assert.deepEqual(await page.locator('#reviews [data-review-open]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-review-open'))),Array.from({length:6},(_,i)=>`invented-review-${i}`));
  assert.equal(await page.locator('#checks [data-state]').count(),0);
  assert.match(await page.locator('#checks').innerText(),/14 of 15 checks passing/);
  assert.doesNotMatch((await page.locator('#reviews .rvlist').allTextContents()).join(' '),/Market unknown|Verified buyer|Judge.me/);
  assert.doesNotMatch((await page.locator('#deck [data-source="meta"]').allTextContents()).join(' '),/Shopify/);
  // Worked by hand: 1 alarm need + 1 red stock cell; four Decide cards;
  // 7 needs + Delivery + Test share + creative Watch + 3 amber stock cells + 1 live amber dial.
  assert.equal(await page.locator('#deck [data-state="alarm"]').count(),2);
  assert.equal(await page.locator('#deck [data-state="decide"]').count(),4);
  assert.equal(await page.locator('#deck [data-state="warn"]').count(),13);
  assert.equal(await page.locator('#watch .amber-dials').innerText(),'1 dials in amber');
  assert.match(await page.locator('#deckcount').innerText(),/2 alarms · 4 decisions/);
  assert.match((await page.locator('#counts').innerText()).replace(/\s+/g,' '),/14 to watch/);
  assert.match((await page.locator('#counts').innerText()).replace(/\s+/g,' '),/2 alarms/);
  assert.match((await page.locator('#counts').innerText()).replace(/\s+/g,' '),/4 decisions/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}px has no horizontal overflow`);
}

/** Hard Home budgets: never raise these numbers to accommodate a regression. */
export async function checkHomeCompact(context: BrowserContext): Promise<void> {
  const response = await context.request.get('/api/dashboard'); assert.equal(response.status(),200);
  const base = await response.json() as DashboardSnapshot;
  const page = await context.newPage();
  let fixture = compactHomeFixture(base), actions: {cardId:string;action:string}[] = [];
  try {
    await page.route('**/api/dashboard',route=>route.fulfill({json:fixture}));
    await page.route('**/api/events',route=>route.fulfill({contentType:'text/event-stream',body:`retry: 60000\nevent: dashboard\ndata: ${JSON.stringify(fixture)}\n\n`}));
    await page.route('**/api/meta/adsets',route=>route.fulfill({json:fixture.adSets}));
    await page.route('**/api/creatives?*',route=>route.fulfill({json:fixture.creatives}));
    await page.route('**/api/creatives/cards',async route=>{
      const body=route.request().postDataJSON(); actions.push(body);
      fixture.creatives!.cards=fixture.creatives!.cards.filter(card=>card.id!==body.cardId);
      await route.fulfill({json:{ok:true}});
    });
    await page.route('**/',route=>route.fulfill({contentType:'text/html',body:dashboardPage(fixture)}));
    await page.addInitScript({content:"Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__compactCopied=text;}}});"});
    for(const viewport of [{width:390,height:844},{width:1280,height:960}]) {
      fixture=compactHomeFixture(base); actions=[];
      await page.setViewportSize(viewport); await page.goto('/');
      await page.locator('html[data-dashboard-ready="true"]').waitFor();
      await page.evaluate(async () => { await document.fonts.ready; });
      console.log('COMPACT GEOMETRY', viewport.width, await page.locator('#table,#reviews,#tests,#dials,#foot').evaluateAll(rows=>rows.map(r=>({id:r.id,height:r.getBoundingClientRect().height}))));
      await budget(page,viewport.width);
      await checkHomeChapters(page);
      if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({path:`${process.env.PULSE_SCREENSHOT_DIR}/home-compact-${viewport.width}.png`,fullPage:true});
      // A real market update causes all three state paths to re-render their Home controls.
      await page.locator('#market [data-market="uk"]').click();
      await page.locator('#market [data-market="all"]').click();
      await assertPrimaryLiveDials(page);
      await page.locator('#act [data-adset-open]').first().click();
      await page.locator('#adset-sheet[open]').waitFor();
      assert.match(await page.locator('#adset-sheet').innerText(),/Last 7 UK days/);
      await page.locator('[data-adset-close]').click();
      await page.locator('#act details > summary').filter({hasText:/more decisions/}).click();
      const makeNext=page.locator('#act .dcard[data-rank="3"]');
      await makeNext.locator('[data-creative-copy]').click();
      assert.match(await page.locator('#creative-feedback').innerText(),/copied/i);
      assert.equal(await page.evaluate(()=>(window as any).__compactCopied),'Invented copy brief for the compact Home regression.');
      await makeNext.locator('summary[aria-label="More actions"]').click();
      await makeNext.locator('[data-creative-action="done"]').click();
      await page.waitForFunction(()=>document.querySelector('#creative-feedback')?.textContent?.includes('Done.'));
      assert.deepEqual(actions,[{cardId:'invented-make-next',action:'done'}]);
      await page.locator('#stock [data-tab="stock"]').click();
      assert.equal(await page.locator('#tabs [data-tab="stock"]').getAttribute('aria-selected'),'true');
      await page.locator('#reviews .rt[data-review-open]').first().click();
      await page.locator('#sheet[open]').waitFor();
      assert.match(await page.locator('#sh-extra').innerText(),/Verified buyer/i);
      await page.locator('#sh-x').click();
    }
  } finally {await page.close();}
}
