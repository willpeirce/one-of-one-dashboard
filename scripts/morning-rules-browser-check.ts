import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';
import type { SettingsSnapshot } from '../src/settings.js';

/** Save and restore invented judgement floors through the actual Settings form. */
export async function checkMorningRuleSettings(context: BrowserContext): Promise<void> {
  const read = async (): Promise<SettingsSnapshot> => {
    const response = await context.request.get('/api/settings');
    assert.equal(response.status(), 200);
    return await response.json() as SettingsSnapshot;
  };
  const before = await read();
  const page = await context.newPage();
  try {
    for (const width of [390, 1280]) {
      await page.setViewportSize({width, height: width === 390 ? 844 : 960});
      await page.goto('/settings');
      const field = page.locator('input[name="adRules.flatJudgeGbp"]');
      await field.locator('xpath=ancestor::details').evaluate(element => { (element as HTMLDetailsElement).open = true; });
      assert.equal(await field.inputValue(), String((await read()).values.adRules.flatJudgeGbp));
      assert.equal(await field.locator('xpath=ancestor::div[contains(@class,"settings-grid")]')
        .locator('input[name="adRules.killFloorGbp"]').count(), 1, 'Flat judgement stays beside the existing ad rule floors');
      const box = await field.boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, 'The judgement floor input has a 44px tap area');
      const inventedFloor = width === 390 ? 64.5 : 82.5;
      await field.fill(String(inventedFloor));
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/settings' && response.request().method() === 'POST');
      await page.locator('#settings-save').click();
      assert.equal((await saved).status(), 200);
      await page.waitForFunction(() => document.querySelector('#settings-message')?.textContent === 'Settings saved.');
      assert.equal((await read()).values.adRules.flatJudgeGbp, inventedFloor);
      await page.reload();
      assert.equal(await page.locator('input[name="adRules.flatJudgeGbp"]').inputValue(), String(inventedFloor));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
  } finally {
    const current = await read();
    const origin = new URL(page.url()).origin;
    const restored = await context.request.post('/api/settings', {headers: {origin}, data: {...current,
      values: {...current.values, adRules: {...current.values.adRules, flatJudgeGbp: before.values.adRules.flatJudgeGbp}}}});
    assert.equal(restored.status(), 200);
    assert.equal((await read()).values.adRules.flatJudgeGbp, before.values.adRules.flatJudgeGbp);
    await page.close();
  }
}
