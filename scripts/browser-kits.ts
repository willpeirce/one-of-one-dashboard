import assert from 'node:assert/strict';
import type { BrowserContext, Locator, Page } from 'playwright';
import type { DashboardSnapshot } from '../src/dashboard-types.js';
import { dashboardPage } from '../src/dashboard-view.js';
import { homeKits } from '../src/kits/presentation.js';
import { sampleKitFacts } from '../src/kits/sample.js';
import { checkKitsBudget } from './home-compact-browser-check.js';

const now = new Date('2032-04-07T12:00:00Z');
const cardIds = ['box-a', 'box-b', 'box-c'];
const foldedIds = ['box-d', 'box-e', 'box-f'];

async function targets(scope: Locator): Promise<void> {
  for (const control of await scope.locator('button,a,summary').all()) {
    if (!await control.isVisible()) continue;
    const box = await control.boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44, 'Every Kits control has a 44px target');
  }
}

async function noOverflow(page: Page, width: number): Promise<void> {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
    `Kits has no sideways page scroll at ${width}px`);
}

async function plainHeading(page: Page): Promise<void> {
  const heading = page.locator('#kits .kits-heading');
  const summary = heading.locator('.chapter-copy .kits-summary'), link = heading.locator('[data-kits-all]');
  assert.equal(await summary.count(), 1, 'The Kits summary sits inside the title copy, as Reviews does');
  assert.match(await summary.innerText(), /^3 on the go · 3 planned · updated /);
  assert.equal(await link.innerText(), 'All kits ›');
  const geometry = await page.evaluate(() => {
    const heading = document.querySelector('#kits .kits-heading')!.getBoundingClientRect();
    const title = document.querySelector('#kits .chapter-title')!.getBoundingClientRect();
    const summary = document.querySelector('#kits .kits-summary')!.getBoundingClientRect();
    const link = document.querySelector('#kits [data-kits-all]')!.getBoundingClientRect();
    const reviews = document.querySelector('#reviews .chapter-heading')!.getBoundingClientRect();
    return {title: {x: title.x, bottom: title.bottom}, summary: {x: summary.x, top: summary.top},
      heading: {top: heading.top, right: heading.right}, link: {top: link.top, right: link.right, x: link.x},
      kitsGap: document.querySelector('#kits .kit-cards')!.getBoundingClientRect().top - heading.bottom,
      reviewsGap: document.querySelector('#reviews .rvlist')!.getBoundingClientRect().top - reviews.bottom};
  });
  assert.ok(geometry.summary.top >= geometry.title.bottom, 'The summary has its own line below Kits');
  assert.ok(Math.abs(geometry.summary.x - geometry.title.x) < 1, 'The summary aligns with the title');
  assert.ok(geometry.link.x > geometry.title.x && Math.abs(geometry.link.right - geometry.heading.right) < 1,
    'All kits is at the right of the heading');
  assert.ok(Math.abs(geometry.link.top - geometry.heading.top) < 1, 'All kits remains at the top right');
  assert.ok(geometry.kitsGap > 0 && Math.abs(geometry.kitsGap - geometry.reviewsGap) < 1,
    'The gap below Kits matches the gap below the Reviews heading');
}

/** Cards retain the full move sentence; captions wrap on word boundaries within three lines. */
export async function checkPlainKitCards(cards: Locator): Promise<void> {
  for (const card of await cards.all()) {
    assert.equal(await card.locator('.kit-waiting,.kit-next-move').count(), 0, 'The old waiting chip and one-line move are gone');
    for (const action of await card.locator('.kit-action').all()) {
      const measure = await action.evaluate(element => {
        const style = getComputedStyle(element);
        return {whiteSpace: style.whiteSpace, clamp: style.webkitLineClamp,
          height: element.clientHeight, scrollHeight: element.scrollHeight,
          width: element.clientWidth, scrollWidth: element.scrollWidth};
      });
      assert.equal(measure.whiteSpace, 'normal', 'Move sentences wrap normally');
      assert.equal(measure.clamp, 'none', 'Move sentences have no line clamp');
      assert.ok(measure.scrollHeight <= measure.height + 1 && measure.scrollWidth <= measure.width + 1,
        'The whole move sentence fits its visible box');
    }
    const caption = card.locator('.kit-launch > span');
    if (await caption.count()) {
      const measure = await caption.evaluate(element => {
        const style = getComputedStyle(element), box = element.getBoundingClientRect();
        return {height: box.height, line: Number.parseFloat(style.lineHeight),
          whiteSpace: style.whiteSpace, wordBreak: style.wordBreak, hyphens: style.hyphens};
      });
      assert.ok(measure.height <= 3 * measure.line + 1, 'Launch captions use no more than three lines');
      assert.equal(measure.whiteSpace, 'normal', 'Launch captions wrap rather than staying on one line');
      assert.equal(measure.wordBreak, 'normal', 'Launch captions do not break words in the middle');
      assert.equal(measure.hyphens, 'none', 'Launch captions do not insert mid-word hyphens');
    }
  }
}

/** Invented fixed-clock cards; the real signed-in detail route is exercised when a sheet opens. */
export async function checkKits(context: BrowserContext): Promise<void> {
  const response = await context.request.get('/api/dashboard'); assert.equal(response.status(), 200);
  const fixture = await response.json() as DashboardSnapshot;
  fixture.kits = homeKits(sampleKitFacts(now), 'sample', now);
  const page = await context.newPage();
  const replay = async () => {
    fixture.generatedAt = new Date(Date.parse(fixture.generatedAt) + 1000).toISOString();
    await page.evaluate(next => (window as unknown as {pulseMarketStream: EventSource}).pulseMarketStream
      .dispatchEvent(new MessageEvent('dashboard', {data: JSON.stringify(next)})), fixture);
    await page.waitForFunction(stamp => document.documentElement.dataset.updatedAt === stamp, fixture.generatedAt);
  };
  try {
    await page.route('**/api/dashboard', route => route.fulfill({json: fixture}));
    await page.route('**/api/events', route => route.fulfill({contentType: 'text/event-stream', body: 'retry: 60000\n\n'}));
    await page.route('**/', route => route.fulfill({contentType: 'text/html', body: dashboardPage(fixture)}));
    for (const width of [360, 390, 768, 1280]) {
      await page.setViewportSize({width, height: 960}); await page.goto('/');
      await page.locator('html[data-dashboard-ready="true"]').waitFor();
      await page.evaluate(async () => { await document.fonts.ready; });
      const kits = page.locator('#kits'), cards = kits.locator('.kit-card'), fold = kits.locator('[data-kits-fold]');
      assert.equal(await cards.count(), 3);
      assert.deepEqual(await cards.evaluateAll(rows => rows.map(row => row.getAttribute('data-kit-open'))), cardIds);
      assert.match(await kits.innerText(), /Sample data/i);
      assert.equal(await fold.getAttribute('aria-expanded'), 'false');
      assert.equal(await fold.innerText(), '+3 planned · show');
      assert.equal(await kits.locator('.kit-folded-row:visible').count(), 0);
      // Server markup and hydration share the exact same renderer, including the summary and track labels.
      const expected = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').querySelector('#kits')!.innerHTML,
        dashboardPage(fixture));
      assert.equal(await kits.innerHTML(), expected);
      if (width === 390 || width === 1280) {
        await checkKitsBudget(page, width);
        await plainHeading(page);
        if (process.env.PULSE_SCREENSHOT_DIR) await kits.screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/kits-${width}.png`});
      }
      await targets(kits); await noOverflow(page, width);
      await checkPlainKitCards(cards);
      const boxes = await cards.evaluateAll(elements => elements.map(element => {
        const b = element.getBoundingClientRect(); return {x: b.x, y: b.y, width: b.width, bottom: b.bottom};
      }));
      if (width === 390) for (let i = 1; i < boxes.length; i++) {
        assert.equal(boxes[i]!.x, boxes[0]!.x);
        assert.ok(boxes[i]!.y >= boxes[i - 1]!.bottom, 'Phone cards form one column');
      }
      if (width === 1280) for (const box of boxes) {
        assert.equal(box.y, boxes[0]!.y, 'Desktop cards share one row');
        assert.ok(Math.abs(box.width - boxes[0]!.width) < 1, 'Desktop card columns are equal');
      }
      const boxB = cards.filter({hasText: 'Box B'});
      assert.equal(await boxB.locator('[data-kit-track]').getAttribute('role'), 'img');
      assert.equal(await boxB.locator('[data-kit-track]').getAttribute('aria-label'),
        'Stage 3 of 7, Safety tests. Done: Choosing the theme, Being designed. To come: Being made, Shipping to us, On sale, Sold out.');
      assert.equal(await boxB.locator('.kit-status').innerText(), '◆ Safety tests');
      assert.equal(await boxB.locator('.kit-move-label').innerText(), '○ Nothing for you right now');
      assert.equal(await boxB.locator('.kit-move-note').innerText(), 'Waiting 6 days');
      assert.equal(await boxB.locator('.kit-move-yours').count(), 0);
      const boxC = cards.filter({hasText: 'Box C'});
      assert.equal(await boxC.locator('.kit-move-yours .kit-move-label').innerText(), '◆ Your move');
      assert.equal(await boxC.locator('.kit-action').innerText(), fixture.kits!.cards[2]!.move!.action);
      assert.equal(await cards.first().locator('.kit-status').innerText(), '● On sale');
      await fold.click();
      assert.equal(await fold.getAttribute('aria-expanded'), 'true');
      assert.equal(await fold.innerText(), 'Hide planned');
      assert.equal(await kits.locator('.kit-folded-row:visible').count(), 3);
      assert.deepEqual(await kits.locator('.kit-folded-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-kit-open'))), foldedIds);
      await targets(kits); await noOverflow(page, width);
      if (width === 1280) {
        const folded = await kits.locator('.kit-folded-row').evaluateAll(rows => rows.map(row => ({x: row.getBoundingClientRect().x, y: row.getBoundingClientRect().y})));
        assert.equal(folded[0]!.y, folded[1]!.y, 'Desktop folded rows use two columns');
        assert.notEqual(folded[0]!.x, folded[1]!.x);
      }
      await fold.click();
      await page.locator('#hero [data-k="orders"]').click();
      await page.locator('#sheet[open]').waitFor(); await page.locator('#sh-x').click();
      await boxB.click();
      await page.locator('#sheet[open] [data-kit-sheet]').waitFor();
      assert.equal(await page.locator('#sh-title').innerText(), 'Box B');
      assert.equal(await page.locator('[data-kit-order-count]').innerText(), 'On order · 3 of 5');
      assert.equal(await page.locator('[data-kit-order]:visible').count(), 3);
      assert.equal(await page.locator('[data-kit-orders-toggle]').innerText(), '+2 more');
      assert.doesNotMatch(await page.locator('#sh-extra [data-kit-sheet]').innerText(), /a supplier/);
      assert.equal(await page.locator('#sheet .kit-move-label').innerText(), '○ Nothing for you right now');
      assert.equal(await page.locator('#sheet .kit-move-note').innerText(), 'Waiting 6 days');
      assert.match(await page.locator('#sheet .kit-checklist').innerText(), /Safety tests now/);
      assert.equal(await page.locator('#sheet .kit-move').evaluate(element =>
        !!(element.compareDocumentPosition(document.querySelector('#sheet .kit-checklist')!) & Node.DOCUMENT_POSITION_FOLLOWING)), true,
      'The shared move box comes before the sheet checklist');
      if (process.env.PULSE_SCREENSHOT_DIR && (width === 390 || width === 1280))
        await page.locator('#sheet').screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/kits-sheet-${width}.png`});
      await page.locator('[data-kit-orders-toggle]').click();
      assert.equal(await page.locator('[data-kit-order]:visible').count(), 5);
      assert.equal(await page.locator('[data-kit-order-count]').innerText(), 'On order · 5 of 5');
      if (width === 360 || width === 390) {
        const steps = await page.locator('.kit-checklist li').evaluateAll(rows => rows.map(row => ({x: row.getBoundingClientRect().x, y: row.getBoundingClientRect().y})));
        assert.equal(steps[0]!.y, steps[1]!.y, 'The phone checklist uses two columns');
        assert.notEqual(steps[0]!.x, steps[1]!.x);
      }
      await targets(page.locator('#sheet')); await noOverflow(page, width);
      await replay();
      assert.equal(await page.locator('#sh-title').innerText(), 'Box B', 'A snapshot does not replace an open Kit with an old ordinary detail');
      assert.equal(await page.locator('#sheet[open] [data-kit-sheet]').count(), 1);
      await page.locator('#sh-x').click();
      await page.emulateMedia({reducedMotion: 'reduce'});
      assert.equal(await cards.first().locator('.kit-track-current').evaluate(el => getComputedStyle(el).animationName), 'none');
      await page.emulateMedia({reducedMotion: 'no-preference'});
    }
    // Exercise a full bounded sentence separately from the ordinary sample and its height budget.
    const originalKits = fixture.kits, longFacts = sampleKitFacts(now);
    const longAction = 'Read the invented proof in full, check the border on every panel, and choose whether the kit maker should use the first design or prepare a second sample before the next production step.';
    longFacts.kits.rows[2]!.nextAction = longAction;
    const longCaptionWord = 'Extraordinarycollection'.repeat(2);
    longFacts.kits.rows[0]!.launchLabel = longCaptionWord;
    fixture.kits = homeKits(longFacts, 'sample', now);
    await page.emulateMedia({reducedMotion: 'reduce'});
    for (const width of [390, 1280]) {
      await page.setViewportSize({width, height: 960}); await replay();
      const cards = page.locator('#kits .kit-card');
      const action = cards.filter({hasText: 'Box C'}).locator('.kit-action');
      assert.equal(await action.innerText(), longAction, 'Every word of the move remains visible');
      assert.ok(await action.evaluate(element => element.getBoundingClientRect().height > Number.parseFloat(getComputedStyle(element).lineHeight)),
        'A long move actually wraps onto more than one line');
      await checkPlainKitCards(cards); await noOverflow(page, width);
      const caption = cards.first().locator('.kit-launch-caption');
      const word = caption.locator('.kit-caption-word').filter({hasText: longCaptionWord});
      assert.equal(await caption.getAttribute('title'), fixture.kits!.cards[0]!.launch,
        'The complete caption remains available when a word is omitted');
      assert.ok((await word.boundingBox())!.width > (await caption.boundingBox())!.width,
        'The regression word is wider than the caption');
      const painted = await caption.screenshot({animations: 'disabled'});
      await word.evaluate(element => { (element as HTMLElement).style.opacity = '0'; });
      assert.equal(await word.evaluate(element => getComputedStyle(element).opacity), '0');
      assert.deepEqual(await caption.screenshot({animations: 'disabled'}), painted,
        'Hiding the oversized word changes no pixels: it was wholly elided, never partly painted');
      await word.evaluate(element => { (element as HTMLElement).style.removeProperty('opacity'); });
    }
    await page.emulateMedia({reducedMotion: 'no-preference'});
    fixture.kits = originalKits; await replay();
    // A response received after closing the sheet must not replace a newly opened ordinary detail.
    const boxB = page.locator('#kits .kit-card').filter({hasText: 'Box B'}), id = await boxB.getAttribute('data-kit-open');
    assert.ok(id);
    const detail = await context.request.get(`/api/kits/${encodeURIComponent(id)}`); assert.equal(detail.status(), 200);
    const detailBody: unknown = await detail.json();
    let release!: () => void, seen!: () => void;
    const delayed = new Promise<void>(resolve => {release = resolve;}), requested = new Promise<void>(resolve => {seen = resolve;});
    await page.route(`**/api/kits/${encodeURIComponent(id)}`, async route => {seen(); await delayed; await route.fulfill({json: detailBody});});
    await boxB.click(); await requested;
    await page.locator('#sh-x').click();
    await page.locator('#hero [data-k="orders"]').click();
    const ordinaryTitle = await page.locator('#sh-title').innerText();
    const finished = page.waitForResponse(response => response.url().endsWith(`/api/kits/${encodeURIComponent(id)}`));
    release(); await finished;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await page.locator('#sh-title').innerText(), ordinaryTitle);
    assert.equal(await page.locator('#sheet [data-kit-sheet]').count(), 0, 'A closed Kit request cannot overwrite another sheet');
    await page.locator('#sh-x').click();
    await boxB.click(); await page.locator('#sheet[open] [data-kit-sheet]').waitFor();
    const previous = fixture.kits;
    fixture.kits = homeKits(sampleKitFacts(now), 'live', now);
    await replay();
    assert.equal(await page.locator('#sheet[open]').count(), 0, 'A live snapshot suppressing sample kits closes their open sheet');
    assert.equal(await page.locator('#kits .kit-card').count(), 0);
    assert.match(await page.locator('#kits').innerText(), /Not set up yet/);
    fixture.kits = previous; await replay();
    assert.equal(await page.locator('#kits .kit-card').count(), 3);
  } finally {await page.close();}
}
