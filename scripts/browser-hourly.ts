import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';
import { hourLabel } from '../src/hourly-orders.js';
import type { DashboardSnapshot } from '../src/dashboard-types.js';
export async function checkHourly(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    const fixture = await (await context.request.get('/api/dashboard')).json() as DashboardSnapshot;
    await page.route('**/api/dashboard', route => route.fulfill({ json: fixture }));
    await page.route('**/api/events', route => route.fulfill({ contentType: 'text/event-stream', body: `event: dashboard\ndata: ${JSON.stringify(fixture)}\n\n` }));
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 960 }); await page.goto('/');
      await page.locator('html[data-dashboard-ready=true]').waitFor();
      const chart = page.locator('#hourly-orders');
      await page.setViewportSize({ width: width + 20, height: 960 });
      await page.waitForFunction(() => { const host = document.querySelector('#hourly-orders')!; return Number(host.querySelector('.hourly-plot svg')?.getAttribute('viewBox')?.split(' ')[2]) === host.clientWidth; });
      await page.setViewportSize({ width, height: 960 });
      await page.waitForFunction(() => { const host = document.querySelector('#hourly-orders')!; return Number(host.querySelector('.hourly-plot svg')?.getAttribute('viewBox')?.split(' ')[2]) === host.clientWidth; });
      const draws = await page.evaluate(async () => {
        const host = document.querySelector('#hourly-orders')!;
        const replace = host.replaceChildren.bind(host); let calls = 0;
        host.replaceChildren = (...nodes) => { calls++; replace(...nodes); };
        for (let i = 0; i < 30; i++) window.dispatchEvent(new Event('resize'));
        const before = calls;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const first = calls;
        window.dispatchEvent(new Event('resize'));
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        host.replaceChildren = replace;
        return [before, first, calls];
      });
      assert.deepEqual(draws, [0, 1, 2], 'resize events draw at most once per frame');
      assert.equal(await chart.locator('tbody tr').count(), 24);
      assert.equal(await chart.locator('.hourly-legend svg').count(), 2);
      assert.equal(await chart.locator('[data-hourly-partial]').getAttribute('stroke-dasharray'), '2 4');
      assert.equal(await chart.locator('[data-hourly-yesterday]').getAttribute('stroke-dasharray'), '6 4');
      assert.match(await chart.innerText(), /Sample data/);
      assert.ok((await chart.boundingBox())!.height < 155);
      for (const market of ['all', 'uk', 'us'] as const) {
        await page.locator(`#market [data-market=${market}]`).click();
        const label = await chart.locator('[role=img]').getAttribute('aria-label');
        const sum = fixture.hero.today.markets![market].hourly!.today.reduce<number>((n,v) => n+(v??0),0);
        assert.match(label!, new RegExp(`Today ${sum} so far`));
        for (const period of ['yday', '7d', '30d', 'today']) {
          await page.locator(`[data-period="${period}"]`).click();
          assert.equal(await chart.locator('[role=img]').getAttribute('aria-label'), label);
        }
      }
      const plot = chart.locator('.hourly-plot');
      await plot.focus(); await plot.press('ArrowLeft');
      assert.match(await chart.locator('.hourly-tooltip').innerText(), new RegExp(`${hourLabel(Math.max(0, fixture.hero.today.markets!.us.hourly!.nowHour - 1))} · Today \\d+ · Yesterday \\d+`));
      for (let hour = 0; hour < 24; hour++) await plot.press('ArrowRight');
      assert.match(await chart.locator('.hourly-tooltip').innerText(), /11 PM · Today Not yet · Yesterday/);
      assert.equal(await chart.locator('tbody tr').last().locator('td').first().innerText(), 'Not yet');
      await plot.press('Escape'); assert.equal(await chart.locator('.hourly-tooltip').isVisible(), false);
      await plot.hover({ position: { x: 100, y: 40 } });
      assert.equal(await chart.locator('.hourly-tooltip').isVisible(), true);
      await plot.click({ position: { x: 150, y: 50 } });
      assert.equal(await chart.locator('.hourly-tooltip').isVisible(), true);
      if (width === 390) {
        const bounds = (await plot.boundingBox())!;
        const touch = await context.newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + 100, y: bounds.y + 40 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.equal(await chart.locator('.hourly-tooltip').isVisible(), true);
        await touch.detach();
      }
      if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/hourly-${width}.png` });
    }
    fixture.hero.today.markets!.us.hourly!.ready = false;
    await page.goto('/'); await page.locator('html[data-dashboard-ready=true]').waitFor();
    await page.locator('#market [data-market=us]').click();
    await page.locator('#hourly-orders .hourly-unavailable').waitFor();
    assert.equal(await page.locator('#hourly-orders').innerText(), 'Hourly orders unavailable');
  } finally { await page.close(); }
}
