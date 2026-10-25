import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';
import type { DashboardSnapshot } from '../src/dashboard-types.js';

/** Invented source and dial states exercise the drop line without live accounts. */
export async function checkDrops(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    const response = await context.request.get('/api/dashboard');
    assert.equal(response.status(), 200);
    const fixture = await response.json() as DashboardSnapshot;
    const google = fixture.widgets.w024, store = fixture.widgets.w029;
    assert.ok(google?.kind === 'dial' && store?.kind === 'dial');
    for (const [id, widget] of Object.entries(fixture.widgets)) {
      widget.mode = 'sample';
      if (['w024', 'w025', 'w026'].includes(id) && widget.kind === 'dial') widget.value.cap = id === 'w024' ? 'warn' : 'good';
    }
    store.mode = 'live'; store.value.cap = 'good';
    fixture.adSources = [
      { source: 'meta', live: true, status: 'live', fetchedAt: '2026-09-30T10:00:00Z' },
      { source: 'google-ads', live: true, status: 'stale', fetchedAt: '2026-09-30T08:00:00Z', stale: true },
    ];
    await page.route('**/api/dashboard', route => route.fulfill({ status: 200, json: fixture }));
    await page.route('**/api/events', route => route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: `retry: 60000\nevent: dashboard\ndata: ${JSON.stringify(fixture)}\n\n` }));
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 960 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await page.locator('html[data-dashboard-ready="true"]').waitFor();
      await page.waitForFunction(() => document.querySelector('#counts .health')?.textContent === '83 health');
      assert.equal(await page.locator('#radar').count(), 0);
      assert.match(await page.locator('#drops').innerText(), /▼ Dropped:.*Google/s);
      assert.match(await page.locator('#drops').innerText(), new RegExp(google.value.l));
      const label = page.locator('[data-drop-key="google"]');
      await label.focus(); await label.press('Enter');
      const gauge = page.locator('.drop-highlight');
      assert.equal(await gauge.getAttribute('data-model-id'), 'w024');
      assert.equal(await gauge.isVisible(), true);
      assert.equal(await page.locator('#drops').evaluate(element => element.scrollWidth <= element.clientWidth), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    store.mode = 'sample';
    await page.goto('/');
    await page.locator('html[data-dashboard-ready="true"]').waitFor();
    await page.waitForFunction(() => document.querySelector('#counts .health')?.textContent === 'Not enough data');
  } finally { await page.close(); }
}
