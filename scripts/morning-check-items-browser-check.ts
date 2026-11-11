import assert from 'node:assert/strict';
import type { BrowserContext, Page } from 'playwright';
import type { HQBriefItem } from '../src/github-hq/model.js';
import { defaultSettings } from '../src/settings.js';
import { tickerState } from '../src/ticker/model.js';
import { sampleAdSetsView } from '../src/meta-adsets/presentation.js';
import { morningDeck } from '../src/morning/model.js';
import type { MorningCard, MorningInput, MorningSnapshot } from '../src/morning/model-types.js';
import { morningPage } from '../src/morning/view.js';

const now = new Date('2032-04-07T08:00:00Z');
const sourceHref = 'https://github.com/invented-workspace/invented-checks/blob/main/ops/ads-daily/2032-04.md';
function input(items: HQBriefItem[]): MorningInput {
  return {mode: 'live', needs: [], checks: [], creativeCards: [], ticker: tickerState([], [], now, 'live'), settings: defaultSettings(),
    activity: [], metaActions: [], sourceReadOk: {adsets: true, check: true, google: true},
    brief: {mode: 'live', status: 'needs', day: '2032-04-06', text: `Morning check · 07:41 · ${items.length} items`,
      runLabel: 'run · 07:41 · invented browser example', count: items.length, items, href: sourceHref}};
}
function item(index: number, decide = false): HQBriefItem {
  return {text: `Invented ${decide ? 'pause' : 'review'} item ${index + 1}`, label: decide ? 'Pause' : 'Review',
    lines: [`Invented first detail ${index + 1}`, `Invented second detail ${index + 1}`],
    ...(decide ? {tag: {type: 'pause' as const, adSetId: String(120000000000000100n + BigInt(index))}} : {})};
}
function storedSets(data: MorningInput, enabled = true): void {
  const base = sampleAdSetsView(data.settings);
  data.adSets = {...base, mode: 'live', today: '2032-04-07', actionsEnabled: enabled, rows: [], catalogue: [
    {id: '120000000000000001', name: 'Invented Active Fern', owner: 'ours', status: 'ACTIVE', effectiveStatus: 'ACTIVE', currency: 'GBP'},
    {id: '120000000000000002', name: 'Invented Paused Fern', owner: 'ours', status: 'PAUSED', effectiveStatus: 'PAUSED', currency: 'GBP'},
    {id: '120000000000000003', name: 'Invented Freelancer Fern', owner: 'freelancer', status: 'ACTIVE', effectiveStatus: 'ACTIVE', currency: 'GBP'},
    {id: '1200000000000000000000001', name: 'Invented Long ID Fern', owner: 'ours', status: 'ACTIVE', effectiveStatus: 'ACTIVE', currency: 'GBP'},
  ]};
}
async function ready(page: Page, snapshot: MorningSnapshot): Promise<void> {
  await page.waitForFunction(key => document.querySelector('#mn-root')?.getAttribute('data-mn-ready') === 'true'
    && document.querySelector('#mn-card')?.getAttribute('data-mn-card') === key, snapshot.cards[0]?.key);
}
async function close(page: Page, selector: string): Promise<void> {
  await page.keyboard.press('Escape'); await page.locator('#mn-dialog').waitFor({state: 'hidden'});
  await page.waitForFunction(expected => document.activeElement === document.querySelector(expected), selector);
}
async function fit(page: Page): Promise<void> {
  await page.evaluate(async () => {await document.fonts.ready; scrollTo(0, 0);});
  assert.equal(await page.locator('#mn-card').count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const selector of ['#mn-primary', '#mn-secondary', '#mn-menu', '#mn-good', '#mn-brief']) {
    const control = page.locator(selector); if (!await control.count()) continue;
    const box = await control.boundingBox(); assert.ok(box && box.width >= 44 && box.height >= 44 && box.y + box.height <= page.viewportSize()!.height + .5, `${selector} keeps its visible 44px tap`);
  }
  const footer = await page.locator('.mn-summary-lines').boundingBox(); assert.ok(footer && footer.height <= 100);
}
async function why(page: Page, card: MorningCard): Promise<void> {
  await page.locator('#mn-figure').click(); await page.locator('#mn-dialog').waitFor({state: 'visible'});
  const paragraph = page.locator('#mn-sheet-body section').filter({has: page.getByRole('heading', {name: 'Why', exact: true})}).locator('p');
  assert.equal(await paragraph.innerText(), card.why);
  assert.equal(await paragraph.evaluate(element => getComputedStyle(element).whiteSpace), 'pre-line');
  assert.ok((await page.locator('#mn-sheet-body').innerText()).includes(card.rule));
  assert.ok((await page.locator('#mn-sheet-body').innerText()).includes(card.sourceLine));
  assert.equal(await page.locator('#mn-sheet-body .mn-sheet-link').getAttribute('href'), card.sourceHref);
  await close(page, '#mn-figure');
}

/** Production projections with invented stored reads; only existing single-set actions are stubbed. */
export async function checkMorningCheckItems(signedIn: BrowserContext): Promise<void> {
  const response = await signedIn.request.get('/api/morning'); assert.equal(response.status(), 200);
  const actual = await response.json() as MorningSnapshot;
  assert.equal(actual.mode, 'sample'); assert.equal(actual.brief?.count, 3); assert.equal(actual.brief?.items?.length, 3);
  const sampleCards = actual.cards.filter(card => card.kind === 'check-item');
  assert.equal(sampleCards.length, 2); assert.equal(actual.datedFromCheck?.length, 1);
  assert.ok(sampleCards.some(card => card.state === 'decide' && card.primary.kind === 'save' && card.primary.action === 'ack'));
  assert.ok(sampleCards.some(card => card.state === 'warn'));
  assert.ok(sampleCards.every(card => ![card.primary, card.secondary, ...card.menu].some(button => button?.kind === 'live')));
  const origin = new URL(response.url()).origin;
  const context = await signedIn.browser()!.newContext({baseURL: origin, storageState: await signedIn.storageState(), reducedMotion: 'reduce'});
  const errors: string[] = [], unexpected: string[] = [], actions: {id: string; body: object}[] = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method()) && !url.pathname.startsWith('/api/meta/adset/')) {
      unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
    }
    return route.continue();
  });
  let data = input([item(0)]), snapshot = morningDeck(data, [], now).snapshot;
  const page = await context.newPage();
  await page.route(url => url.pathname === '/morning', route => route.fulfill({contentType: 'text/html', body: morningPage(snapshot)}));
  await page.route('**/api/morning', route => route.fulfill({json: snapshot}));
  await page.route('**/api/meta/adset/*', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!, body = route.request().postDataJSON();
    actions.push({id, body}); assert.equal(id, '120000000000000001'); assert.deepEqual(body, {action: 'pause', value: 'PAUSED'});
    return route.fulfill({status: 409, json: {error: 'Invented pause stopped before writing.'}});
  });
  const show = async (next: MorningSnapshot): Promise<void> => {snapshot = next; await page.goto('/morning'); await ready(page, snapshot);};
  const build = async (next: MorningInput): Promise<MorningSnapshot> => {data = next; const nextSnapshot = morningDeck(data, [], now).snapshot; await show(nextSnapshot); return nextSnapshot;};
  try {
    for (const viewport of [{width: 390, height: 844}, {width: 375, height: 667}, {width: 1280, height: 960}]) {
      await page.setViewportSize(viewport);
      for (const card of sampleCards) {await show({...actual, cards: [card]}); await fit(page); await why(page, card);}
      await page.locator('#mn-good').click(); await page.locator('#mn-dialog').waitFor({state: 'visible'});
      const fine = await page.locator('#mn-sheet-body').innerText();
      assert.ok(fine.indexOf('Dated, from the check') < fine.indexOf('Parked and hidden'));
      for (const row of actual.datedFromCheck ?? []) for (const line of [row.text, ...(row.lines ?? [])]) assert.ok(fine.includes(line));
      await close(page, '#mn-good');
      assert.doesNotMatch(await page.locator('#mn-brief').innerText(), /all in the deck/, 'A dated item is on the fine sheet, not in the deck');

      for (const [decisions, watches, offeredWatches, overflow] of [[8, 4, 3, 1], [2, 8, 5, 3]] as const) {
        const fixture = input(Array.from({length: decisions + watches}, (_, index) => item(index, index < decisions)));
        fixture.brief!.items!.at(-1)!.lines = Array.from({length: 8}, (_, index) => `Invented overflow detail ${index + 1} ${'x'.repeat(280)}`.slice(0, 300));
        fixture.brief!.malformedCardTags = 2;
        const projected = await build(fixture);
        assert.equal(projected.cards.filter(card => card.state === 'warn').length, offeredWatches);
        assert.equal(projected.cards.length, decisions + offeredWatches); assert.equal(projected.brief?.moreHere, overflow);
        assert.match(await page.locator('#mn-brief').innerText(), new RegExp(`· ${overflow} more here`)); await fit(page);
        await page.locator('#mn-brief').click(); await page.locator('#mn-dialog').waitFor({state: 'visible'});
        const text = await page.locator('#mn-sheet-body').innerText();
        for (const row of fixture.brief!.items!) for (const line of [row.text, ...(row.lines ?? [])]) assert.ok(text.includes(line));
        assert.match(text, /2 malformed Card tags ignored/);
        assert.equal(await page.locator('#mn-dialog').evaluate(element => element.scrollWidth <= element.clientWidth), true, 'All eight bounded overflow lines wrap inside the sheet');
        await close(page, '#mn-brief');
      }
      const all = await build(input([item(0, true), item(1)]));
      assert.equal(all.brief?.allInDeck, true); assert.match(await page.locator('#mn-brief').innerText(), /· all in the deck/);
      const label = `Invented${'界'.repeat(280)}`;
      const long = await build(input([{label, text: `${label}: detail.`, lines: ['Invented complete evidence remains available.']}]));
      await fit(page); await why(page, long.cards[0]!);
      const geometry = await page.locator('#mn-figure').evaluate(element => {
        const well = element.getBoundingClientRect(), number = element.querySelector('.mn-number')!.getBoundingClientRect();
        const time = element.querySelector('.mn-figure-label')!.getBoundingClientRect(), hint = element.querySelector('.mn-figure-hint')!.getBoundingClientRect();
        return {top: number.top - well.top, numberBottom: number.bottom, timeTop: time.top, timeBottom: time.bottom, hintTop: hint.top};
      });
      assert.ok(geometry.top >= 0 && geometry.numberBottom <= geometry.timeTop && geometry.timeBottom <= geometry.hintTop,
        `A long valid label leaves its run time readable at ${viewport.width}×${viewport.height}: ${JSON.stringify(geometry)}`);
      assert.equal(await page.locator('.mn-figure-label').innerText(), '07:41');
    }

    const folded = input([{text: 'Invented purchase-cost detail `120000000000000001`', lines: ['Invented folded Meta first line', 'Invented folded Meta second line']},
      {text: 'Invented freelancer detail', tag: {type: 'freelancer'}, lines: ['Invented folded freelancer first line', 'Invented folded freelancer second line']}]);
    storedSets(folded);
    const kill = sampleAdSetsView(folded.settings).rows.find(row => row.verdict?.verdict === 'Kill')!;
    folded.adSets!.rows = [{...kill, set: {...kill.set, ...folded.adSets!.catalogue![0]!}}];
    const projected = await build(folded);
    assert.equal(projected.cards.filter(card => card.kind === 'check-item').length, 0);
    assert.equal(projected.cards.length, 2); assert.equal(projected.brief?.allInDeck, true);
    for (const card of projected.cards) {
      assert.match(card.why, /From the morning check/);
      await show({...projected, cards: [card]}); await why(page, card);
    }
    const freelancer = projected.cards.find(card => card.kind === 'google')!;
    assert.equal(freelancer.figure.kind, 'plain', 'Check-only freelancer items use a plain figure');
    folded.extensions = [{...freelancer, why: 'Invented existing freelancer loss', primary: {kind: 'copy', label: 'Copy a message', text: 'Invented existing freelancer note'}}];
    const combined = await build(folded);
    assert.equal(combined.cards.filter(card => card.kind === 'google').length, 1);
    const combinedFreelancer = combined.cards.find(card => card.kind === 'google')!;
    assert.match(combinedFreelancer.why, /Invented existing freelancer loss[\s\S]*From the morning check/);
    await show({...combined, cards: [combinedFreelancer]}); await why(page, combinedFreelancer);

    for (const type of ['pause', 'hold', 'info'] as const) {
      const row: HQBriefItem = {text: 'Invented active set `120000000000000001`', lines: ['Invented pause evidence'], tag: type === 'info' ? {type} : {type, adSetId: '120000000000000001'}};
      const fixture = input([row]); storedSets(fixture); const projected = await build(fixture); const card = projected.cards[0]!;
      const before = actions.length;
      if (type === 'info') {await page.locator('#mn-menu').click(); await page.locator('#mn-sheet-body').getByRole('button', {name: 'Pause it now', exact: true}).click();}
      else await page.locator(type === 'pause' ? '#mn-primary' : '#mn-secondary').click();
      await page.locator('#mn-confirm').waitFor({state: 'visible'}); assert.equal(actions.length, before);
      assert.match(await page.locator('#mn-controls').innerText(), /Pause Invented Active Fern now\?/);
      await page.locator('#mn-confirm').click(); await page.locator('#mn-error').waitFor({state: 'visible'});
      assert.equal(actions.length, before + 1); assert.equal(await page.locator('#mn-card').getAttribute('data-mn-card'), card.key);
    }
    for (const [id, enabled] of [['120000000000000002', true], ['120000000000000003', true], ['120000000000000099', true], ['1200000000000000000000001', true], ['120000000000000001', false]] as const) {
      const fixture = input([{text: `Invented safe set \`${id}\``, tag: {type: 'pause', adSetId: id}, lines: ['Invented stored evidence']}]);
      storedSets(fixture, enabled); const projected = await build(fixture);
      assert.ok(projected.cards.every(card => ![card.primary, card.secondary, ...card.menu].some(button => button?.kind === 'live')));
      assert.equal(await page.locator('[data-mn-button-kind="live"]').count(), 0);
      assert.equal(await page.locator('#mn-confirm').count(), 0);
      if (id !== '120000000000000099') assert.equal(await page.locator('#mn-primary').getAttribute('href'), `/ads?set=${id}#${id}`, 'Known inactive or guarded sets remain reachable in the stored read');
      else assert.equal(await page.locator('#mn-primary').innerText(), 'Seen');
    }
    assert.equal(actions.length, 3); assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    console.log('Morning check-item browser checks passed: sample cards, both Watch cap branches, overflow lines, dated fine sheet, folding and guarded Pause controls.');
  } finally {await context.close();}
}
