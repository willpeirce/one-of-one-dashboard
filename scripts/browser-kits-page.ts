import assert from 'node:assert/strict';
import type {BrowserContext, Locator, Page} from 'playwright';
import type {DashboardSnapshot} from '../src/dashboard-types.js';
import {kitsPageView} from '../src/kits/page-model.js';
import {kitsPage} from '../src/kits/page-view.js';
import {kitSheet} from '../src/kits/presentation.js';
import type {KitCardView} from '../src/kits/presentation-types.js';
import {sampleKitFacts} from '../src/kits/sample.js';
import {kitCardHtml} from '../src/kits/view.js';
import {tapArea} from './tap-area.js';
import {checkPlainKitCards} from './browser-kits.js';

const now = new Date('2032-12-07T12:00:00Z');
const ids = ['box-a', 'box-b', 'box-c', 'box-d', 'box-e', 'box-f'];

async function targets(scope: Locator): Promise<void> {
  for (const target of await scope.locator('a,button,summary,[data-kit-timeline-scroll]').all()) {
    if (!await target.isVisible()) continue;
    if (await target.getAttribute('id') === 'tk-next') {
      const area = await tapArea(target);
      assert.ok(area.width >= 44 && area.height >= 44 && area.edges, 'The existing ticker pill keeps its 44px pseudo-element hit area');
      continue;
    }
    const box = (await target.boundingBox())!;
    assert.ok(box.width >= 44 && box.height >= 44, `${await target.evaluate(element => element.outerHTML.slice(0, 120))} needs a 44px target`);
  }
}
async function layout(page: Page, width: number): Promise<void> {
  await page.evaluate(async () => {await document.fonts.ready; window.scrollTo({top: 0, behavior: 'instant'});});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px Kits has no sideways page scroll`);
  const header = (await page.locator('header.top').boundingBox())!, main = (await page.locator('main').boundingBox())!;
  assert.ok(main.y >= header.y + header.height && header.height < 70, 'Kits keeps the shared compact button header above its content');
  assert.equal(await page.locator('header.top + #tk-strip').count(), 1);
  await targets(page.locator('body'));
}

export async function checkKitsPage(context: BrowserContext): Promise<void> {
  const snapshot = await (await context.request.get('/api/dashboard')).json() as DashboardSnapshot;
  assert.ok(snapshot.kits?.cards.length);
  const homeCards: KitCardView[] = snapshot.kits.cards;
  const page = await context.newPage();
  try {
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({width, height: 960});
      await page.emulateMedia({colorScheme: 'light', reducedMotion: 'reduce'});
      const response = await page.goto('/kits'); assert.equal(response?.status(), 200);
      await page.getByRole('heading', {name: 'Kits', exact: true}).waitFor();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      assert.match(await page.locator('[data-kits-page]').innerText(), /Sample data · invented kits/);
      const cards = page.locator('[data-kits-page-cards] .kit-card');
      assert.deepEqual(await cards.evaluateAll(rows => rows.map(row => row.getAttribute('data-kit-open'))), ids,
        'Every kit, including Home’s folded rows, is a card in file order');
      assert.equal(await page.locator('[data-kits-fold]').count(), 0);
      await checkPlainKitCards(cards);
      for (const card of homeCards) {
        const expected: string = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').body.firstElementChild!.outerHTML, kitCardHtml(card));
        assert.equal(await page.locator(`[data-kits-page-cards] [data-kit-open="${card.id}"]`).evaluate(element => element.outerHTML), expected,
          'Home and Kits use identical card markup for the same projection');
      }
      assert.equal(await cards.first().locator('.kit-track-current').evaluate(element => getComputedStyle(element).animationName), 'none');
      const timeline = page.locator('[data-kit-timeline-scroll]');
      assert.equal(await timeline.getAttribute('tabindex'), '0');
      assert.equal(await timeline.getAttribute('role'), 'region');
      assert.ok(await timeline.getAttribute('aria-label'));
      assert.equal(await page.locator('[data-kit-timeline]').getAttribute('role'), 'img');
      assert.ok(await page.locator('[data-kit-timeline]').getAttribute('aria-label'));
      assert.equal(await page.locator('[data-kit-timeline-launch="box-f"]').count(), 0);
      assert.match(await page.locator('[data-kit-timeline-dates]').innerText(), /Box F/);
      if (width <= 390) {
        assert.equal(await timeline.evaluate(element => element.scrollWidth > element.clientWidth), true, 'Only the timeline has horizontal scrolling on a phone');
        await timeline.evaluate(element => {element.scrollLeft = 100;});
        assert.ok(await timeline.evaluate(element => element.scrollLeft > 0));
      }
      assert.equal(await page.locator('[data-kit-order-group="kit:box-b"] [data-kit-order]').count(), 5);
      assert.equal(await page.locator('[data-kit-order-group] [data-kit-order]').count(), 8);
      assert.match(await page.locator('[data-kit-order-group="kit:box-b"]').innerText(), /a supplier/);
      assert.equal(await page.locator('style,script:not([src])').count(), 0, 'The Kits page has no inline style or script elements');
      await layout(page, width);
      if (process.env.PULSE_SCREENSHOT_DIR && width !== 360)
        await page.screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/kits-page-${width}.png`, fullPage: true});
      const boxB = page.locator('[data-kits-page-cards] [data-kit-open="box-b"]');
      const request = page.waitForRequest(request => new URL(request.url()).pathname === '/api/kits/box-b');
      await boxB.click();
      assert.equal(new URL((await request).url()).searchParams.get('suppliers'), '1');
      await page.locator('#sheet[open] [data-kit-sheet="box-b"]').waitFor();
      assert.equal(await page.locator('#sh-title').innerText(), 'Box B');
      assert.match(await page.locator('#sh-extra [data-kit-sheet]').innerText(), /a supplier/);
      assert.equal(await page.locator('#sheet .kit-move-label').innerText(), '○ Nothing for you right now');
      assert.equal(await page.locator('#sheet .kit-move-note').innerText(), 'Waiting 6 days');
      assert.match(await page.locator('#sheet .kit-checklist').innerText(), /Safety tests now/);
      assert.equal(await page.locator('#sheet [data-kit-order]:visible').count(), 3);
      await page.locator('[data-kit-orders-toggle]').click();
      assert.equal(await page.locator('#sheet [data-kit-order]:visible').count(), 5);
      await targets(page.locator('#sheet'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.keyboard.press('Escape'); await page.locator('#sheet').waitFor({state: 'hidden'});
      assert.equal(await boxB.evaluate(element => document.activeElement === element), true);
    }

    const facts = sampleKitFacts(now);
    const launches = ['2032-12-03', '2033-02-11', '2033-05-21', '2033-07-19', '2033-10-14', null];
    facts.kits.rows.forEach((kit, index) => {kit.launchTarget = launches[index]!;});
    facts.kits.rows[1]!.briefDue = '2032-12-14';
    facts.orders.rows.push({id: 'order-other', kit: 'Box G', supplier: 'a supplier', item: 'Spare packing sheets', qty: 1200,
      date: '2032-12-02', eta: '2033-01-08', status: 'Awaiting confirmation'});
    let view = kitsPageView(facts, 'sample', now);
    await page.route('**/kits', route => route.fulfill({contentType: 'text/html', body: kitsPage(view)}));
    await page.route(url => url.pathname.startsWith('/api/kits/'), route => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.slice('/api/kits/'.length));
      return route.fulfill({json: kitSheet(facts, id, now, {suppliers: true})});
    });
    await page.setViewportSize({width: 390, height: 960}); await page.goto('/kits');
    const timeline = page.locator('[data-kit-timeline]');
    assert.equal(await timeline.getAttribute('data-start'), '2032-12-01');
    assert.equal(await timeline.getAttribute('data-end'), '2033-10-31');
    assert.equal(await page.locator('[data-kit-timeline-launch]').count(), 5);
    assert.equal(await page.locator('[data-kit-timeline-brief="box-b"]').getAttribute('data-date'), '2032-12-14');
    assert.deepEqual(await page.locator('[data-kit-timeline-year]').allTextContents(), ['2032', '2033']);
    assert.equal(await page.locator('[data-kit-timeline-tick]').count(), 11);
    assert.equal(await page.locator('[data-kit-timeline-today]').getAttribute('data-kit-timeline-today'), '2032-12-07');
    for (let index = 0; index < 5; index++) {
      assert.equal(await page.locator(`[data-kit-timeline-launch="${ids[index]}"]`).getAttribute('data-date'), launches[index]);
    }
    assert.match(await page.locator('[data-kit-timeline-dates]').innerText(), /Box B[\s\S]*11 Feb 2033[\s\S]*14 Dec 2032/);
    const groups = page.locator('[data-kit-order-group]');
    assert.deepEqual(await groups.evaluateAll(rows => rows.map(row => row.getAttribute('data-kit-order-group'))),
      ['kit:box-a', 'kit:box-b', 'kit:box-c', 'other']);
    const other = page.locator('[data-kit-order-group="other"]');
    assert.match(await other.innerText(), /Other[\s\S]*Spare packing sheets[\s\S]*1,200[\s\S]*a supplier/);
    assert.equal(await other.locator('[data-kit-order]').count(), 1);
    await layout(page, 390);
    view = kitsPageView(facts, 'live', now); await page.reload();
    assert.match(await page.locator('[data-kits-page]').innerText(), /Not set up yet/);
    assert.equal(await page.locator('.kit-card,[data-kit-timeline],[data-kit-order]').count(), 0, 'Sample Kits and orders never appear beside live data');

    await page.unroute('**/kits');
    await page.goto('/'); await page.locator('html[data-dashboard-ready="true"]').waitFor();
    const headingLink = page.locator('#kits .kits-heading a[data-kits-all][href="/kits"]');
    assert.equal(await headingLink.innerText(), 'All kits ›');
    assert.equal(await page.locator('header.top a[href="/kits"]').evaluateAll(rows => rows.filter(row => !row.closest('#account-menu')).length), 0,
      'Kits adds no link or pill to the Home top bar');
    await headingLink.click(); await page.waitForURL('**/kits');
    await page.goto('/'); await page.locator('html[data-dashboard-ready="true"]').waitFor();
    await page.locator('#account-menu > summary').click();
    const menuLink = page.locator('#account-menu a[href="/kits"]'); assert.equal(await menuLink.count(), 1);
    const menuBox = (await menuLink.boundingBox())!;
    assert.ok(menuBox.height >= 44 && menuBox.width >= 44, 'The new Kits account-menu link has a 44px tap target');
    await menuLink.click(); await page.waitForURL('**/kits');

    const signedOut = await context.browser()!.newContext({baseURL: new URL(page.url()).origin});
    try {
      const response = await signedOut.request.get('/kits', {maxRedirects: 0});
      assert.equal(response.status(), 302); assert.equal(response.headers().location, '/login');
      assert.doesNotMatch(await response.text(), /Box A|data-kits-page/);
    } finally {await signedOut.close();}
  } finally {await page.close();}
}
