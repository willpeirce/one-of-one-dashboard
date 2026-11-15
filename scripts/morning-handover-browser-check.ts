import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';
import { defaultSettings } from '../src/settings.js';
import { morningDeck, type MorningInput } from '../src/morning/model.js';
import { morningPage } from '../src/morning/view.js';
import { tickerState } from '../src/ticker/model.js';
import { tapArea } from './tap-area.js';

export async function checkMorningHandover(context: BrowserContext): Promise<void> {
  const now = new Date('2032-04-09T09:00:00.000Z');
  const input: MorningInput = {mode: 'live', checks: [], creativeCards: [], settings: defaultSettings(), activity: [], metaActions: [],
    ticker: tickerState([], [], now, 'live'), sourceReadOk: {},
    brief: {text: 'Morning check needs its key', status: 'key', mode: 'live'},
    needs: [{id: 'invented-waiting', source: 'github-hq', state: 'warn', title: 'Two invented waiting items', why: 'An invented supplier has waited eight UK days.', link: '/handover'},
      {id: 'invented-issues', source: 'pulse', state: 'warn', title: 'Invented issue cases', why: 'An invented issue reason doubled this month.', link: '/handover'},
      {id: 'invented-home', source: 'pulse', state: 'warn', title: 'Invented Home watch', why: 'An invented Home reading needs a look.', link: '/sources'}]};
  let snapshot = morningDeck(input, [], now).snapshot;
  const page = await context.newPage();
  try {
    await page.route('**/morning', route => route.fulfill({contentType: 'text/html', body: morningPage(snapshot)}));
    await page.route('**/api/morning', route => route.fulfill({json: snapshot}));
    for (const width of [360, 390, 1280]) {
      snapshot = morningDeck(input, [], now).snapshot;
      await page.setViewportSize({width, height: 900}); await page.goto('/morning');
      await page.locator('#mn-root[data-mn-ready="true"]').waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.match(await page.locator('#mn-watch').innerText(), /Watch · 3 to check/);
      assert.match(await page.locator('#mn-all-clear').innerText(), /1 Watch card is on Home.*2 Watch cards are on Handover/s);
      const lines = (await page.locator('.mn-summary-lines').boundingBox())!, good = (await page.locator('#mn-good').boundingBox())!, watch = (await page.locator('#mn-watch').boundingBox())!;
      assert.ok(lines.height <= 100, `${width}px Morning lines retain the 100px budget`);
      assert.ok(Math.abs(good.y - watch.y) < .5 && good.x + good.width <= watch.x, 'Good and Watch share their existing row');
      const tap = await tapArea(page.locator('#mn-watch')); assert.ok(tap.width >= 44 && tap.height >= 44 && tap.edges);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.locator('#mn-watch').click(); await page.locator('#mn-dialog').waitFor({state: 'visible'});
      assert.equal(await page.locator('#mn-dialog').evaluate(element => element.matches(':modal')), true);
      assert.equal(await page.locator('#mn-sheet-title').innerText(), 'Watch');
      assert.equal(await page.locator('[data-mn-handover-watch]').count(), 2);
      assert.match(await page.locator('#mn-sheet-body').innerText(), /invented supplier has waited eight UK days/);
      assert.equal(await page.locator('#mn-sheet-body a[href="/?from=morning"]').count(), 1);
      assert.equal(await page.locator('#mn-sheet-body a[href="/handover"]').count(), 2);
      for (const control of await page.locator('#mn-dialog button,#mn-dialog a').all()) {
        const area = await tapArea(control); assert.ok(area.width >= 44 && area.height >= 44 && area.edges);
      }
      snapshot = {...snapshot, watchOnHandover: snapshot.watchOnHandover!.slice(0, 1)};
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(() => document.querySelectorAll('[data-mn-handover-watch]').length === 1);
      await page.locator('#mn-close').click();
      await page.waitForFunction(() => document.activeElement?.id === 'mn-watch');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'mn-watch', 'Refresh replaces the Watch opener without losing keyboard focus');
      assert.match(await page.locator('#mn-watch').innerText(), /Watch · 2 to check/);
      snapshot = {...snapshot, watchOnHandover: []};
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.locator('#mn-more-home').waitFor();
      assert.equal(await page.locator('#mn-watch').count(), 0, 'Without Handover watches the existing Home link returns');
      assert.match(await page.locator('#mn-more-home').innerText(), /Watch · 1 on Home/);
    }
  } finally {await page.close();}
}
