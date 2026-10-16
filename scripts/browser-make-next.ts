import assert from 'node:assert/strict';
import type { Page } from 'playwright';

export async function checkMakeNext(page: Page, width: number): Promise<void> {
  for (const colorScheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const panel = page.locator('.creative-lifts');
    assert.equal(await panel.locator('h2').innerText(), 'Make next');
    assert.equal(await page.locator('.creative-lines').getByText(/Winning in/).count(), 0);
    const order = await page.evaluate(() => {
      const filters = document.querySelector('#creative-filters')!, brief = document.querySelector('.creative-lifts')!, queue = document.querySelector('.creative-tagging-queue')!;
      return Boolean(filters.compareDocumentPosition(brief) & Node.DOCUMENT_POSITION_FOLLOWING)
        && Boolean(brief.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    assert.equal(order, true);
    for (const days of [1, 3, 7]) {
      await page.locator(`[data-lift-window="${days}"]`).click();
      await page.locator(`[data-lift-window="${days}"][aria-pressed="true"]`).waitFor();
      await page.reload();
      await page.locator(`[data-lift-window="${days}"][aria-pressed="true"]`).waitFor();
      await page.locator('[data-full-evidence="video"]').click();
      assert.match(await page.locator('#creative-sheet-title').innerText(), new RegExp(`Full evidence · Video · ${days} day`));
      assert.match(await page.locator('#creative-sheet-body').innerText(), /resamples held/);
      assert.equal(await page.locator('#creative-sheet .strength-meter[aria-label="Strength: strong"]').count(), 1);
      await page.locator('[data-creative-close]').click();
    }
    const video = page.locator('[data-make-next="video"]'), image = page.locator('[data-make-next="image"]');
    const boxes = [await video.boundingBox(), await image.boundingBox()];
    assert.ok(boxes[0] && boxes[1]);
    if (width === 390) assert.ok(boxes[1]!.y >= boxes[0]!.y + boxes[0]!.height);
    else assert.equal(boxes[1]!.y, boxes[0]!.y);
    for (const tile of [video, image]) {
      assert.ok(await tile.locator('li').count() <= 3);
      const visible = await tile.locator('li').evaluateAll(items => items.map(item => {
        const text = item.querySelector('[data-brief-text]')!.textContent;
        const strength = item.querySelector('.strength-meter')!.getAttribute('data-strength')!;
        return `${text} [${strength[0]!.toUpperCase() + strength.slice(1)}]`;
      }));
      const expected = [...visible, await tile.locator('.creative-brief-examples').innerText(), await tile.locator('.creative-brief-footer').innerText()].join('\n');
      await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__inventedCopiedBrief = text; } } });`);
      await tile.locator('[data-creative-copy]').click();
      assert.equal(await page.evaluate(() => (window as any).__inventedCopiedBrief), expected);
      const bars = await tile.locator('.strength-meter').first().evaluate(meter => Array.from(meter.children).map(bar => {
        const style = getComputedStyle(bar); return { width: style.width, height: style.height, color: style.backgroundColor };
      }));
      assert.deepEqual(bars.map(bar => bar.width), ['3px', '3px', '3px']);
      assert.deepEqual(bars.map(bar => bar.height), ['6px', '9px', '12px']);
    }
    await video.locator('.creative-brief-examples button').first().click();
    await page.locator('.creative-media').waitFor();
    assert.match(await page.locator('.creative-sheet-finding').innerText(), /Slab on screen in the first 3 seconds/);
    await page.locator('[data-creative-close]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.PULSE_SCREENSHOT_DIR) await panel.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/make-next-${width}-${colorScheme}.png` });
  }
}
