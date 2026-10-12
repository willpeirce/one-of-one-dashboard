import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';
import type { DashboardSnapshot } from '../src/dashboard-types.js';

/** Invented source and dial states exercise the chart without live accounts. */
export async function checkRadar(context: BrowserContext): Promise<void> {
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
      const radar = page.locator('#radar');
      const unmeasured = radar.locator('.radar-spoke[data-radar-area="growth"]');
      assert.equal(await unmeasured.getAttribute('data-measured'), 'false');
      assert.equal(await unmeasured.getAttribute('stroke-dasharray'), '4 4');
      const dot = radar.locator('[data-radar-key="growth"] .radar-dot');
      const rim = await unmeasured.evaluate(element => ({ x: element.getAttribute('x2'), y: element.getAttribute('y2') }));
      assert.equal(await dot.getAttribute('cx'), rim.x);
      assert.equal(await dot.getAttribute('cy'), rim.y);
      assert.equal(await dot.getAttribute('fill'), 'var(--info)');
      assert.equal(await radar.locator('[data-radar-key="growth"] text tspan').textContent(), 'Not built');
      assert.equal(await radar.locator('.radar-health').textContent(), '83');
      assert.equal(await radar.locator('.radar-weakest').innerText(), 'Weakest: Google, Ad spend has missed three polls. Check Source health.');
      for (const selector of ['[data-radar-key="google"] text', '[data-radar-key="google"] .radar-dot']) {
        await radar.locator(selector).click();
        assert.equal(await page.locator('#sh-title').innerText(), google.value.l);
        await page.locator('#sh-x').click();
      }
      const label = radar.locator('[data-radar-key="google"]').filter({ has: page.locator('text') });
      await label.focus(); await label.press('Enter');
      assert.equal(await page.locator('#sh-title').innerText(), google.value.l);
      await page.locator('#sh-x').click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/radar-${viewport.width}.png` });
      await radar.locator('[data-radar-key="growth"] text').click();
      await page.waitForURL('**/sources');
      assert.equal(new URL(page.url()).pathname, '/sources');
    }
    store.mode = 'sample';
    await page.goto('/');
    await page.locator('html[data-dashboard-ready="true"]').waitFor();
    await page.waitForFunction(() => document.querySelector('#counts .health')?.textContent === 'Not enough data');
    assert.equal(await page.locator('#radar .radar-health').textContent(), 'Not enough data');
    assert.equal(await page.locator('#radar .radar-spoke[data-measured="true"]').count(), 2);
  } finally { await page.close(); }
}
