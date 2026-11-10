import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { BrowserContext, Page } from 'playwright';
import type { DashboardSnapshot } from '../src/dashboard-types.js';
import { dashboardPage } from '../src/dashboard-view.js';
import type { HQFacts } from '../src/github-hq/model.js';
import { parseRegister } from '../src/github-hq/parse-register.js';
import { homeTestsFromHq } from '../src/github-hq/presentation.js';
import type { MorningSnapshot, MorningState } from '../src/morning/model-types.js';
import { morningDay } from '../src/morning/view.js';

async function sampleTests(page: Page, width: number): Promise<void> {
  const chapter = page.locator('#tests');
  assert.equal(await chapter.locator('.chapter-number').innerText(), '3');
  assert.equal((await chapter.locator('.chapter-eyebrow').textContent())?.trim(), 'Experiments');
  assert.equal(await chapter.locator('#tests-title').innerText(), 'Tests');
  assert.equal(await chapter.locator('.tcard').count(), 1);
  assert.equal(await chapter.locator('.trow').count(), 9);
  assert.equal(await chapter.locator('.trow[data-mode="sample"]').count(), 9);
  assert.deepEqual(await chapter.locator('[data-model-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-model-id'))),
    ['w006', 'w007', 'w008', 'w014', 'w015', 'w009', 'w010', 'w011', 'w012', 'w013', 'w016']);
  assert.equal(await chapter.locator('.test-more summary').innerText(), '+6 more');
  assert.equal(await chapter.locator('.test-more').getAttribute('open'), null);
  const call = chapter.locator('[data-call]');
  assert.equal(await call.count(), 1); assert.equal(await call.isDisabled(), true);
  assert.equal(await call.getAttribute('aria-label'), 'Call · Not built yet');
  assert.equal(await chapter.locator('[data-hq-test-open],[data-hq-test-call]').count(), 0);
  // These are the existing Tests chapter budgets; the live integration must not raise them.
  const height = (await chapter.boundingBox())!.height;
  assert.ok(height <= (width === 390 ? 680 : 380), `${width}: sample Tests height ${height} stays within its existing budget`);
  const shown = [];
  for (const control of await chapter.locator('button,a,summary').all()) if (await control.isVisible()) shown.push(control);
  assert.ok(shown.length <= 6, 'Sample Tests keeps its existing visible-control budget');
  for (const control of shown) assert.ok((await control.boundingBox())!.height >= 44, 'Sample Tests controls retain 44px taps');
}

async function liveTests(page: Page, dashboard: DashboardSnapshot, morning: MorningSnapshot): Promise<void> {
  const now = new Date('2032-04-20T12:00:00Z');
  const parsed = parseRegister(await readFile(new URL('../test/fixtures/github-hq/register.md', import.meta.url), 'utf8'));
  const facts: HQFacts = {sourceMode: 'live', report: null, registerReadAt: now.toISOString(), registerReadOk: true,
    registerSkippedRows: parsed.skippedRows, monthReadAt: null,
    tests: parsed.rows.map(row => ({...row, firstSeenAt: now.toISOString(), sectionFirstSeenAt: now.toISOString(), initiallySeen: true}))};
  const tests = homeTestsFromHq(facts, [], now), first = tests.rows.find(row => row.id === 'T1')!;
  assert.equal(first.call?.answer, 'b'); const call = first.call!;
  let fixture: DashboardSnapshot = {...dashboard, tests}, rejectNext = true;
  const presses: object[] = [];
  await page.route('**/api/dashboard', route => route.fulfill({json: fixture}));
  await page.route('**/api/events', route => route.fulfill({contentType: 'text/event-stream', body: `retry: 60000\nevent: dashboard\ndata: ${JSON.stringify(fixture)}\n\n`}));
  await page.route('**/', route => route.fulfill({contentType: 'text/html', body: dashboardPage(fixture)}));
  await page.route('**/api/morning/press', async route => {
    const body = route.request().postDataJSON() as {cardKey: string; action: string; answer?: string}; presses.push(body);
    if (rejectNext) { rejectNext = false; await route.fulfill({status: 409, json: {error: 'Invented changed call.'}}); return; }
    const called: MorningState = {mode: 'live', cardKey: call.cardKey, state: 'answered', untilDay: null, factsHash: 'invented-browser-call',
      answer: call.answer, credentialId: 'invented-browser-device', pressedAt: now.toISOString(), clearedAt: null,
      title: first.title, kind: 'test-call', subjectId: first.id, sourceScope: 'tests'};
    fixture = {...fixture, tests: body.action === 'undo' ? tests : {...tests, rows: tests.rows.map(row => row.id !== first.id ? row : {...row,
      call: null, called: {cardKey: call.cardKey, answer: call.answer}, status: 'Called B · waiting for the write-up'})}};
    await route.fulfill({json: {...morning, mode: 'live', answers: body.action === 'undo' ? [] : [called]}});
  });
  await page.goto('/'); await page.locator('html[data-dashboard-ready="true"]').waitFor();
  await page.locator('#tests[data-hq-tests="live"]').waitFor();
  assert.equal(await page.locator('#tests .tcard[data-hq-test-id="T1"]').count(), 1);
  assert.deepEqual(await page.locator('#tests .trow').evaluateAll(rows => rows.map(row => row.getAttribute('data-hq-test-id'))), ['T2', 'T3', 'Q1', 'H1', 'H2']);
  assert.equal(await page.locator('#tests .test-more summary').innerText(), '+2 more');
  assert.equal(await page.locator('#tests [data-hq-test-call="T2"]').isDisabled(), true, 'Malformed readings cannot enable Call');
  assert.equal(await page.locator('#tests [data-hq-test-call="T3"]').isDisabled(), true);
  if (process.env.PULSE_SCREENSHOT_DIR) {
    await page.locator('#tests').scrollIntoViewIfNeeded();
    await page.screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/hq-live-home-${page.viewportSize()!.width}.png`});
    await page.locator('#tests').screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/hq-live-tests-${page.viewportSize()!.width}.png`});
  }
  const open = page.locator('#tests [data-hq-test-open="T1"]'), action = page.locator('#tests [data-hq-test-call="T1"]');
  await open.click(); await page.locator('#hq-tests-dialog').waitFor({state: 'visible'});
  assert.equal(await page.locator('#hq-tests-dialog').evaluate(element => element.matches(':modal')), true);
  assert.match(await page.locator('#hq-tests-body').innerText(), /Reading 2032-04-20/);
  await page.keyboard.press('Escape'); await page.locator('#hq-tests-dialog').waitFor({state: 'hidden'});
  assert.equal(await open.evaluate(element => document.activeElement === element), true);
  await action.click(); await page.locator('#hq-tests-confirm').waitFor({state: 'visible'});
  assert.equal(presses.length, 0, 'Opening confirmation cannot write an answer');
  await page.locator('#hq-tests-cancel').click(); assert.equal(presses.length, 0);
  await action.click(); await page.locator('#hq-tests-confirm').click();
  await page.waitForFunction(() => document.querySelector('#hq-tests-status')?.textContent?.includes('changed'));
  assert.deepEqual(presses, [{cardKey: call.cardKey, action: 'call', answer: 'b'}]);
  await page.locator('#hq-tests-cancel').click();
  await action.click(); await page.locator('#hq-tests-confirm').click();
  await page.waitForFunction(() => document.querySelector('#tests [data-hq-test-id="T1"]')?.textContent?.includes('Called B · waiting for the write-up'));
  await page.locator('#hq-tests-dialog').waitFor({state: 'hidden'});
  const undo = page.locator('#tests [data-hq-test-undo="T1"]'); await undo.waitFor();
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#tests')), true, 'A completed call keeps keyboard focus in Tests');
  await undo.click(); await page.locator('#tests [data-hq-test-call="T1"]').waitFor();
  await page.waitForFunction(() => !!document.querySelector<HTMLButtonElement>('#tests [data-hq-test-call="T1"]') && !document.querySelector<HTMLButtonElement>('#tests [data-hq-test-call="T1"]')!.disabled);
  assert.deepEqual(presses, [{cardKey: call.cardKey, action: 'call', answer: 'b'}, {cardKey: call.cardKey, action: 'call', answer: 'b'}, {cardKey: call.cardKey, action: 'undo'}]);
  await page.waitForFunction(() => !!document.activeElement?.closest('#tests'));
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#tests')), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}

/** HQ checks run after existing audit assertions and leave local and source data untouched. */
export async function checkHQ(signedIn: BrowserContext): Promise<void> {
  const response = await signedIn.request.get('/api/morning'); assert.equal(response.status(), 200);
  const actual = await response.json() as MorningSnapshot, origin = new URL(response.url()).origin;
  const dashboardResponse = await signedIn.request.get('/api/dashboard'); assert.equal(dashboardResponse.status(), 200);
  const dashboard = await dashboardResponse.json() as DashboardSnapshot;
  assert.equal(actual.mode, 'sample');
  const brief = actual.brief;
  assert.ok(brief, 'Sample Morning includes an invented HQ entry'); assert.equal(brief.mode, 'sample');
  assert.ok(brief.day && brief.runLabel && brief.items?.length && brief.href, 'The sample entry includes its report and source details');
  const context = await signedIn.browser()!.newContext({baseURL: origin, storageState: await signedIn.storageState()});
  const errors: string[] = [], unexpectedWrites: string[] = [];
  let external = 0;
  context.on('page', page => page.on('pageerror', error => errors.push(error.name)));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { external++; await route.abort('blockedbyclient'); }
    else if (!['GET', 'HEAD'].includes(request.method())) { unexpectedWrites.push(`${request.method()} ${url.pathname}`); await route.abort('blockedbyclient'); }
    else await route.continue();
  });
  try {
    for (const width of [390, 1280]) {
      const page = await context.newPage(); await page.setViewportSize({width, height: width === 390 ? 844 : 960});
      let releaseRead: (() => void) | undefined;
      try {
        await page.goto('/?from=morning'); await page.locator('html[data-dashboard-ready="true"]').waitFor();
        await page.evaluate(async () => { await document.fonts.ready; });
        await sampleTests(page, width);

        const heldRead = new Promise<void>(resolve => { releaseRead = resolve; });
        await page.route('**/api/morning', async route => { await heldRead; await route.fulfill({json: actual}); }, {times: 1});
        const startedRead = page.waitForRequest(request => new URL(request.url()).pathname === '/api/morning' && request.method() === 'GET');
        await page.goto('/morning'); await page.locator('#mn-root[data-mn-ready="true"]').waitFor(); await startedRead;
        const line = page.locator('#mn-brief'); await line.waitFor();
        const originalLine = await line.elementHandle(); assert.ok(originalLine);
        assert.match(await line.innerText(), /Morning check/); assert.match(await line.innerText(), /Sample data/i);
        assert.ok((await line.innerText()).includes(brief.text));
        assert.equal(await line.getAttribute('data-mn-brief'), brief.status);
        assert.equal(await line.evaluate(element => element.closest('#mn-card') === null), true, 'The HQ report is a slim line, not another card');
        const lineBox = (await line.boundingBox())!, goodBox = (await page.locator('#mn-good').boundingBox())!;
        assert.ok(lineBox.y >= goodBox.y + goodBox.height, 'The brief stays below the green line');
        assert.ok(lineBox.height >= 44);
        await line.click(); await page.locator('#mn-dialog').waitFor({state: 'visible'});
        assert.equal(await page.locator('#mn-dialog').evaluate(element => element.matches(':modal')), true);
        const sheet = await page.locator('#mn-sheet-body').innerText();
        assert.ok(sheet.includes(morningDay(brief.day))); assert.ok(sheet.includes(brief.runLabel));
        assert.ok(sheet.includes(String(brief.count))); assert.ok(sheet.includes('△ Watch'));
        for (const item of brief.items) assert.ok(sheet.includes(item.text));
        assert.equal(await page.locator('#mn-sheet-body a.mn-sheet-link').getAttribute('href'), brief.href);
        assert.match(brief.href, /\/ops\/ads-daily\/\d{4}-\d{2}\.md$/);
        assert.ok((await page.locator('#mn-close').boundingBox())!.height >= 44);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/hq-sample-brief-${width}.png`});
        const finishedRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/morning');
        assert.ok(releaseRead); releaseRead(); await finishedRead;
        await page.waitForFunction(element => !element.isConnected, originalLine);
        await page.keyboard.press('Escape'); await page.locator('#mn-dialog').waitFor({state: 'hidden'});
        await page.waitForFunction(() => document.activeElement?.id === 'mn-brief');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'mn-brief');
        await originalLine.dispose();
        await liveTests(page, dashboard, actual);
      } finally { releaseRead?.(); await page.close(); }
    }
    assert.deepEqual(errors, []); assert.deepEqual(unexpectedWrites, []); assert.equal(external, 0);
    console.log('HQ browser checks passed: sample brief, unchanged sample Tests, live register rows and confirmed local Call/error/Undo at 390 and 1280.');
  } finally { await context.close(); }
}
