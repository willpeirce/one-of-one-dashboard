import assert from 'node:assert/strict';
import type {BrowserContext} from 'playwright';
import {validateSettings, type SettingsSnapshot} from '../src/settings.js';
import {settingsPage} from '../src/settings-view.js';

/** A separate validated form fixture leaves the shared browser Settings untouched. */
export async function checkIssueSettings(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  const original = await (await context.request.get('/api/settings')).json() as SettingsSnapshot;
  let current: SettingsSnapshot = {...original, values: {...original.values, gorgiasIssueTags: []}};
  let hideEditor = false, saves = 0;
  await page.route('**/settings', route => {
    const rendered = settingsPage(current, [], 'sample', new Date('2034-07-18T12:00:00Z'));
    const body = hideEditor ? rendered.replace(/<section[^>]*data-settings-list="gorgiasIssueTags"[\s\S]*?<\/section>/, '') : rendered;
    return route.fulfill({contentType: 'text/html', body});
  });
  await page.route('**/api/settings', route => {
    assert.equal(route.request().method(), 'POST');
    const request = route.request().postDataJSON() as SettingsSnapshot;
    assert.equal(request.version, current.version);
    current = {version: current.version + 1, values: validateSettings(request.values)}; saves++;
    return route.fulfill({contentType: 'application/json', body: JSON.stringify(current)});
  });
  const save = async () => {
    await page.locator('#settings-save').click();
    await page.waitForFunction(() => document.querySelector('#settings-message')?.textContent === 'Settings saved.');
  };
  try {
    await page.goto('/settings');
    await page.locator('summary').filter({hasText: 'Customer service'}).click();
    const list = page.locator('[data-settings-list="gorgiasIssueTags"]');
    assert.equal(await list.locator('[data-list-rows] .setting-row').count(), 0);
    await list.locator('[data-add-row]').click();
    await list.locator('[name="gorgiasIssueTags.0.tag"]').fill(' invented_slab_mark ');
    await list.locator('[name="gorgiasIssueTags.0.reason"]').selectOption('scratched slab');
    assert.equal(saves, 0, 'Editing a classification never saves automatically');
    for (const width of [390, 1280]) {
      await page.setViewportSize({width, height: 900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      for (const control of await list.locator('input,select,button').all()) {
        if (await control.isVisible()) assert.ok((await control.boundingBox())!.height >= 44);
      }
    }
    await save();
    assert.deepEqual(current.values.gorgiasIssueTags, [{tag: 'invented_slab_mark', reason: 'scratched slab'}]);
    await page.reload();
    await page.locator('summary').filter({hasText: 'Customer service'}).click();
    assert.equal(await list.locator('[name="gorgiasIssueTags.0.tag"]').inputValue(), 'invented_slab_mark');
    assert.equal(await list.locator('[name="gorgiasIssueTags.0.reason"]').inputValue(), 'scratched slab');
    hideEditor = true; await page.reload();
    assert.equal(await list.count(), 0, 'The rollback fixture omits the visible Issues editor before browser startup');
    await page.locator('[name="goalOrdersPerDay"]').fill(String(original.values.goalOrdersPerDay + 1));
    await save();
    assert.deepEqual(current.values.gorgiasIssueTags, [{tag: 'invented_slab_mark', reason: 'scratched slab'}],
      'An unrelated save after feature rollback preserves the stored map');
    hideEditor = false; await page.reload();
    await page.locator('summary').filter({hasText: 'Customer service'}).click();
    await list.locator('[data-remove-row]').click(); await save();
    assert.deepEqual(current.values.gorgiasIssueTags, []);
    assert.equal(saves, 3);
  } finally {current = original; await page.close();}
}
