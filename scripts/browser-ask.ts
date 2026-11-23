import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';

export async function checkAsk(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto('/');
    const menu = page.locator('#account-menu');
    await menu.locator('summary').click();
    await menu.getByRole('link', { name: 'Ask', exact: true }).click();
    await page.waitForURL('**/ask');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.match(await page.locator('.sample-banner').innerText(), /Sample data/);
      assert.equal(await page.locator('[data-ask-example]').count(), 4);
      const example = page.locator('[data-ask-example]').first();
      await example.click();
      assert.equal(await page.locator('#ask-question').inputValue(), await example.textContent());
      await page.locator('#ask-form button[type="submit"]').click();
      await page.locator('#ask-result').waitFor();
      assert.match(await page.locator('#ask-answer').innerText(), /24 kit units/);
      assert.match(await page.locator('#ask-sources').innerText(), /^Sources · Shopify sample · as of /);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/ask-${width}.png` });
    }
    const harmfulMarkup = '<script>window.askInjected = true</script>\nExample second line';
    await page.route('**/api/ask', route => route.fulfill({ json: {
      answer: harmfulMarkup, sources: [{ name: 'Invented source', asOf: null }], outcome: 'answered',
    } }));
    await page.locator('#ask-form button[type="submit"]').click();
    await page.locator('#ask-result').waitFor();
    assert.equal(await page.locator('#ask-answer').textContent(), harmfulMarkup);
    assert.equal(await page.locator('#ask-answer script').count(), 0);
    assert.match(await page.locator('#ask-sources').textContent() ?? '', /Sources · Invented source/);
  } finally { await page.close(); }
}
