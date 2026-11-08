import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';
import type { SettingsSnapshot } from '../src/settings.js';
import { settingsPage } from '../src/settings-view.js';

/** Invented activity choices use a separate form, outside the dense Home fixture. */
export async function checkActorSettings(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  let current = await (await context.request.get('/api/settings')).json() as SettingsSnapshot;
  current = { ...current, values: { ...current.values, ourActors: [] } };
  let saves = 0;
  await page.route('**/settings', route => route.fulfill({
    contentType: 'text/html', body: settingsPage(current, [], 'sample', new Date('2026-10-26T12:00:00Z'), [], undefined, undefined, {
      hasRead: true, line: 'Sample data · invented recent actors',
      actors: [{ id: '990001', name: 'Invented operator' }, { id: '990002', name: 'Invented automation' }],
    }),
  }));
  await page.route('**/api/settings', route => {
    assert.equal(route.request().method(), 'POST');
    const request = route.request().postDataJSON() as SettingsSnapshot;
    saves++;
    current = { version: current.version + 1, values: request.values };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(current) });
  });
  try {
    await page.goto('/settings');
    await page.locator('summary').filter({ hasText: 'Ad spend' }).click();
    const list = page.locator('[data-settings-list="ourActors"]');
    const pick = list.locator('[data-pick-actor="990001"]');
    await pick.click();
    const input = list.locator('[data-list-rows] input');
    assert.equal(await input.inputValue(), '990001');
    assert.equal(saves, 0, 'choosing a recent actor never saves automatically');
    await pick.click();
    assert.equal(await input.count(), 1, 'choosing the same actor does not duplicate their ID');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.ok((await pick.boundingBox())!.height >= 44);
    }
    await input.fill('990099');
    assert.match(await list.locator('[data-row-hint]').innerText(), /Not seen in the last 7 UK days/);
    await input.fill('990002');
    assert.equal(await list.locator('[data-row-hint]').isVisible(), false);
    await input.fill('990099');
    assert.equal(saves, 0, 'manual actor edits also wait for Save settings');
    await page.locator('#settings-save').click();
    await page.waitForFunction(() => document.querySelector('#settings-message')?.textContent === 'Settings saved.');
    assert.equal(saves, 1);
    assert.deepEqual(current.values.ourActors, [{ actorId: '990099' }], 'a recent-activity warning does not reject a valid actor ID');
    await page.reload();
    await page.locator('summary').filter({ hasText: 'Ad spend' }).click();
    assert.equal(await input.inputValue(), '990099');
    assert.equal(await list.locator('[data-row-hint]').isVisible(), true);
  } finally { await page.close(); }
}
