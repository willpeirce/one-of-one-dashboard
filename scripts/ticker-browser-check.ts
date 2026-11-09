import assert from 'node:assert/strict';
import type { BrowserContext, Locator, Page } from 'playwright';
import type { TickerSnapshot } from '../src/ticker/model.js';

const shells = ['/', '/settings', '/sources', '/ads', '/fulfilment', '/creatives', '/scorecard', '/audit'];

async function tapSizes(scope: Locator, label: string): Promise<void> {
  for (const control of await scope.locator('button,a').all()) {
    if (!await control.isVisible()) continue;
    const box = await control.boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44,
      `${label}: ${await control.getAttribute('id') ?? await control.textContent()} needs a 44px tap`);
  }
}

async function currentShown(page: Page, snapshot: TickerSnapshot): Promise<void> {
  await page.locator('#tk-strip[data-tk-ready="true"]').waitFor();
  await page.waitForFunction(name => {
    const label = document.querySelector('#tk-band')?.getAttribute('aria-label') ?? '';
    return name ? label.startsWith(`Next up: ${name},`) : label === 'Nothing ahead. Open all dates.';
  }, snapshot.current?.name ?? null);
}

async function sheet(page: Page, opener = '#tk-band'): Promise<void> {
  await page.locator(opener).click();
  await page.locator('#tk-dialog').waitFor({state: 'visible'});
  assert.equal(await page.locator('#tk-dialog').evaluate(element => element.matches(':modal')), true,
    'ticker uses the native modal top layer');
  assert.equal(await page.locator('#tk-dialog').evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + Math.min(30, box.height / 2)));
  }), true, 'the sheet is above the sticky header');
  await tapSizes(page.locator('#tk-dialog'), 'Coming up sheet');
}

async function closeSheet(page: Page, opener = 'tk-band'): Promise<void> {
  await page.keyboard.press('Escape');
  await page.locator('#tk-dialog').waitFor({state: 'hidden'});
  assert.equal(await page.evaluate(() => document.activeElement?.id), opener);
}

/** Exercise real local persistence in a separate context so deliberate 503s stay isolated. */
export async function checkTicker(signedIn: BrowserContext): Promise<void> {
  const browser = signedIn.browser()!;
  const initialResponse = await signedIn.request.get('/api/ticker');
  assert.equal(initialResponse.status(), 200);
  assert.equal(initialResponse.headers()['cache-control'], 'no-store');
  const origin = new URL(initialResponse.url()).origin;
  const initial = await initialResponse.json() as TickerSnapshot;
  assert.equal(initial.mode, 'sample');
  const originalPassed = new Set(initial.passed.map(row => row.key));
  const context = await browser.newContext({baseURL: origin, storageState: await signedIn.storageState(), reducedMotion: 'no-preference'});
  const errors: string[] = [];
  let externalRequests = 0;
  context.on('page', page => page.on('pageerror', error => errors.push(error.name)));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
      externalRequests++;
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  const read = async (): Promise<TickerSnapshot> => {
    const response = await context.request.get('/api/ticker');
    assert.equal(response.status(), 200);
    return await response.json() as TickerSnapshot;
  };
  const restore = async (eventKey: string): Promise<void> => {
    const response = await context.request.post('/api/ticker/restore', {headers: {origin}, data: {eventKey}});
    assert.equal(response.status(), 200);
  };
  const clean = async (): Promise<void> => {
    for (const row of (await read()).passed) if (!originalPassed.has(row.key)) await restore(row.key);
  };
  try {
    for (const width of [390, 1280]) {
      const page = await context.newPage();
      await page.setViewportSize({width, height: width === 390 ? 844 : 960});
      try {
        for (const path of shells) {
          await page.goto(path);
          try { await currentShown(page, await read()); }
          catch (error) {
            console.error('Ticker readiness failed', {path, width, scriptErrors: errors, ...await page.evaluate(() => ({
              pagePath: location.pathname,
              stripCount: document.querySelectorAll('#tk-strip').length,
              ready: document.querySelector<HTMLElement>('#tk-strip')?.dataset.tkReady ?? null,
              tickerScript: !!document.querySelector('script[src="/assets/ticker.js"]'),
            }))});
            throw error;
          }
          assert.equal(await page.locator('header.top + #tk-strip').count(), 1, `${path}: one shared strip directly after the header`);
          assert.equal(await page.locator('head link[href="/assets/fonts.css"]').count(), 1, `${path}: shared fonts are loaded`);
          assert.equal(await page.locator('head link[href="/assets/ticker.css"]').count(), 1, `${path}: ticker height is reserved in the head`);
          const strip = (await page.locator('#tk-strip').boundingBox())!, header = (await page.locator('header.top').boundingBox())!;
          assert.equal(strip.height, width === 390 ? 44 : 40, `${path}: fixed strip height`);
          assert.ok(Math.abs(strip.y - header.y - header.height) < 1, `${path}: no unreserved gap below header`);
          assert.equal(await page.locator('#tk-strip').evaluate(element => getComputedStyle(element).zIndex), '5');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${path} at ${width}px has no horizontal overflow`);
          await tapSizes(page.locator('#tk-strip'), `${path} at ${width}px`);
          await sheet(page);
          await closeSheet(page);
          if (path === '/') {
            const top = await page.locator('.hero-grid').evaluate(element => element.getBoundingClientRect().top + scrollY);
            const maximum = width === 390 ? 500 : 410;
            assert.ok(top <= maximum, `${width}px ticker leaves hero top ${top} within ${maximum}`);
            console.log('TICKER HERO FOLD', width, {top, maximum});
          }
        }

        await page.goto('/');
        let before = await read();
        await currentShown(page, before);
        assert.ok(before.current && before.ahead.length >= 4, 'invented sample supplies late, today and ahead rows');
        assert.match(before.current.chip, /late/);
        const track = page.locator('.tk-track');
        assert.equal(await track.getAttribute('aria-hidden'), 'true');
        const runs = await track.evaluate(element => Array.from(element.children).map(child => child.textContent));
        assert.equal(runs.length, 2); assert.equal(runs[0], runs[1]);
        assert.ok(await track.evaluate(element => Number.parseFloat(getComputedStyle(element).animationDuration) >= 18));
        await page.locator('#tk-band').focus();
        assert.equal(await track.evaluate(element => getComputedStyle(element).animationPlayState), 'paused');

        await page.locator('[data-st="soon"]').click();
        await page.locator('[data-tk-home-row]').first().waitFor();
        assert.equal(await page.locator('[data-tk-home-row]').count(), 3);
        const homeNames = await page.locator('[data-tk-home-row]').allTextContents();
        before.ahead.slice(0, 3).forEach((row, index) => assert.ok(homeNames[index]!.includes(row.name)));
        await sheet(page, '#alldates');
        assert.equal(await page.locator('[data-tk-ahead-row]').count(), 3);
        await page.locator('#tk-more').click();
        assert.equal(await page.locator('[data-tk-ahead-row]').count(), before.ahead.length);
        assert.match(await page.locator('#tk-more').innerText(), /Show fewer/);
        await page.locator('#tk-more').click();
        assert.equal(await page.locator('[data-tk-ahead-row]').count(), 3);
        await closeSheet(page, 'alldates');
        await page.evaluate(() => window.scrollTo(0, 0));

        const press = async (button: '#tk-next' | '#tk-undo' | '#tk-retry', endpoint: 'next' | 'restore'): Promise<TickerSnapshot> => {
          const response = page.waitForResponse(value => new URL(value.url()).pathname === `/api/ticker/${endpoint}`);
          await page.locator(button).click();
          const reply = await response; assert.equal(reply.status(), 200);
          const state = await reply.json() as TickerSnapshot;
          await currentShown(page, state);
          return state;
        };
        const passed = before.current;
        let after = await press('#tk-next', 'next');
        assert.equal(after.current?.key, before.ahead[1]!.key);
        assert.equal(after.passed[0]!.key, passed.key);
        assert.ok(after.passed[0]!.passed_at);
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'tk-next');
        assert.match(await page.locator('#tk-status').innerText(), new RegExp(after.current!.name));
        await page.reload(); await currentShown(page, after);
        assert.equal((await read()).current?.key, after.current?.key, 'Next survives reload');

        before = after;
        after = await press('#tk-next', 'next');
        assert.equal(after.current?.key, before.ahead[1]!.key);
        const glint = await page.locator('#tk-band').evaluate(element => getComputedStyle(element, '::after').animationName);
        assert.match(glint, /^tk-glint-/);
        after = await press('#tk-undo', 'restore');
        assert.equal(after.current?.key, before.current!.key, 'Undo restores the item just passed');
        after = await press('#tk-next', 'next');
        const repeatedGlint = await page.locator('#tk-band').evaluate(element => getComputedStyle(element, '::after').animationName);
        assert.match(repeatedGlint, /^tk-glint-/);
        assert.notEqual(repeatedGlint, glint, 'Next after Undo restarts the band glint');
        after = await press('#tk-undo', 'restore');
        assert.equal(after.current?.key, before.current!.key);
        await sheet(page);
        assert.match(await page.locator('[data-tk-passed-row]').first().innerText(), /Passed .*, \d{2}:\d{2} UK/);
        const putBack = page.locator('[data-tk-put-back]').filter({hasText: 'Put back'}).first();
        await page.route('**/api/ticker/restore', route => route.fulfill({status: 503, json: {error: 'Invented restore failure'}}), {times: 1});
        const refusedRestore = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ticker/restore');
        await putBack.click();
        assert.equal((await refusedRestore).status(), 503);
        await page.locator('#tk-sheet-retry').waitFor({state: 'visible'});
        assert.match(await page.locator('#tk-sheet-error').innerText(), /Not saved/);
        assert.equal((await read()).current?.key, before.current!.key, 'failed Put back leaves the persisted list alone');
        assert.ok((await page.locator('[data-tk-passed-row]').first().innerText()).includes(passed.name));
        await tapSizes(page.locator('#tk-dialog'), `failed Put back at ${width}px`);
        const restored = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ticker/restore');
        await page.locator('#tk-sheet-retry').click();
        const restoredResponse = await restored; assert.equal(restoredResponse.status(), 200);
        after = await restoredResponse.json() as TickerSnapshot;
        await currentShown(page, after);
        assert.equal(after.current?.key, passed.key, 'Put back restores a persisted pass');
        assert.equal(await page.locator('#tk-sheet-status').getAttribute('role'), 'status');
        assert.equal(await page.locator('#tk-sheet-status').getAttribute('aria-live'), 'polite');
        assert.ok((await page.locator('#tk-sheet-status').textContent())?.includes(`Next up: ${after.current!.name},`),
          'Put back announces the new current date inside the active modal');
        assert.equal(await page.locator('#tk-status').textContent(), '', 'the inert strip does not duplicate the announcement');
        assert.equal(await page.locator('#tk-undo').isVisible(), false, 'Put back clears the local Undo count');
        await page.locator('#tk-close').click();

        before = await read();
        await press('#tk-next', 'next');
        await press('#tk-next', 'next');
        assert.match(await page.locator('#tk-undo').innerText(), /Undo \(2\)/);
        after = await press('#tk-undo', 'restore');
        assert.equal(after.current?.key, before.ahead[1]!.key, 'multiple passes undo last-first');
        after = await press('#tk-undo', 'restore');
        assert.equal(after.current?.key, before.current!.key);

        await page.emulateMedia({reducedMotion: 'reduce'});
        assert.equal(await page.locator('.tk-static').isVisible(), true);
        assert.equal(await page.locator('.tk-track').isVisible(), false);
        assert.equal(await page.locator('#tk-strip').evaluate(element => element.getAnimations({subtree: true}).filter(animation => animation.playState === 'running').length), 0);
        assert.doesNotMatch(await page.locator('.tk-static').innerText(), /\bthen\b/);
        await tapSizes(page.locator('#tk-strip'), `reduced motion at ${width}px`);

        let reads = 0;
        const onRead = (request: import('playwright').Request) => { if (new URL(request.url()).pathname === '/api/ticker') reads++; };
        page.on('request', onRead);
        const refresh = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ticker');
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        assert.equal((await refresh).status(), 200);
        assert.equal(reads, 1, 'returning to visible refreshes the strip once');
        page.off('request', onRead);

        before = await read();
        const label = await page.locator('#tk-band').getAttribute('aria-label');
        await page.route('**/api/ticker/next', route => route.fulfill({status: 503, json: {error: 'Invented save failure'}}), {times: 1});
        await page.locator('#tk-next').click();
        await page.locator('#tk-retry').waitFor({state: 'visible'});
        assert.match(await page.locator('#tk-retry').innerText(), /Not saved · Try again/);
        assert.equal(await page.locator('#tk-band').getAttribute('aria-label'), label, 'a failed save keeps the displayed list');
        assert.equal((await read()).current?.key, before.current?.key);
        after = await press('#tk-retry', 'next');
        assert.equal(after.current?.key, before.ahead[1]!.key);

        before = after;
        let releaseFailure!: () => void, requestStarted!: () => void;
        const holdFailure = new Promise<void>(resolve => { releaseFailure = resolve; });
        const pendingRequest = new Promise<void>(resolve => { requestStarted = resolve; });
        await page.route('**/api/ticker/next', async route => {
          requestStarted(); await holdFailure;
          await route.fulfill({status: 503, json: {error: 'Invented pending save failure'}});
        }, {times: 1});
        const pendingReply = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ticker/next');
        await page.locator('#tk-next').click(); await pendingRequest;
        assert.equal(await page.locator('#tk-next').getAttribute('aria-disabled'), 'true');
        try { await sheet(page); } finally { releaseFailure(); }
        assert.equal((await pendingReply).status(), 503);
        await page.locator('#tk-sheet-retry').waitFor({state: 'visible'});
        assert.match(await page.locator('#tk-sheet-status').textContent() ?? '', /Not saved\. Try again\./);
        assert.equal((await read()).current?.key, before.current?.key, 'a pending failed save leaves persisted dates alone');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'tk-sheet-retry');
        await tapSizes(page.locator('#tk-dialog'), `pending Next failure at ${width}px`);
        const retried = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ticker/next');
        await page.locator('#tk-sheet-retry').click();
        const retryReply = await retried; assert.equal(retryReply.status(), 200);
        after = await retryReply.json() as TickerSnapshot;
        await currentShown(page, after);
        assert.equal(after.current?.key, before.ahead[1]!.key);
        assert.ok((await page.locator('#tk-sheet-status').textContent())?.includes(`Next up: ${after.current!.name},`),
          'a save retried from the sheet announces its result inside the modal');
        assert.equal(await page.locator('#tk-status').textContent(), '');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'tk-close', 'retry keeps focus in the active modal');
        await closeSheet(page);
        await clean();

        const empty: TickerSnapshot = {mode: 'live', current: null, then: [], ahead: [], passed: []};
        await page.route('**/api/ticker', route => route.fulfill({json: empty}));
        await page.reload(); await currentShown(page, empty);
        assert.match(await page.locator('#tk-band').innerText(), /Nothing ahead/);
        assert.equal(await page.locator('#tk-next').isVisible(), false);
        assert.equal(await page.locator('#tk-add-date').getAttribute('href'), '/settings#keyDates');
        await tapSizes(page.locator('#tk-strip'), `empty at ${width}px`);
        await sheet(page); assert.match(await page.locator('#tk-dialog').innerText(), /Nothing ahead/); await closeSheet(page);
        await page.unroute('**/api/ticker');
        const live = {...await read(), mode: 'live' as const};
        await page.route('**/api/ticker', route => route.fulfill({json: live}));
        await page.reload(); await currentShown(page, live);
        await page.locator('[data-st="soon"]').click();
        assert.equal(await page.locator('[data-tk-home-dates] [data-mode="sample"]').count(), 0, 'live dates never carry a sample marker');
        await page.unroute('**/api/ticker');
        await page.route('**/api/ticker', route => route.fulfill({status: 503, json: {error: 'Invented read failure'}}));
        await page.reload();
        await page.waitForFunction(() => /Unavailable|Could not|couldn.t|not available/i.test(document.querySelector('#tk-strip')?.textContent ?? ''));
        assert.equal(await page.locator('#tk-next').isVisible(), false);
        assert.equal((await page.locator('#tk-strip').boundingBox())!.height, width === 390 ? 44 : 40);
        if (process.env.PULSE_SCREENSHOT_DIR) {
          await page.unroute('**/api/ticker'); await page.reload(); await currentShown(page, await read());
          await page.screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/ticker-${width}.png`});
          await sheet(page); await page.screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/ticker-sheet-${width}.png`});
        }
      } finally { await page.close(); await clean(); }
    }
    const unsigned = await browser.newContext({baseURL: origin});
    try {
      const login = await unsigned.newPage(); await login.goto('/login');
      assert.equal(await login.locator('#tk-strip').count(), 0);
      assert.equal(await login.locator('[src="/assets/ticker.js"], [href="/assets/ticker.css"]').count(), 0);
    } finally { await unsigned.close(); }
    assert.deepEqual(errors, []);
    assert.equal(externalRequests, 0);
    console.log('Ticker checks passed: all signed-in shells, fixed heights, modal focus, persisted Next/Undo/Put back, reduced motion, unavailable and empty states.');
  } finally { await clean(); await context.close(); }
}
