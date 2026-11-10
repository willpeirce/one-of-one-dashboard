import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { BrowserContext, Page } from 'playwright';
import type { DashboardSnapshot } from '../src/dashboard-types.js';
import { dashboardPage } from '../src/dashboard-view.js';
import type { MorningHomeOmissions } from '../src/morning/model-types.js';
import { installMarketUpdateHook } from './browser-market.js';
import { compactHomeFixture } from './home-compact-browser-check.js';

/** The complete invented source data stays available outside the Decisions deck. */
async function unchangedPanels(page: Page): Promise<Record<string, string>> {
  const panels: Record<string, string> = {};
  for (const selector of ['#hero .hero-grid', '#adset-summary', '#creative-panel', '#stock', '#checks',
    '#reviews', '#tests', '#dials', '#shopify-panels', '#source-health-count', '#settings-count']) {
    assert.equal(await page.locator(selector).count(), 1, `${selector} is included in the unchanged-panel comparison`);
    const html = await page.locator(selector).evaluate(element => {
      const copy = element.cloneNode(true) as HTMLElement;
      // A market tap canonicalises CSS style attributes without changing a figure.
      for (const styled of Array.from(copy.querySelectorAll<HTMLElement>('[style]'))) styled.setAttribute('style', styled.style.cssText);
      return copy.innerHTML;
    });
    panels[selector] = createHash('sha256').update(html).digest('hex');
  }
  return panels;
}

export async function checkMorningHome(signedIn: BrowserContext): Promise<void> {
  const response = await signedIn.request.get('/api/dashboard'); assert.equal(response.status(), 200);
  const base = await response.json() as DashboardSnapshot;
  const origin = new URL(response.url()).origin;
  const context = await signedIn.browser()!.newContext({baseURL: origin, storageState: await signedIn.storageState()});
  const errors: string[] = [], forbidden: string[] = [];
  await installMarketUpdateHook(context);
  await context.addInitScript("localStorage.removeItem('pulse-creative-evidence-window');");
  await context.route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin || request.method() !== 'GET') {
      forbidden.push(`${request.method()} ${new URL(request.url()).pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  let fixture = compactHomeFixture(base);
  delete fixture.morningOmissions;
  await page.route('**/api/dashboard', route => route.fulfill({json: fixture}));
  await page.route('**/api/events', route => route.fulfill({contentType: 'text/event-stream',
    body: `retry: 60000\nevent: dashboard\ndata: ${JSON.stringify(fixture)}\n\n`}));
  await page.route('**/api/meta/adsets', route => route.fulfill({json: fixture.adSets}));
  await page.route('**/api/creatives?*', route => route.fulfill({json: fixture.creatives}));
  await page.route('**/', route => route.fulfill({contentType: 'text/html', body: dashboardPage(fixture)}));
  const replay = async () => {
    fixture.generatedAt = new Date(Date.parse(fixture.generatedAt) + 1000).toISOString();
    await page.evaluate(next => (window as unknown as {pulseMarketStream: EventSource}).pulseMarketStream
      .dispatchEvent(new MessageEvent('dashboard', {data: JSON.stringify(next)})), fixture);
    await page.waitForFunction(stamp => document.documentElement.dataset.updatedAt === stamp, fixture.generatedAt);
  };
  try {
    for (const viewport of [{width: 390, height: 844}, {width: 1280, height: 960}]) {
      fixture = compactHomeFixture(base); delete fixture.morningOmissions;
      await page.setViewportSize(viewport); await page.goto('/');
      await page.locator('html[data-dashboard-ready="true"]').waitFor();
      await page.evaluate(async () => { await document.fonts.ready; });
      const originalDeck = await page.locator('#deck').innerHTML();
      const panels = await unchangedPanels(page);
      const adSet = fixture.adSets!.rows.find(row => row.verdict?.verdict === 'Kill');
      assert.ok(adSet?.verdict);
      const adSelector = `#deck [data-adset-open="${adSet.set.id}"]`;
      const creativeSelector = '#deck .dcard[data-card-id="invented-make-next"]';
      const watch = page.locator('#watch .wrow').filter({hasText: 'Invented watch 0'});
      const alarm = page.locator('#act .dcard[data-state="alarm"]');
      assert.equal(await page.locator('#act .dcard').count(), 5);
      assert.equal(await page.locator('#watch .wrow').count(), 10);
      assert.equal(await page.locator(adSelector).count(), 1);
      assert.equal(await page.locator(creativeSelector).count(), 1);
      assert.equal(await watch.count(), 1);
      const alarmMarkup = await alarm.innerHTML();
      const omissions: MorningHomeOmissions = {
        // Even a stale or malformed Alarm omission must never conceal the Alarm.
        needs: ['invented-watch-0', 'invented-alarm'],
        adSets: [{id: adSet.set.id, verdict: adSet.verdict.verdict}],
        creatives: ['invented-make-next'],
      };
      fixture.morningOmissions = omissions;
      await replay();
      const assertOmitted = async () => {
        assert.equal(await page.locator(adSelector).count(), 0, 'The held verdict leaves only the deck');
        assert.equal(await page.locator(creativeSelector).count(), 0, 'The hidden creative leaves only the deck');
        assert.equal(await watch.count(), 0, 'The parked Watch need leaves only the deck');
        assert.equal(await page.locator('#act .dcard').count(), 3);
        assert.equal(await page.locator('#watch .wrow').count(), 9);
        assert.equal(await alarm.count(), 1, 'Morning can never omit an Alarm');
        assert.equal(await alarm.innerHTML(), alarmMarkup);
        assert.deepEqual(await unchangedPanels(page), panels, 'All source panels, figures and counts retain their complete data');
        assert.equal(await page.locator('#creative-panel .creative-top .creative-picture').count(), 3);
        assert.equal(await page.locator('#source-health-count').textContent(), '1');
      };
      await assertOmitted();

      // Market updates and a separate creative read must preserve the current omission slice.
      await page.locator('#market [data-market="uk"]').click();
      await page.locator('#market [data-market="all"]').click();
      await Promise.all([
        page.waitForResponse(result => new URL(result.url()).pathname === '/api/creatives'),
        page.locator('#creative-panel [data-creative-window="3d"]').click(),
      ]);
      await page.waitForFunction(() => document.querySelector('#creative-panel #creative-status')?.textContent === '');
      await assertOmitted();

      // A new verdict on the same set is a different decision and must remain available.
      adSet.verdict.verdict = 'Step';
      await replay();
      assert.equal(await page.locator(adSelector).count(), 1, 'Omissions match the verdict as well as the ad-set ID');
      adSet.verdict.verdict = 'Kill';
      await replay(); await assertOmitted();

      // Reload also receives the same omission in SSR and the initial browser snapshot.
      await page.reload(); await page.locator('html[data-dashboard-ready="true"]').waitFor();
      await assertOmitted();

      // A full snapshot without this optional property clears the previous browser slice.
      delete fixture.morningOmissions;
      await replay();
      assert.equal(await page.locator('#deck').innerHTML(), originalDeck, 'An omitted property restores every original deck card');
      assert.deepEqual(await unchangedPanels(page), panels);
      const top = await page.locator('.hero-grid').evaluate(element => element.getBoundingClientRect().top + scrollY);
      assert.equal(top, viewport.width === 390 ? 499.0625 : 405.625, 'Home fold stays at its pinned baseline');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(forbidden, [], 'The omission check makes no writes or external requests');
    console.log('Morning Home checks passed: deck-only omissions, Alarm preservation, complete source panels and counts, partial refreshes, exact verdict matching and full SSE restoration at both widths.');
  } finally { await context.close(); }
}
