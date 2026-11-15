import assert from 'node:assert/strict';
import type { BrowserContext, Page } from 'playwright';
import { handoverPage } from '../src/handover/view.js';
import { waitingSectionHtml } from '../src/waiting-on/view.js';
import type { WaitingView } from '../src/waiting-on/model.js';
import { assertHandoverLayout } from './browser-handover-base.js';
import { tapArea } from './tap-area.js';

function fixture(): WaitingView {
  return {mode: 'live', status: 'ready', updatedLabel: '2032-04-09 09:30 UK', readAt: '2032-04-09T08:31:00.000Z',
    asOf: '2032-04-09T09:00:00.000Z', malformedRows: 1, cappedRows: 0, thresholdDays: 7,
    rows: [{id: 'hq:invented-first', source: 'hq', contact: 'A supplier', subject: 'An invented delivery update', since: '2032-04-01', days: 8},
      {id: 'manual:invented-second', source: 'manual', contact: 'A studio', subject: 'An invented sample update', since: '2032-04-07', days: 2}], done: []};
}
const pageHtml = (view: WaitingView): string => handoverPage([{id: 'waiting-on', title: 'Waiting on others', html: waitingSectionHtml(view), available: true}]);

async function checkErrors(context: BrowserContext, origin: string): Promise<{expectBadRequest: (url: string) => void; assertClear: () => void}> {
  const scriptErrors: string[] = [], consoleErrors: string[] = [], expected: string[] = [];
  let unexpectedRequests = 0, injected = 0, consumed = 0;
  context.on('page', page => {
    page.on('pageerror', error => scriptErrors.push(error.name));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const index = expected.indexOf(message.location().url);
      if (index >= 0 && /^Failed to load resource: the server responded with a status of 400 \([^)]*\)$/.test(message.text())) {
        expected.splice(index, 1); consumed++; return;
      }
      consoleErrors.push('Unexpected waiting browser console error');
    });
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    // Local mutation fixtures are fulfilled by page routes before this guard.
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
      unexpectedRequests++; await route.abort('blockedbyclient');
    } else await route.continue();
  });
  return {
    expectBadRequest: url => {expected.push(url); injected++;},
    assertClear: () => {
      assert.deepEqual(scriptErrors, []); assert.deepEqual(consoleErrors, []);
      assert.equal(unexpectedRequests, 0); assert.deepEqual(expected, [], 'Each deliberate HTTP 400 console error is consumed exactly once');
      assert.equal(consumed, injected);
    },
  };
}

async function pull(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const touch = await page.context().newCDPSession(page);
  try {
    await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 190, y: 12, id: 1}]});
    for (const y of [32, 52, 72, 92, 112, 132, 152]) await touch.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: 190, y, id: 1}]});
    await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  } finally {await touch.detach();}
}

async function checkRefreshDrafts(context: BrowserContext, origin: string): Promise<void> {
  const browser = context.browser(); assert.ok(browser);
  const mobile = await browser.newContext({baseURL: origin, viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, reducedMotion: 'reduce'});
  await mobile.addCookies(await context.cookies());
  const errors = await checkErrors(mobile, origin);
  await mobile.addInitScript("Object.defineProperty(navigator, 'standalone', {value: true});");
  const page = await mobile.newPage();
  let reads = 0, requested!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => {requested = resolve;}), allowed = new Promise<void>(resolve => {release = resolve;});
  try {
    await page.route('**/handover', async route => {
      reads++;
      if (reads > 1) {requested(); await allowed;}
      await route.fulfill({contentType: 'text/html', body: pageHtml(fixture())});
    });
    await page.goto('/handover'); await page.locator('#pull-refresh').waitFor({state: 'attached'});
    await page.locator('.waiting-add > summary').click();
    await page.locator('#waiting-contact').fill('A supplier');
    await pull(page);
    await page.waitForFunction(() => document.querySelector('#handover-message')?.textContent === 'Save or clear the waiting item first.');
    assert.equal(reads, 1, 'An existing draft blocks the refresh read');
    await page.locator('#waiting-add-form button[type="reset"]').click();
    let navigations = 0; page.on('framenavigated', () => {navigations++;});
    await pull(page); await reached;
    await page.locator('#waiting-contact').fill('Another supplier');
    release();
    await page.locator('#pull-refresh').waitFor({state: 'hidden'});
    assert.equal(navigations, 0, 'A draft typed during the refresh read blocks navigation');
    assert.equal(await page.locator('#waiting-contact').inputValue(), 'Another supplier');
    assert.match(await page.locator('#handover-message').innerText(), /Save or clear the waiting item first/);
    errors.assertClear();
  } finally {release(); await mobile.close();}
}

export async function checkWaitingOn(signedIn: BrowserContext): Promise<void> {
  const response = await signedIn.request.get('/handover'); assert.equal(response.status(), 200);
  const origin = new URL(response.url()).origin, browser = signedIn.browser(); assert.ok(browser);
  const context = await browser.newContext({baseURL: origin, storageState: await signedIn.storageState(), reducedMotion: 'reduce'});
  const errors = await checkErrors(context, origin);
  const page = await context.newPage();
  let view = fixture(), failed = false, hideResult = false, holdNext = false, release!: () => void, received!: () => void;
  let requests = 0, added = 0;
  try {
    await page.goto('/handover');
    await page.getByRole('heading', {name: 'Waiting on others', exact: true}).waitFor();
    for (const width of [360, 390]) {
      await page.setViewportSize({width, height: 900}); await page.goto('/sources');
      const summary = page.locator('[data-waiting-read-health] > summary');
      await summary.scrollIntoViewIfNeeded();
      const area = await tapArea(summary);
      assert.ok(area.width >= 44 && area.height >= 44 && area.edges, `${width}px waiting-file read details retain a 44px tap`);
      await summary.click();
      assert.equal(await summary.evaluate(element => element.parentElement?.hasAttribute('open')), true);
    }
    await page.route('**/handover', route => route.fulfill({contentType: 'text/html', body: pageHtml(view)}));
    await page.route('**/api/waiting-on/*', async route => {
      requests++; assert.equal(route.request().method(), 'POST');
      const action = new URL(route.request().url()).pathname.split('/').at(-1);
      const body = route.request().postDataJSON() as Record<string, string>;
      if (failed) {
        failed = false; errors.expectBadRequest(route.request().url());
        await route.fulfill({status: 400, json: {error: 'Invented save refusal.'}}); return;
      }
      if (holdNext) {holdNext = false; received(); await new Promise<void>(resolve => {release = resolve;});}
      if (action === 'add') {
        assert.deepEqual(Object.keys(body).sort(), ['contact', 'since', 'subject']);
        view.rows.push({id: `manual:invented-added-${++added}`, source: 'manual', contact: body.contact!, subject: body.subject!, since: body.since!, days: 4});
      } else {
        assert.deepEqual(Object.keys(body), ['id']);
        if (action === 'done') {
          const row = view.rows.find(item => item.id === body.id)!; assert.ok(row);
          view.rows = view.rows.filter(item => item.id !== row.id);
          view.done.push({...row, doneAt: view.asOf, returnsOn: '2032-05-09'});
        } else {
          assert.equal(action, 'restore');
          const row = view.done.find(item => item.id === body.id)!; assert.ok(row);
          view.done = view.done.filter(item => item.id !== row.id); view.rows.push(row);
        }
      }
      view.rows.sort((left, right) => left.since.localeCompare(right.since) || left.id.localeCompare(right.id));
      await route.fulfill({json: {saved: true, view: hideResult ? null : view, ...(hideResult ? {message: 'Saved. Refresh to see the waiting items.'} : {})}});
      hideResult = false;
    });
    for (const width of [360, 390, 1280]) {
      view = fixture();
      await page.setViewportSize({width, height: 900}); await page.goto('/handover');
      assert.match(await page.locator('[data-waiting-diagnostics]').innerText(), /1 malformed row skipped/);
      assert.equal(await page.locator('[data-waiting-item]').count(), 2);
      assert.equal(await page.locator('[data-waiting-item]').first().getAttribute('data-waiting-item'), 'hq:invented-first');
      await page.locator('.waiting-add > summary').click();
      for (const input of await page.locator('#waiting-add-form input').all()) {
        const box = (await input.boundingBox())!; assert.ok(box.width >= 44 && box.height >= 44);
      }
      await page.locator('#waiting-contact').fill('A supplier');
      await page.locator('[data-waiting-item]').first().getByRole('button', {name: 'Done'}).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-waiting-item]').length === 1);
      assert.equal(await page.locator('#waiting-contact').inputValue(), 'A supplier', 'Done preserves the manual draft');
      await page.locator('#waiting-message').getByRole('button', {name: 'Put back'}).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-waiting-item]').length === 2);
      assert.equal(await page.locator('#waiting-contact').inputValue(), 'A supplier');
      await page.locator('#waiting-subject').fill('An invented sample update');
      await page.locator('#waiting-since').fill('2032-04-05');
      await page.locator('#waiting-add-form button[type="submit"]').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-waiting-item]').length === 3);
      assert.equal(await page.locator('#waiting-contact').inputValue(), '');
      assert.equal(await page.locator('#waiting-subject').inputValue(), '');
      failed = true;
      await page.locator('#waiting-contact').fill('Another supplier');
      await page.locator('#waiting-subject').fill('Another invented update');
      await page.locator('#waiting-add-form button[type="submit"]').click();
      await page.waitForFunction(() => document.querySelector('#waiting-message')?.textContent === '△ Not saved · Invented save refusal.');
      assert.equal(await page.locator('#waiting-contact').inputValue(), 'Another supplier');
      assert.equal(await page.locator('[data-waiting-item]').count(), 3);
      await page.evaluate(() => window.scrollTo(0, 0));
      await assertHandoverLayout(page, width);
      if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/waiting-on-${width}.png`, fullPage: true});
    }
    const reached = new Promise<void>(resolve => {received = resolve;}); holdNext = true;
    const before = requests;
    await page.locator('#waiting-add-form button[type="submit"]').click(); await reached;
    assert.equal(await page.locator('#waiting-add-form button[type="submit"]').isDisabled(), true);
    await page.locator('#waiting-subject').fill('A newer draft typed during the save');
    release();
    await page.waitForFunction(() => document.querySelector('#waiting-message')?.textContent === '✓ Saved here.');
    assert.equal(await page.locator('#waiting-subject').inputValue(), 'A newer draft typed during the save');
    assert.equal(requests, before + 1, 'One local request runs at a time and nothing is retried automatically');
    hideResult = true;
    await page.locator('#waiting-add-form button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('#waiting-message')?.textContent === '✓ Saved. Refresh to see the waiting items.');
    assert.equal(await page.locator('#waiting-contact').inputValue(), '', 'A confirmed save can clear an unchanged draft even if its follow-up read failed');
    await checkRefreshDrafts(context, origin);
    errors.assertClear();
  } finally {release?.(); await context.close();}
}
