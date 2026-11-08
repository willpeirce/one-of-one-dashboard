import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';
import type { SettingsSnapshot } from '../src/settings.js';
import { settingsPage } from '../src/settings-view.js';

/** Separate invented Settings rows keep the pinned dense Home fixture unchanged. */
export async function checkInboundSettings(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  let current = await (await context.request.get('/api/settings')).json() as SettingsSnapshot;
  current = {...current, values: {...current.values, inboundStock: []}};
  let saves = 0;
  await page.route('**/settings', route => route.fulfill({ contentType: 'text/html',
    body: settingsPage(current, [], 'sample', new Date('2026-11-05T12:00:00Z'), [], undefined, undefined, undefined, ['Invented Kit']),
  }));
  await page.route('**/api/settings', route => {
    assert.equal(route.request().method(), 'POST');
    const request = route.request().postDataJSON() as SettingsSnapshot;
    saves++;
    current = {version: current.version + 1, values: request.values};
    return route.fulfill({contentType: 'application/json', body: JSON.stringify(current)});
  });
  try {
    await page.goto('/settings');
    await page.locator('summary').filter({hasText: 'Stock planning'}).click();
    const list = page.locator('[data-settings-list="inboundStock"]');
    assert.equal(await list.locator('[data-list-rows] .setting-row').count(), 0);
    await list.locator('[data-add-row]').click();
    const product = list.locator('[name="inboundStock.0.product"]');
    await product.fill('Invented Future');
    const warning = list.locator('[data-list-rows] [data-row-hint]');
    assert.match(await warning.innerText(), /Product not found in Stock and cover/);
    await product.fill('INVENTED KIT');
    assert.equal(await warning.isVisible(), false);
    await list.locator('[name="inboundStock.0.market"]').selectOption('us');
    await list.locator('[name="inboundStock.0.quantity"]').fill('23');
    await list.locator('[name="inboundStock.0.expectedDate"]').fill('2026-11-15');
    for (const width of [390, 1280]) {
      await page.setViewportSize({width, height: 900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      for (const control of await list.locator('input,select,button').all()) {
        if (await control.isVisible()) assert.ok((await control.boundingBox())!.height >= 44);
      }
    }
    await product.fill('Invented Future');
    assert.equal(saves, 0, 'stock plans wait for Save settings');
    await page.locator('#settings-save').click();
    await page.waitForFunction(() => document.querySelector('#settings-message')?.textContent === 'Settings saved.');
    assert.equal(saves, 1);
    assert.deepEqual(current.values.inboundStock, [{product: 'Invented Future', market: 'us', quantity: 23, expectedDate: '2026-11-15'}]);
    assert.equal(await warning.isVisible(), true, 'an unmatched product remains visibly flagged after saving');
    await page.reload();
    await page.locator('summary').filter({hasText: 'Stock planning'}).click();
    assert.equal(await product.inputValue(), 'Invented Future');
    assert.equal(await warning.isVisible(), true);
    await list.locator('[data-remove-row]').click();
    assert.equal(await list.locator('[data-list-rows] .setting-row').count(), 0);
  } finally { await page.close(); }
}
