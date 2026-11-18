import assert from 'node:assert/strict';
import type { BrowserContext, Locator, Page } from 'playwright';
import type { DashboardSnapshot } from '../src/dashboard-types.js';
import { dashboardPage } from '../src/dashboard-view.js';
import { homeKits } from '../src/kits/presentation.js';
import { sampleKitFacts } from '../src/kits/sample.js';
import { checkKitsBudget } from './home-compact-browser-check.js';

const now = new Date('2032-04-07T12:00:00Z');

async function targets(scope: Locator): Promise<void> {
  for (const control of await scope.locator('button,a,summary').all()) {
    if (!await control.isVisible()) continue;
    const box = await control.boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44, 'Every Kits control has a 44px target');
  }
}

async function noOverflow(page: Page, width: number): Promise<void> {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
    `Kits has no sideways page scroll at ${width}px`);
}

/** Invented fixed-clock cards; the real signed-in detail route is exercised when a sheet opens. */
export async function checkKits(context: BrowserContext): Promise<void> {
  const response = await context.request.get('/api/dashboard'); assert.equal(response.status(), 200);
  const fixture = await response.json() as DashboardSnapshot;
  fixture.kits = homeKits(sampleKitFacts(now), 'sample', now);
  const page = await context.newPage();
  const replay = async () => {
    fixture.generatedAt = new Date(Date.parse(fixture.generatedAt) + 1000).toISOString();
    await page.evaluate(next => (window as unknown as {pulseMarketStream: EventSource}).pulseMarketStream
      .dispatchEvent(new MessageEvent('dashboard', {data: JSON.stringify(next)})), fixture);
    await page.waitForFunction(stamp => document.documentElement.dataset.updatedAt === stamp, fixture.generatedAt);
  };
  try {
    await page.route('**/api/dashboard', route => route.fulfill({json: fixture}));
    await page.route('**/api/events', route => route.fulfill({contentType: 'text/event-stream', body: 'retry: 60000\n\n'}));
    await page.route('**/', route => route.fulfill({contentType: 'text/html', body: dashboardPage(fixture)}));
    for (const width of [360, 390, 768, 1280]) {
      await page.setViewportSize({width, height: 960}); await page.goto('/');
      await page.locator('html[data-dashboard-ready="true"]').waitFor();
      await page.evaluate(async () => { await document.fonts.ready; });
      const kits = page.locator('#kits'), cards = kits.locator('.kit-card'), fold = kits.locator('[data-kits-fold]');
      assert.equal(await cards.count(), 3);
      assert.match(await kits.innerText(), /Sample data/i);
      assert.equal(await fold.getAttribute('aria-expanded'), 'false');
      assert.equal(await fold.innerText(), '+3 planned · show');
      assert.equal(await kits.locator('.kit-folded-row:visible').count(), 0);
      // Server markup and hydration share the exact same renderer, including the summary and track labels.
      const expected = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').querySelector('#kits')!.innerHTML,
        dashboardPage(fixture));
      assert.equal(await kits.innerHTML(), expected);
      if (width === 390 || width === 1280) {
        await checkKitsBudget(page, width);
        if (process.env.PULSE_SCREENSHOT_DIR) await kits.screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/kits-${width}.png`});
      }
      await targets(kits); await noOverflow(page, width);
      const boxes = await cards.evaluateAll(elements => elements.map(element => {
        const b = element.getBoundingClientRect(); return {x: b.x, y: b.y, width: b.width, bottom: b.bottom};
      }));
      if (width === 390) for (let i = 1; i < boxes.length; i++) {
        assert.equal(boxes[i]!.x, boxes[0]!.x);
        assert.ok(boxes[i]!.y >= boxes[i - 1]!.bottom, 'Phone cards form one column');
      }
      if (width === 1280) for (const box of boxes) {
        assert.equal(box.y, boxes[0]!.y, 'Desktop cards share one row');
        assert.ok(Math.abs(box.width - boxes[0]!.width) < 1, 'Desktop card columns are equal');
      }
      const boxB = cards.filter({hasText: 'Box B'});
      assert.equal(await boxB.locator('[data-kit-track]').getAttribute('role'), 'img');
      assert.equal(await boxB.locator('[data-kit-track]').getAttribute('aria-label'),
        'Step 3 of 7, Compliance. Done: Theme, Design. To come: Manufacture, Inbound, Launch, Review.');
      assert.match(await boxB.innerText(), /△ 6d waiting/);
      await fold.click();
      assert.equal(await fold.getAttribute('aria-expanded'), 'true');
      assert.equal(await fold.innerText(), 'Hide planned');
      assert.equal(await kits.locator('.kit-folded-row:visible').count(), 3);
      await targets(kits); await noOverflow(page, width);
      if (width === 1280) {
        const folded = await kits.locator('.kit-folded-row').evaluateAll(rows => rows.map(row => ({x: row.getBoundingClientRect().x, y: row.getBoundingClientRect().y})));
        assert.equal(folded[0]!.y, folded[1]!.y, 'Desktop folded rows use two columns');
        assert.notEqual(folded[0]!.x, folded[1]!.x);
      }
      await fold.click();
      await page.locator('#hero [data-k="orders"]').click();
      await page.locator('#sheet[open]').waitFor(); await page.locator('#sh-x').click();
      await boxB.click();
      await page.locator('#sheet[open] [data-kit-sheet]').waitFor();
      assert.equal(await page.locator('#sh-title').innerText(), 'Box B');
      assert.equal(await page.locator('[data-kit-order-count]').innerText(), 'On order · 3 of 5');
      assert.equal(await page.locator('[data-kit-order]:visible').count(), 3);
      assert.equal(await page.locator('[data-kit-orders-toggle]').innerText(), '+2 more');
      assert.doesNotMatch(await page.locator('#sh-extra [data-kit-sheet]').innerText(), /a supplier/);
      await page.locator('[data-kit-orders-toggle]').click();
      assert.equal(await page.locator('[data-kit-order]:visible').count(), 5);
      assert.equal(await page.locator('[data-kit-order-count]').innerText(), 'On order · 5 of 5');
      if (width === 360 || width === 390) {
        const steps = await page.locator('.kit-checklist li').evaluateAll(rows => rows.map(row => ({x: row.getBoundingClientRect().x, y: row.getBoundingClientRect().y})));
        assert.equal(steps[0]!.y, steps[1]!.y, 'The phone checklist uses two columns');
        assert.notEqual(steps[0]!.x, steps[1]!.x);
      }
      await targets(page.locator('#sheet')); await noOverflow(page, width);
      await replay();
      assert.equal(await page.locator('#sh-title').innerText(), 'Box B', 'A snapshot does not replace an open Kit with an old ordinary detail');
      assert.equal(await page.locator('#sheet[open] [data-kit-sheet]').count(), 1);
      await page.locator('#sh-x').click();
      await page.emulateMedia({reducedMotion: 'reduce'});
      assert.equal(await cards.first().locator('.kit-track-current').evaluate(el => getComputedStyle(el).animationName), 'none');
      await page.emulateMedia({reducedMotion: 'no-preference'});
    }
    // A response received after closing the sheet must not replace a newly opened ordinary detail.
    const boxB = page.locator('#kits .kit-card').filter({hasText: 'Box B'}), id = await boxB.getAttribute('data-kit-open');
    assert.ok(id);
    const detail = await context.request.get(`/api/kits/${encodeURIComponent(id)}`); assert.equal(detail.status(), 200);
    const detailBody: unknown = await detail.json();
    let release!: () => void, seen!: () => void;
    const delayed = new Promise<void>(resolve => {release = resolve;}), requested = new Promise<void>(resolve => {seen = resolve;});
    await page.route(`**/api/kits/${encodeURIComponent(id)}`, async route => {seen(); await delayed; await route.fulfill({json: detailBody});});
    await boxB.click(); await requested;
    await page.locator('#sh-x').click();
    await page.locator('#hero [data-k="orders"]').click();
    const ordinaryTitle = await page.locator('#sh-title').innerText();
    const finished = page.waitForResponse(response => response.url().endsWith(`/api/kits/${encodeURIComponent(id)}`));
    release(); await finished;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await page.locator('#sh-title').innerText(), ordinaryTitle);
    assert.equal(await page.locator('#sheet [data-kit-sheet]').count(), 0, 'A closed Kit request cannot overwrite another sheet');
    await page.locator('#sh-x').click();
    await boxB.click(); await page.locator('#sheet[open] [data-kit-sheet]').waitFor();
    const previous = fixture.kits;
    fixture.kits = homeKits(sampleKitFacts(now), 'live', now);
    await replay();
    assert.equal(await page.locator('#sheet[open]').count(), 0, 'A live snapshot suppressing sample kits closes their open sheet');
    assert.equal(await page.locator('#kits .kit-card').count(), 0);
    assert.match(await page.locator('#kits').innerText(), /Not set up yet/);
    fixture.kits = previous; await replay();
    assert.equal(await page.locator('#kits .kit-card').count(), 3);
  } finally {await page.close();}
}
