import assert from 'node:assert/strict';
import type { Page } from 'playwright';

async function checkChapter(page: Page, id: string, number: string, category: string, title: string): Promise<void> {
  const section = page.locator(`#${id}`);
  assert.equal(await section.locator('.chapter-number').innerText(), number);
  assert.equal(await section.locator('.chapter-eyebrow').innerText(), category.toUpperCase());
  assert.ok((await section.locator('.chapter-title').innerText()).startsWith(title));
  await section.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
  const layout = await section.evaluate(element => {
    const heading = element.querySelector<HTMLElement>('.chapter-title')!;
    const number = element.querySelector<HTMLElement>('.chapter-number')!;
    const wrapper = getComputedStyle(element), disc = getComputedStyle(number), title = getComputedStyle(heading);
    return { headingTop: heading.getBoundingClientRect().top,
      navBottom: document.querySelector('.top')!.getBoundingClientRect().bottom,
      sideways: document.documentElement.scrollWidth > innerWidth,
      padding: wrapper.padding, border: wrapper.borderWidth, background: wrapper.backgroundColor,
      shadow: wrapper.boxShadow, blur: wrapper.backdropFilter,
      numberWidth: number.getBoundingClientRect().width, numberHeight: number.getBoundingClientRect().height,
      numberBorder: disc.borderWidth, numberFont: disc.fontSize, numberWeight: disc.fontWeight,
      titleFont: title.fontSize, titleWeight: title.fontWeight,
      gap: getComputedStyle(document.querySelector('main')!).rowGap };
  });
  assert.equal(layout.sideways, false, `${id}: no sideways scroll`);
  assert.ok(layout.headingTop >= layout.navBottom - .5, `${id}: title clears the fixed navigation`);
  assert.equal(layout.padding, '0px'); assert.equal(layout.border, '0px');
  assert.equal(layout.background, 'rgba(0, 0, 0, 0)');
  assert.equal(layout.shadow, 'none'); assert.equal(layout.blur, 'none');
  assert.equal(layout.numberWidth, 30); assert.equal(layout.numberHeight, 30);
  assert.equal(layout.numberBorder, '1px'); assert.equal(layout.numberFont, '13px'); assert.equal(layout.numberWeight, '800');
  assert.equal(layout.titleFont, '26px'); assert.equal(layout.titleWeight, '800');
  assert.equal(layout.gap, '34px');
}

/** Call on the hydrated Home page at each test width; snapshot re-renders use the same review heading. */
export async function checkHomeChapters(page: Page): Promise<void> {
  assert.equal(await page.locator('main > .chapter').count(), 4);
  assert.equal(await page.locator('#hero .chapter-heading').count(), 0);
  const sourceRowsFit = await page.locator('.chapter .trow').evaluateAll(rows => rows.every(row => {
    const box = row.getBoundingClientRect();
    return Array.from(row.children).every(child => {
      const item = child.getBoundingClientRect();
      return item.left >= box.left - .5 && item.right <= box.right + .5;
    });
  }));
  assert.equal(sourceRowsFit, true, 'Source labels, icons and test-row content fit inside the chapter cards');
  for (const [id, number, category, title] of [['table', '1', 'Decisions', 'On the table'],
    ['reviews', '2', 'Customers', 'New reviews'], ['tests', '3', 'Experiments', 'Tests'], ['dials', '4', 'By source', 'Dials']]) {
    await checkChapter(page, id!, number!, category!, title!);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}

/** Call after navigating to /fulfilment at each test width. */
export async function checkFulfilmentChapter(page: Page): Promise<void> {
  await checkChapter(page, 'fulfilment', '5', 'Fulfilment', 'Fulfilment costs');
}
