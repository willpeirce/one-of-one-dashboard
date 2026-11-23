import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';
import { addDays } from '../src/hero-range.js';
import { scorecardMonth, scorecardWeek } from '../src/scorecard/metrics.js';

export async function checkScorecard(context: BrowserContext): Promise<void> {
  const now = new Date(), monthWindow = scorecardMonth('', now), week = scorecardWeek('', now);
  for (const width of [390, 1280]) {
    const page = await context.newPage();
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/scorecard');
      await page.getByRole('heading', { name: 'Scorecard', exact: true }).waitFor();
      assert.equal(await page.locator('#score-month').inputValue(), monthWindow.month, 'default is the last full real UK calendar month');
      assert.match(await page.locator('[data-score-mode="sample"]').innerText(), /Sample data · invented/);
      assert.equal(await page.locator('[data-growth-card]').count(), 4);
      assert.equal(await page.locator('[data-score-mover="up"]').count(), 3);
      assert.equal(await page.locator('[data-score-mover="down"]').count(), 3);
      assert.ok(await page.locator('[data-score-spike]').count() > 0);
      assert.match(await page.locator('[data-score-cpo]').innerText(), /Not enough data yet/);
      const header = (await page.locator('header.top').boundingBox())!, main = (await page.locator('main').boundingBox())!;
      assert.ok(main.y >= header.y + header.height, 'scorecard clears the shared header');
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(await overflow(), false, `${width}px scorecard has no horizontal overflow`);
      for (const control of await page.locator('a,button,input,select,summary').all()) if (await control.isVisible()) {
        const box = (await control.boundingBox())!;
        assert.ok(box.height >= 44 && box.width >= 44, `${width}px ${await control.evaluate(element => element.outerHTML.slice(0, 150))} is below 44px`);
      }
      await page.locator('[data-growth-card] > summary').first().click();
      assert.match(await page.locator('[data-growth-card][open] .score-detail').innerText(), /Shopify net sales/);
      assert.equal(await overflow(), false);
      await page.locator('[data-growth-card] > summary').first().click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      assert.ok((await page.getByRole('heading', { name: 'Scorecard', exact: true }).boundingBox())!.y >= (await page.locator('header.top').boundingBox())!.height, 'the intro remains below the shared header at scroll zero');
      if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/scorecard-${width}.png`, fullPage: true });
      await page.locator('#score-market').selectOption('uk');
      await page.getByRole('button', { name: 'Show month' }).click();
      await page.waitForURL('**/scorecard?month=*&market=uk');
      assert.equal(await page.locator('#score-market').inputValue(), 'uk');
      assert.match(await page.locator('.chapter-eyebrow').first().innerText(), /UK/);
      await page.locator('#score-month').fill(monthWindow.previousFrom.slice(0, 7));
      await page.getByRole('button', { name: 'Show month' }).click();
      await page.waitForURL(`**/scorecard?month=${monthWindow.previousFrom.slice(0, 7)}&market=uk`);
      assert.equal(await page.locator('#score-month').inputValue(), monthWindow.previousFrom.slice(0, 7));
      assert.equal(await overflow(), false);
      assert.equal(await page.locator('#score-week').inputValue(), week.to);
      const earlier = addDays(week.to, -14);
      await page.locator('#score-week').fill(earlier);
      await page.getByRole('button', { name: 'Show week', exact: true }).click();
      await page.waitForURL(url => url.searchParams.get('week') === earlier);
      assert.equal(await page.locator('#score-market').inputValue(), 'uk');
      assert.equal(await page.locator('#score-week').inputValue(), earlier);
      assert.match(await page.locator('.score-week').innerText(), /UK[\s\S]*Net sales[\s\S]*US[\s\S]*Net sales/);
      assert.equal(await overflow(), false);
    } finally { await page.close(); }
  }
}
