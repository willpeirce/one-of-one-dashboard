import assert from 'node:assert/strict';
import type { BrowserContext, Page } from 'playwright';

export async function assertHandoverLayout(page: Page, width: number): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Handover fits ${width}px`);
  const header = (await page.locator('header.top').boundingBox())!, main = (await page.locator('main').boundingBox())!;
  assert.ok(header.height < 70 && main.y >= header.y + header.height, 'Handover keeps the shared compact header above its content');
  for (const control of await page.locator('header.top a, main button, main a, main summary').all()) if (await control.isVisible()) {
    const box = (await control.boundingBox())!;
    assert.ok(box.height >= 44 && box.width >= 44, `${width}px Handover control ${await control.innerText()} needs a 44px tap target`);
  }
}

export async function checkHandoverBase(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({width, height: 900});
      await page.emulateMedia({colorScheme: 'light'});
      await page.goto('/handover');
      await page.getByRole('heading', {name: 'Handover', exact: true}).waitFor();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      assert.equal(await page.locator('header.top + #tk-strip').count(), 1);
      await assertHandoverLayout(page, width);
      if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/handover-${width}.png`, fullPage: true});
    }
    await page.goto('/');
    await page.locator('html[data-dashboard-ready="true"]').waitFor();
    await page.locator('#account-menu > summary').click();
    await page.locator('#account-menu').getByRole('link', {name: 'Handover', exact: true}).click();
    await page.waitForURL('**/handover');
    await page.getByRole('heading', {name: 'Handover', exact: true}).waitFor();
  } finally {await page.close();}
}
