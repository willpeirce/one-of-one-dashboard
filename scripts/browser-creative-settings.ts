import assert from 'node:assert/strict';
import type { BrowserContext, Page } from 'playwright';
import type { SettingsSnapshot } from '../src/settings.js';

/** Round-trip every creative preference through the real browser form and local API. */
export async function checkCreativeSettings(page: Page, context: BrowserContext): Promise<void> {
  const before = await (await context.request.get('/api/settings')).json() as SettingsSnapshot;
  const edits = {
    creativeDefaultWindow: '7d', creativeSpendFloorGbp: 61.25, creativePurchaseMinimum: 3,
    creativeFadeFrequency: 3.5, creativeFadeCtrDropPercent: 44, creativeWeeklyTarget: 8,
    creativeHitWinnerSpendGbp: 120, creativeHitKilledSpendGbp: 90,
    creativeHitKilledTargetMultiplier: 1.75, creativeLiftWindowDays: 28,
    creativeLiftMinimumGroups: 4, creativeLiftMinimumSpendGbp: 175,
    creativeMediaCapMb: 350, creativeScanModel: 'claude-invented-browser-model',
    creativeScanInputPrice: 1.25, creativeScanOutputPrice: 6.25,
    creativeScanCapGbp: 2.5, creativeFreelancerInitial: 'Q',
  } as const;
  const open = async () => {
    const summary = page.locator('summary').filter({ hasText: 'Ad spend' });
    if (await summary.locator('..').getAttribute('open') === null) await summary.click();
  };
  const save = async () => {
    const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/settings' && response.request().method() === 'POST');
    await page.locator('#settings-save').click();
    assert.equal((await response).status(), 200);
    await page.waitForFunction(() => document.querySelector('#settings-message')?.textContent === 'Settings saved.');
  };
  const fill = async (key: string, value: string | number) => {
    const input = page.locator(`[data-setting-path="${key}"]`);
    if (key === 'creativeDefaultWindow') await input.selectOption(String(value));
    else await input.fill(String(value));
  };
  await open();
  assert.equal(await page.locator('[data-creative-scan-prices]').isVisible(), before.values.creativeScanInputPrice === 0 || before.values.creativeScanOutputPrice === 0);
  for (const [key, value] of Object.entries(edits)) await fill(key, value);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('[name="creativeScanEnabled"], [name="metaActionsEnabled"]').count(), 0);
    assert.match(await page.locator('[data-creative-scan-flag]').innerText(), /^(?:On|Off)$/);
    assert.match(await page.locator('[data-meta-actions-flag]').innerText(), /Off/);
  }
  await save();
  assert.equal(await page.locator('[data-creative-scan-prices]').isVisible(), false);
  const after = await (await context.request.get('/api/settings')).json() as SettingsSnapshot;
  assert.deepEqual(after.values, { ...before.values, ...edits });
  await page.reload();
  await open();
  assert.equal(await page.locator('[data-creative-scan-prices]').isVisible(), false);
  for (const [key, value] of Object.entries(edits)) assert.equal(await page.locator(`[data-setting-path="${key}"]`).inputValue(), String(value));
  for (const key of Object.keys(edits) as (keyof typeof edits)[]) await fill(key, before.values[key]);
  await save();
  assert.deepEqual((await (await context.request.get('/api/settings')).json() as SettingsSnapshot).values, before.values);
  assert.equal(await page.locator('[data-creative-scan-prices]').isVisible(), before.values.creativeScanInputPrice === 0 || before.values.creativeScanOutputPrice === 0);
  // Leave this group collapsed for the existing campaign browser checks.
  await page.locator('summary').filter({ hasText: 'Ad spend' }).click();
}
