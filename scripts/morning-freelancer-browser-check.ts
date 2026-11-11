import assert from 'node:assert/strict';
import type { BrowserContext, Page } from 'playwright';
import { addDays } from '../src/hero-range.js';
import type { MorningCard, MorningSnapshot } from '../src/morning/model-types.js';

async function ready(page: Page, card: MorningCard): Promise<void> {
  await page.waitForFunction(key => document.querySelector('#mn-root')?.getAttribute('data-mn-ready') === 'true'
    && document.querySelector('#mn-card')?.getAttribute('data-mn-card') === key
    && document.querySelector('#mn-stage')?.getAttribute('aria-busy') !== 'true', card.key);
}

/** Focus a real stored freelancer card; its holds and Undo use the actual local press route. */
export async function checkMorningFreelancer(signedIn: BrowserContext): Promise<void> {
  const first = await signedIn.request.get('/api/morning'); assert.equal(first.status(), 200);
  const origin = new URL(first.url()).origin;
  const read = async (): Promise<MorningSnapshot> => {
    const response = await signedIn.request.get('/api/morning'); assert.equal(response.status(), 200);
    return await response.json() as MorningSnapshot;
  };
  const before = await first.json() as MorningSnapshot;
  const freelancer = before.cards.find(card => card.kind === 'google');
  assert.ok(freelancer, 'The real sample deck offers the freelancer decision');
  assert.equal(freelancer.state, 'decide'); assert.equal(freelancer.primary.kind, 'copy');
  if (freelancer.primary.kind !== 'copy') throw new Error('Expected a freelancer copy action');
  const note = freelancer.primary.text;
  const context = await signedIn.browser()!.newContext({baseURL: origin, storageState: await signedIn.storageState(), reducedMotion: 'reduce'});
  const unexpected: string[] = [], errors: string[] = [], presses: object[] = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method()) && url.pathname !== '/api/morning/press') {
      unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
    }
    if (url.pathname === '/api/morning/press') presses.push(request.postDataJSON());
    return route.continue();
  });
  await context.addInitScript({content: `(() => {
    window.__freelancerCopyMode = 'success'; window.__freelancerCopies = [];
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: value => {
      window.__freelancerCopies.push(value);
      if (window.__freelancerCopyMode === 'failure') return Promise.reject(new Error('Invented clipboard refusal'));
      if (window.__freelancerCopyMode === 'pending') return new Promise((resolve, reject) => { window.__finishFreelancerCopy = ok => ok ? resolve() : reject(new Error('Invented delayed refusal')); });
      return Promise.resolve();
    }}});
  })();`});
  const page = await context.newPage();
  await page.route('**/api/morning', async route => {
    const snapshot = await read(), card = snapshot.cards.find(card => card.key === freelancer.key);
    return route.fulfill({json: card ? {...snapshot, cards: [card], total: snapshot.completed + 1} : snapshot});
  });
  const reload = async (): Promise<void> => {await page.goto('/morning'); await ready(page, freelancer);};
  const copy = async (): Promise<void> => {
    await page.locator('#mn-primary').click(); await page.locator('#mn-dialog').waitFor({state: 'visible'});
    assert.equal(await page.locator('#mn-copy-text').inputValue(), note);
    await page.locator('#mn-copy').click();
  };
  const undo = async (): Promise<void> => {
    const response = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/morning/press');
    await page.locator('#mn-undo').click(); const saved = await response;
    assert.equal(saved.status(), 200); assert.deepEqual(saved.request().postDataJSON(), {cardKey: freelancer.key, action: 'undo'});
    await page.waitForFunction(() => document.querySelector('#mn-stage')?.getAttribute('aria-busy') !== 'true');
    assert.ok(!(await read()).answers.some(row => row.cardKey === freelancer.key));
    await reload();
  };
  const assertHold = async (response: Awaited<ReturnType<Page['waitForResponse']>>): Promise<void> => {
    assert.equal(response.status(), 200);
    assert.deepEqual(response.request().postDataJSON(), {cardKey: freelancer.key, action: 'hold', days: 7});
    await page.waitForFunction(() => document.querySelector('#mn-stage')?.getAttribute('aria-busy') !== 'true'
      && document.querySelector('#mn-toast-message')?.textContent?.includes('Nothing changed in Meta.'));
    assert.equal(await page.locator('#mn-dialog').isVisible(), false);
    assert.equal(await page.locator('#mn-confirm').count(), 0, 'A local freelancer hold needs no confirmation');
    const snapshot = await read();
    assert.equal(snapshot.answers.find(row => row.cardKey === freelancer.key)?.untilDay, addDays(snapshot.day, 7));
    assert.ok(!snapshot.cards.some(card => card.key === freelancer.key));
    assert.equal(await page.evaluate(() => document.activeElement?.id), snapshot.cards.length ? 'mn-primary' : '');
  };
  try {
    for (const width of [390, 1280]) {
      await page.setViewportSize({width, height: width === 390 ? 844 : 960}); await reload();
      assert.equal(await page.locator('#mn-secondary').innerText(), 'Leave it, ask in a week');
      const leave = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/morning/press');
      await page.locator('#mn-secondary').click(); await assertHold(await leave); await undo();
      const count = presses.length;
      await copy(); await page.locator('#mn-copy-sent').waitFor({state: 'visible'});
      assert.equal(presses.length, count, 'Copying never marks the message as sent or holds the card');
      assert.equal(await page.locator('#mn-dialog').isVisible(), true);
      assert.equal(await page.locator('#mn-copy-sent').innerText(), 'Sent, ask again in a week');
      for (const selector of ['#mn-copy', '#mn-copy-sent', '#mn-close']) {
        const box = await page.locator(selector).boundingBox(); assert.ok(box && box.width >= 44 && box.height >= 44, `${selector} keeps a 44px tap`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const sent = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/morning/press');
      await page.locator('#mn-copy-sent').click(); await assertHold(await sent); await undo();
    }

    await copy(); await page.locator('#mn-copy-sent').waitFor({state: 'visible'});
    await page.route('**/api/morning/press', route => route.fulfill({status: 503, json: {error: 'Invented hold unavailable.'}}), {times: 1});
    await page.locator('#mn-copy-sent').click();
    await page.waitForFunction(() => document.querySelector('#mn-sheet-status')?.textContent === 'Invented hold unavailable.');
    assert.equal(await page.locator('#mn-dialog').isVisible(), true, 'A refused hold retains the successful copy sheet');
    assert.ok(!(await read()).answers.some(row => row.cardKey === freelancer.key));
    await page.keyboard.press('Escape'); await page.locator('#mn-dialog').waitFor({state: 'hidden'});

    await page.evaluate(() => {(window as unknown as {__freelancerCopyMode: string}).__freelancerCopyMode = 'failure';});
    await copy();
    await page.waitForFunction(() => document.querySelector('#mn-sheet-status')?.textContent?.includes('Copy was unavailable.'));
    assert.equal(await page.locator('#mn-copy-sent').count(), 0);
    assert.equal(await page.locator('#mn-copy-text').evaluate(element => {
      const text = element as HTMLTextAreaElement; return text.selectionStart === 0 && text.selectionEnd === text.value.length;
    }), true, 'Failed copying selects the existing manual fallback text');
    await page.keyboard.press('Escape'); await page.locator('#mn-dialog').waitFor({state: 'hidden'});

    await page.evaluate(() => {(window as unknown as {__freelancerCopyMode: string}).__freelancerCopyMode = 'pending';});
    await copy(); await page.keyboard.press('Escape'); await page.locator('#mn-dialog').waitFor({state: 'hidden'});
    await page.locator('#mn-figure').click(); await page.locator('#mn-dialog').waitFor({state: 'visible'});
    const why = await page.locator('#mn-sheet-body').innerText();
    await page.evaluate(async () => {(window as unknown as {__finishFreelancerCopy: (ok: boolean) => void}).__finishFreelancerCopy(true); await new Promise(resolve => setTimeout(resolve, 0));});
    assert.equal(await page.locator('#mn-sheet-title').innerText(), 'Why this is here');
    assert.equal(await page.locator('#mn-sheet-body').innerText(), why); assert.equal(await page.locator('#mn-copy-sent').count(), 0);
    assert.equal(await page.locator('#mn-dialog').isVisible(), true, 'A late clipboard success never replaces or closes a newer sheet');
    await page.keyboard.press('Escape'); await page.locator('#mn-dialog').waitFor({state: 'hidden'});

    await copy(); await page.keyboard.press('Escape'); await page.locator('#mn-dialog').waitFor({state: 'hidden'});
    await page.locator('#mn-primary').click(); await page.locator('#mn-dialog').waitFor({state: 'visible'});
    await page.evaluate(async () => {(window as unknown as {__finishFreelancerCopy: (ok: boolean) => void}).__finishFreelancerCopy(false); await new Promise(resolve => setTimeout(resolve, 0));});
    assert.equal(await page.locator('#mn-copy-sent').count(), 0);
    assert.equal(await page.locator('#mn-sheet-status').innerText(), '', 'A late clipboard refusal cannot change a newly opened copy sheet');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'mn-close');
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    assert.ok(presses.every(body => ['hold', 'undo'].includes((body as {action: string}).action)), 'Only explicit local hold and Undo presses are sent');
    console.log('Freelancer Morning browser checks passed: real copy card, both seven-day holds, Undo, clipboard failure and stale-sheet guards.');
  } finally {
    const snapshot = await read();
    if (snapshot.answers.some(row => row.cardKey === freelancer.key)) {
      const restored = await signedIn.request.post('/api/morning/press', {headers: {origin}, data: {cardKey: freelancer.key, action: 'undo'}});
      assert.equal(restored.status(), 200);
    }
    await context.close();
  }
}
