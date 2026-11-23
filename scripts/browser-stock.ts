import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';

export async function checkStockPlanner(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto('/');
    const menu = page.locator('#account-menu');
    await menu.locator('summary').click();
    await menu.getByRole('link', { name: 'Stock', exact: true }).click();
    await page.waitForURL('**/stock');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.match(await page.locator('[data-stock-mode]').innerText(), /Sample data/);
      for (const market of ['uk', 'us']) {
        const warehouse = page.locator(`[data-planner-market="${market}"]`);
        assert.equal(await warehouse.locator('[data-planner-product]').count(), 4);
        assert.match(await warehouse.innerText(), /Short history/);
        assert.match(await warehouse.innerText(), /No history/);
        assert.match(await warehouse.innerText(), /Run-out, not restocked/i);
        assert.match(await warehouse.innerText(), /Set a supplier/);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.ok(await page.getByText('Order now', { exact: true }).count());
      assert.match(await page.locator('.planner-cover').first().innerText(), /covers about [\d,]+ of [\d,]+ kits left/i);
      if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/stock-${width}.png`, fullPage: true });
    }
  } finally { await page.close(); }
}
