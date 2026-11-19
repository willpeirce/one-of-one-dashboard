import assert from 'node:assert/strict';
import type {BrowserContext, Page} from 'playwright';
import {handoverPage} from '../src/handover/view.js';
import {buildIssuesView, type IssueInputs, type IssuesView} from '../src/issues/model.js';
import {buildIssueCosts} from '../src/issues/costs.js';
import {buildIssueCasesPage} from '../src/issues/routes.js';
import {issuesSectionHtml} from '../src/issues/view.js';
import {ISSUE_REASONS, type IssueReason} from '../src/issues/taxonomy.js';
import type {IssueCasesPage} from '../src/issues/presentation-types.js';
import {defaultSettings} from '../src/settings.js';
import {assertHandoverLayout} from './browser-handover-base.js';
import {checkIssueSettings} from './browser-issue-settings.js';

const now = new Date('2032-04-07T12:00:00Z');
const identityCanary = 'Never render this invented reviewer identity';
const reason = 'missing item';

function liveInputs(): IssueInputs {
  const reviews = Array.from({length: 65}, (_, index) => ({id: `invented-review-${index}`, rating: 2,
    body: `${index === 0 ? '<script>window.__inventedIssues=1</script> ' : ''}Missing item for order #${45000 + index}. ${'An invented observation. '.repeat(8)}`,
    createdAt: '2032-04-07T06:00:00Z', reviewerName: identityCanary}));
  reviews.push({id: 'invented-review-previous', rating: 3, body: 'Missing item for order #46000.',
    createdAt: '2032-03-07T06:00:00Z', reviewerName: identityCanary});
  return {dashboardMode: 'live', reviews: {mode: 'live', status: 'ready', checkedAt: now.toISOString(), rows: reviews},
    tickets: {mode: 'live', status: 'ready', checkedAt: now.toISOString(), domain: 'invented-helpdesk',
      rows: [{id: '95001', subject: 'Missing item for order #45000.', tags: [], createdAt: '2032-04-07T07:00:00Z'}]}};
}
function fixtureHtml(view: IssuesView): string {
  const costs = buildIssueCosts({mode: 'sample', records: [], jobs: []}, [], [], defaultSettings(), now, view.mode);
  return handoverPage([
    {id: 'customer-service', title: 'Customer service', html: '<p class="handover-context">ⓘ No cases in this fixture section.</p>', available: true},
    {id: 'waiting-on', title: 'Waiting on others', html: '<p class="handover-context">ⓘ No cases in this fixture section.</p>', available: true},
    {id: 'issues', title: 'Issues', html: issuesSectionHtml(view, costs), available: true},
  ]);
}
async function privacyAndLayout(page: Page, width: number): Promise<void> {
  await page.evaluate(() => window.scrollTo({top: 0, behavior: 'instant'}));
  await assertHandoverLayout(page, width);
  const html = await page.content();
  assert.equal(html.includes(identityCanary), false);
  assert.doesNotMatch(html, /reviewerName|reviewer_name|customerEmail/);
  assert.equal(await page.locator('#issues-sheet script').count(), 0);
  assert.equal(await page.evaluate(() => Object.hasOwn(window, '__inventedIssues')), false);
  for (const quote of await page.locator('[data-issue-quote]').allTextContents()) assert.ok(Array.from(quote).length <= 120);
}

export async function checkIssues(context: BrowserContext): Promise<void> {
  await checkIssueSettings(context);
  const sampleResponse = await context.request.get('/api/issues/scratched%20slab'); assert.equal(sampleResponse.status(), 200);
  const sample = await sampleResponse.json() as IssueCasesPage;
  assert.equal(sample.mode, 'sample'); assert.ok(sample.total > 0);
  const intentResponse = await context.request.get('/api/issues/missing%20item'); assert.equal(intentResponse.status(), 200);
  const intentSample = await intentResponse.json() as IssueCasesPage;
  assert.equal(intentSample.mode, 'sample'); assert.equal(intentSample.total, 1);
  assert.equal(intentSample.cases[0]!.id, 'gorgias:81002');
  const page = await context.newPage();
  try {
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({width, height: 900}); await page.emulateMedia({colorScheme: 'light', reducedMotion: 'reduce'});
      await page.goto('/handover');
      const section = page.locator('#handover-issues'); await section.waitFor();
      assert.deepEqual(await page.locator('[data-handover-section]').evaluateAll(rows => rows.map(row => row.getAttribute('data-handover-section'))),
        ['customer-service', 'waiting-on', 'issues']);
      assert.equal(await section.locator('.chapter-number').innerText(), '3');
      assert.equal(await section.locator('[data-issues-root]').getAttribute('data-mode'), 'sample');
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      assert.match(await section.innerText(), /Sample data · invented cases and counts/);
      assert.match(await section.innerText(), /Questions and requests left out, not problems: 1 this month, 0 last month\./);
      assert.deepEqual(await section.locator('[data-issue-reason]').evaluateAll(rows => rows.map(row => row.getAttribute('data-issue-reason'))), [...ISSUE_REASONS]);
      assert.match(await section.locator('[data-issues-costs]').innerText(), /Cost of fixes.*This month.*Last month/s);
      assert.equal(await section.locator('[data-issues-cost]').count(), 2);
      const open = section.locator('[data-issue-reason="scratched slab"]'), row = open.locator('xpath=ancestor::tr');
      assert.equal(await row.locator('[data-issue-current]').innerText(), String(sample.current));
      assert.equal(await row.locator('[data-issue-previous]').innerText(), String(sample.previous));
      await privacyAndLayout(page, width);
      if (process.env.PULSE_SCREENSHOT_DIR && width !== 360) await page.screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/issues-${width}.png`, fullPage: true});
      await open.click(); await page.locator('#issues-sheet[open] [data-issue-case]').first().waitFor();
      assert.equal(await page.locator('#issues-sheet-title').innerText(), 'Scratched slab');
      assert.equal(await page.locator('[data-issue-case]').count(), sample.cases.length);
      assert.match(await page.locator('#issues-sheet-body').innerText(), /Sample data · invented cases/);
      assert.equal(await page.locator('[data-issue-ticket]').count(), 0, 'Sample cases never link to a live ticket');
      await privacyAndLayout(page, width);
      await page.keyboard.press('Escape'); await page.locator('#issues-sheet').waitFor({state: 'hidden'});
      assert.equal(await open.evaluate(element => document.activeElement === element), true, 'Closing cases restores the reason button focus');
      const intentOpen = section.locator('[data-issue-reason="missing item"]');
      assert.equal(await intentOpen.locator('xpath=ancestor::tr').locator('[data-issue-current]').innerText(), '1');
      await intentOpen.click(); await page.locator('#issues-sheet[open] [data-issue-case="gorgias:81002"]').waitFor();
      assert.equal(await page.locator('#issues-sheet-title').innerText(), 'Missing item');
      assert.equal(await page.locator('[data-issue-case]').count(), 1, 'The generic sample message becomes one case through its intent');
      assert.deepEqual(await page.locator('[data-issue-case="gorgias:81002"] .issues-case-source').allTextContents(),
        ['ⓘ Gorgias ticket', 'ⓘ Sample ticket · no live link']);
      assert.equal(await page.locator('[data-issue-quote]').count(), 0); assert.equal(await page.locator('[data-issue-ticket]').count(), 0);
      await privacyAndLayout(page, width);
      await page.keyboard.press('Escape'); await page.locator('#issues-sheet').waitFor({state: 'hidden'});
      assert.equal(await intentOpen.evaluate(element => document.activeElement === element), true);
    }

    let inputs = liveInputs(), view = buildIssuesView(inputs, [], now);
    const offsets: number[] = [];
    let responseMismatch: 'mode' | 'month' | null = null;
    await page.route('**/handover', route => route.fulfill({contentType: 'text/html', body: fixtureHtml(view)}));
    await page.route(url => url.pathname.startsWith('/api/issues/'), route => {
      const url = new URL(route.request().url()), selected = decodeURIComponent(url.pathname.slice('/api/issues/'.length)) as IssueReason;
      const offset = Number(url.searchParams.get('offset') ?? 0), payload = buildIssueCasesPage(view, selected, offset);
      assert.ok(payload); if (url.searchParams.has('version')) assert.equal(url.searchParams.get('version'), payload.version);
      offsets.push(offset);
      return route.fulfill({json: responseMismatch === 'mode' ? {...payload, mode: 'sample'}
        : responseMismatch === 'month' ? {...payload, thisMonth: '2032-05'} : payload});
    });
    await page.setViewportSize({width: 390, height: 900}); await page.goto('/handover');
    assert.equal(await page.locator('[data-issues-root]').getAttribute('data-mode'), 'live');
    assert.equal(await page.locator('#handover-issues .sample-banner').count(), 0);
    assert.equal(await page.locator('[data-issues-cost]').count(), 0, 'Sample replacement costs stay out of a live Issues section');
    assert.equal((await page.content()).includes('__inventedIssues'), false, 'Case text is not embedded in the initial page');
    const open = page.locator(`[data-issue-reason="${reason}"]`), row = open.locator('xpath=ancestor::tr');
    assert.equal(await row.locator('[data-issue-current]').innerText(), '65', 'A matching review and ticket count once');
    assert.equal(await row.locator('[data-issue-previous]').innerText(), '1');
    await open.click(); await page.locator('[data-issues-more]').waitFor();
    assert.equal(await page.locator('[data-issue-case]').count(), 50);
    assert.match(await page.locator('[data-issues-case-count]').innerText(), /50 of 66 cases shown/);
    const ticket = page.locator('[data-issue-ticket]');
    assert.equal(await ticket.getAttribute('href'), 'https://invented-helpdesk.gorgias.com/app/ticket/95001');
    assert.equal(await ticket.getAttribute('target'), '_blank'); assert.equal(await ticket.getAttribute('rel'), 'noopener noreferrer');
    assert.match(await page.locator('[data-issue-case="order:45000"] .issues-case-source').innerText(), /Review \+ Gorgias ticket/);
    assert.match(await page.locator('[data-issue-quote]').first().innerText(), /window\.__inventedIssues=1/);
    await privacyAndLayout(page, 390);
    await page.locator('[data-issues-more]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-issue-case]').length === 66);
    assert.deepEqual(offsets, [0, 50]); assert.equal(await page.locator('[data-issues-more]').count(), 0);
    assert.match(await page.locator('[data-issues-case-count]').innerText(), /66 of 66 cases shown/);
    assert.equal(await page.locator('[data-issues-close]').evaluate(element => document.activeElement === element), true,
      'The final case page restores focus to the remaining Close control');
    await privacyAndLayout(page, 390);
    await page.locator('[data-issues-close]').click();

    for (const mismatch of ['mode', 'month'] as const) {
      responseMismatch = mismatch;
      await open.click();
      await page.getByText('The source or month changed.', {exact: false}).waitFor();
      assert.equal(await page.locator('[data-issue-case]').count(), 0, 'A response from a different source mode or month never supplies cases');
      await page.locator('[data-issues-close]').click();
    }
    responseMismatch = null;

    inputs = liveInputs(); inputs.reviews.mode = 'sample';
    view = buildIssuesView(inputs, [], now); offsets.length = 0;
    await page.goto('/handover');
    assert.equal(await row.locator('[data-issue-current]').innerText(), '1', 'A live ticket excludes all sixty-five sample reviews');
    assert.equal(await row.locator('[data-issue-previous]').innerText(), '0');
    assert.match(await page.locator('#handover-issues').innerText(), /sample cases are excluded/);
    await open.click(); await page.locator('[data-issue-case]').waitFor();
    assert.equal(await page.locator('[data-issue-case]').count(), 1);
    assert.equal(await page.locator('[data-issue-quote]').count(), 0, 'No sample review quote enters a live case');
    assert.equal(await page.locator('[data-issue-ticket]').count(), 1);
    await privacyAndLayout(page, 390); await page.locator('[data-issues-close]').click();

    inputs.tickets.mode = 'sample'; view = buildIssuesView(inputs, [], now);
    await page.goto('/handover');
    assert.equal(await page.locator('#handover-issues .sample-banner').count(), 0);
    assert.match(await page.locator('#handover-issues').innerText(), /Waiting for the first Issues source reading/);
    assert.equal(await page.locator('[data-issue-reason]:enabled').count(), 0);
    assert.ok((await page.locator('[data-issue-current]').allTextContents()).every(value => value === '—'));
    assert.equal(await page.locator('[data-issue-case]').count(), 0);
    await privacyAndLayout(page, 390);
  } finally {await page.close();}
}
