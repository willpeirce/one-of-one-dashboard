import assert from 'node:assert/strict';
import type { BrowserContext, Page } from 'playwright';
import { addDays } from '../src/hero-range.js';
import type { MorningCard, MorningMetaAction, MorningPauseMember, MorningSnapshot, MorningState } from '../src/morning/model-types.js';
import { morningPage } from '../src/morning/view.js';

const groupKey = 'pause-all:invented-cohort';
const day = '2032-04-06';
function kill(index: number): MorningCard {
  const id = String(120000000000000100n + BigInt(index));
  return {key: `meta-kill:invented-${index}`, kind: 'meta-kill', subjectId: id, sourceScope: 'adsets', factsHash: `invented-facts-${index}`,
    ruleId: 'purchase-cost', state: 'decide', tier: 1, order: index, title: `Invented Fern ${index + 1} is over its kill bar`, lane: 'Meta · UK', source: 'meta',
    figure: {kind: 'plain', value: `£${80 + index} spend`, label: 'Invented cost'}, whyLine: 'Invented purchase cost is over its bar.',
    why: 'Invented purchase cost is over its bar.', rule: 'Invented purchase-cost rule.', sourceLine: 'Invented stored Meta read', sourceHref: `/ads#${id}`,
    primary: {kind: 'live', label: 'Pause', adSetId: id, action: 'pause', value: 'PAUSED', confirm: `Pause Invented Fern ${index + 1} now?`},
    secondary: {kind: 'save', target: 'morning', action: 'park', label: 'One more day'}, menu: [], allowedPresses: ['park']};
}
interface Scenario {
  cards: MorningCard[]; actions: MorningMetaAction[]; held: Set<string>; deferred: boolean; failAt: number | null; loseAt: number | null;
  attempts: number; commands: {id: string; body: object}[]; local: object[]; events: string[];
  onRead?: () => void; onPause?: (id: string) => Promise<void> | void;
}
const scenario = (count: number): Scenario => ({cards: Array.from({length: count}, (_, index) => kill(index)), actions: [], held: new Set(),
  deferred: false, failAt: null, loseAt: null, attempts: 0, commands: [], local: [], events: []});
const member = (card: MorningCard): MorningPauseMember => ({cardKey: card.key, factsHash: card.factsHash, adSetId: card.subjectId});
function projection(base: MorningSnapshot, value: Scenario): MorningSnapshot {
  const paused = new Set(value.actions.filter(action => !action.undoneAt).map(action => action.adSetId));
  const open = value.cards.filter(card => !paused.has(card.subjectId) && !value.held.has(card.subjectId));
  const members = open.map(member);
  const group: MorningCard | undefined = !value.deferred && open.length >= 3 ? {...open[0]!, key: groupKey, kind: 'pause-all', subjectId: 'invented-cohort',
    factsHash: 'invented-pause-all', title: `${open.length} of ours are over the bar`,
    figure: {kind: 'list', rows: open.slice(0, 8).map(card => ({label: card.title.replace(' is over its kill bar', ''), value: card.figure.kind === 'plain' ? card.figure.value : 'Invented cost'})), more: Math.max(0, open.length - 8)},
    flag: 'After these, nothing of ours is live in the UK', whyLine: 'Pause these failing sets after one confirmation.',
    why: open.map(card => `${card.title}: ${card.figure.kind === 'plain' ? card.figure.value : 'Invented cost'}`).join('\n'),
    primary: {kind: 'pause-all', label: `Pause all ${open.length}`, confirm: `Pause these ${open.length} ad sets now?`, members},
    secondary: {kind: 'save', target: 'morning', action: 'park', label: 'One by one'}, menu: [], allowedPresses: ['park']} : undefined;
  const state: MorningState = {mode: 'live', cardKey: groupKey, state: 'parked', untilDay: addDays(day, 1), factsHash: 'invented-pause-all',
    answer: null, credentialId: 'invented-device', pressedAt: `${day}T10:00:00Z`, clearedAt: null, title: 'Invented pause group',
    kind: 'pause-all', subjectId: 'invented-cohort', sourceScope: 'adsets'};
  const cards = group ? [group] : open;
  return {...base, mode: 'live', day, cards, more: 0, watchOnHome: 0, completed: paused.size, total: paused.size + cards.length,
    presses: value.deferred ? [state] : [], parked: value.deferred ? [{stateRow: state, title: state.title, reason: 'Parked until tomorrow', untilDay: state.untilDay}] : [],
    hidden: [], answers: [], passedDates: [], metaActions: value.actions, brief: null, summaryEnabled: false,
    pauseAll: {cardKey: groupKey, members, deferred: value.deferred}};
}
async function ready(page: Page, key: string | null): Promise<void> {
  await page.waitForFunction(expected => document.querySelector('#mn-root')?.getAttribute('data-mn-ready') === 'true'
    && (expected ? document.querySelector('#mn-card')?.getAttribute('data-mn-card') === expected : !!document.querySelector('#mn-all-clear')), key);
}
async function complete(page: Page, message: string): Promise<void> {
  await page.waitForFunction(expected => document.querySelector('#mn-stage')?.getAttribute('aria-busy') !== 'true'
    && document.querySelector('#mn-toast-message')?.textContent?.includes(expected), message);
}
async function confirm(page: Page): Promise<void> {
  await page.locator('#mn-primary').click(); await page.locator('#mn-confirm').waitFor({state: 'visible'});
  await page.locator('#mn-confirm').click();
}

/** Live-mode projections exercise only stubbed existing action routes; actual sample reads offer no group. */
export async function checkMorningPauseAll(signedIn: BrowserContext): Promise<void> {
  const response = await signedIn.request.get('/api/morning'); assert.equal(response.status(), 200);
  const base = await response.json() as MorningSnapshot;
  assert.equal(base.mode, 'sample');
  assert.ok(!base.cards.some(card => card.kind === 'pause-all' || card.primary.kind === 'pause-all'));
  const origin = new URL(response.url()).origin;
  const context = await signedIn.browser()!.newContext({baseURL: origin, storageState: await signedIn.storageState(), reducedMotion: 'reduce'});
  const errors: string[] = [], unexpected: string[] = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())
      && url.pathname !== '/api/morning/press' && !url.pathname.startsWith('/api/meta/adset/')) {
      unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
    }
    return route.continue();
  });
  let current = scenario(5);
  const inFlight = new Map<Page, number>(), maximum = new Map<Page, number>();
  const configure = async (page: Page): Promise<void> => {
    await page.route(url => url.pathname === '/morning', route => route.fulfill({contentType: 'text/html', body: morningPage(projection(base, current))}));
    await page.route('**/api/morning', route => {
      current.onRead?.(); current.events.push('read');
      return route.fulfill({json: projection(base, current)});
    });
    await page.route('**/api/morning/press', route => {
      const body = route.request().postDataJSON(); current.local.push(body);
      assert.equal(body.cardKey, groupKey); assert.ok(['park', 'undo'].includes(body.action));
      assert.deepEqual(Object.keys(body).sort(), ['action', 'cardKey']);
      current.deferred = body.action === 'park';
      return route.fulfill({json: projection(base, current)});
    });
    await page.route('**/api/meta/adset/*', async route => {
      const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
      const body = route.request().postDataJSON() as {action: string; value: string};
      current.commands.push({id, body});
      const count = (inFlight.get(page) ?? 0) + 1; inFlight.set(page, count); maximum.set(page, Math.max(maximum.get(page) ?? 0, count));
      try {
        if (body.action === 'pause') {
          assert.equal(current.events.at(-1), 'read', 'Each pause follows a fresh deck read');
          current.events.push(`pause:${id}`); current.attempts++;
          assert.deepEqual(body, {action: 'pause', value: 'PAUSED'});
          assert.ok(!current.actions.some(action => action.adSetId === id && !action.undoneAt), 'An already paused set cannot be paused twice');
          if (current.failAt === current.attempts) {
            await route.fulfill({status: 409, json: {error: 'Invented third pause refused.'}}); return;
          }
          const actionId = `invented-pause-${current.actions.length + 1}`;
          current.actions.push({id: actionId, time: `${day}T10:00:00Z`, adSetId: id, action: 'pause', oldValue: 'ACTIVE', newValue: 'PAUSED',
            result: 'success', undoneAt: null, undoOf: null, errorCode: null, title: `Invented set ${current.actions.length + 1} paused`,
            undo: {kind: 'live', label: 'Undo', adSetId: id, action: 'undo', value: actionId, confirm: 'Undo this invented pause?'}});
          if (current.loseAt === current.attempts) {
            await route.fulfill({status: 503, json: {error: 'Invented response lost after saving.'}}); return;
          }
          await current.onPause?.(id);
          await new Promise<void>(resolve => setTimeout(resolve, 15));
          await route.fulfill({json: {id: actionId, refreshed: true}});
        } else {
          assert.equal(body.action, 'undo');
          const action = current.actions.find(action => action.id === body.value && action.adSetId === id && !action.undoneAt);
          assert.ok(action, 'Undo names its original saved action');
          action.undoneAt = `${day}T10:01:00Z`; action.undo = null;
          await new Promise<void>(resolve => setTimeout(resolve, 15));
          await route.fulfill({json: {id: `invented-undo-${body.value}`, refreshed: true}});
        }
      } finally { inFlight.set(page, count - 1); }
    });
  };
  const page = await context.newPage(); await configure(page);
  const reset = async (count: number): Promise<void> => {
    current = scenario(count); await page.goto('/morning'); await ready(page, count >= 3 ? groupKey : current.cards[0]?.key ?? null);
  };
  try {
    await reset(11);
    for (const viewport of [{width: 390, height: 844}, {width: 375, height: 667}, {width: 1280, height: 960}]) {
      await page.setViewportSize(viewport); await page.evaluate(async () => {await document.fonts.ready; scrollTo(0, 0);});
      assert.equal(await page.locator('#mn-card').count(), 1);
      assert.equal(await page.locator('.mn-list-row:visible').count(), 8);
      assert.equal(await page.locator('.mn-list-more').innerText(), '+3 more');
      const geometry = await page.locator('#mn-figure').evaluate(element => {
        const box = element.getBoundingClientRect(), hint = element.querySelector('.mn-figure-hint')!.getBoundingClientRect();
        return {height: box.height, rows: Array.from(element.querySelectorAll('.mn-list-row,.mn-list-more')).map(row => {
          const item = row.getBoundingClientRect(); return {top: item.top - box.top, bottom: item.bottom - box.top};
        }), hintTop: hint.top - box.top};
      });
      assert.ok(geometry.rows.every(row => row.top >= 0 && row.bottom <= geometry.hintTop), `All eight rows and the overflow count fit above Why at ${viewport.width}×${viewport.height}: ${JSON.stringify(geometry)}`);
      for (const selector of ['#mn-primary', '#mn-secondary', '#mn-good']) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box && box.height >= 44 && box.width >= 44 && box.y + box.height <= viewport.height + .5, `${selector} retains its visible 44px tap`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      console.log('PAUSE ALL LIST FIT', viewport.width, viewport.height, geometry.height);
      await page.locator('#mn-figure').click(); await page.locator('#mn-dialog').waitFor({state: 'visible'});
      for (const card of current.cards) assert.ok((await page.locator('#mn-sheet-body').innerText()).includes(card.title));
      await page.keyboard.press('Escape'); await page.locator('#mn-dialog').waitFor({state: 'hidden'});
    }

    await reset(5);
    assert.equal(await page.locator('#mn-progress').innerText(), '1 of 1');
    await page.locator('#mn-secondary').click(); await ready(page, current.cards[0]!.key);
    assert.equal(await page.locator('#mn-confirm').count(), 0); assert.equal(current.commands.length, 0);
    assert.equal(projection(base, current).cards.length, 5); assert.equal(current.deferred, true);
    await page.locator('#mn-undo').click(); await ready(page, groupKey);
    assert.equal(current.deferred, false);

    current.failAt = 3;
    await page.locator('#mn-primary').click(); await page.locator('#mn-confirm').waitFor({state: 'visible'});
    assert.match(await page.locator('#mn-card').innerText(), /Pause these 5 ad sets now\?/);
    assert.equal(current.commands.length, 0, 'Opening the single confirmation makes no source request');
    await page.locator('#mn-confirm').click(); await complete(page, '2 ad sets paused. Invented third pause refused.');
    assert.equal(current.attempts, 3); assert.equal(current.actions.length, 2);
    assert.equal(current.deferred, true); assert.equal(projection(base, current).cards.length, 3);
    assert.equal(await page.locator('#mn-card').getAttribute('data-mn-kind'), 'meta-kill');
    assert.equal(await page.locator('#mn-toast').getAttribute('data-state'), 'alarm');
    await page.locator('#mn-undo').click(); await page.locator('#mn-dialog').waitFor({state: 'visible'});
    assert.match(await page.locator('#mn-sheet-body').innerText(), /Undo these 2 pauses\?/);
    await page.locator('#mn-dialog #mn-confirm').click(); await complete(page, '2 pauses undone');
    assert.deepEqual(current.commands.filter(command => (command.body as {action: string}).action === 'undo').map(command => (command.body as {value: string}).value), ['invented-pause-2', 'invented-pause-1']);

    await reset(5); current.loseAt = 3;
    await confirm(page); await complete(page, '3 ad sets paused. Invented response lost after saving.');
    assert.equal(current.attempts, 3); assert.equal(current.actions.length, 3);
    assert.equal(projection(base, current).cards.length, 2, 'A committed pause with a lost response leaves the deck');
    await page.locator('#mn-undo').click(); await page.locator('#mn-dialog #mn-confirm').click(); await complete(page, '3 pauses undone');
    assert.deepEqual(current.commands.slice(3).map(command => (command.body as {value: string}).value), ['invented-pause-3', 'invented-pause-2', 'invented-pause-1'], 'Recovered audit receipts join the reverse Undo');

    await reset(5); await confirm(page); await complete(page, '5 ad sets paused');
    assert.equal(current.actions.length, 5); assert.equal(current.local.length, 0);
    assert.equal(await page.locator('#mn-all-clear').count(), 1);
    assert.equal(await page.locator('#mn-done-list [data-mn-live-undo]').count(), 5, 'Every pause retains its own saved Undo');
    await page.locator('#mn-undo').click(); await page.locator('#mn-dialog #mn-cancel').click();
    await page.locator('#mn-dialog').waitFor({state: 'hidden'});
    assert.equal(current.commands.length, 5, 'Cancelling the single Undo confirmation makes no source request');
    assert.equal(await page.locator('#mn-undo').isVisible(), true, 'Cancelled Undo keeps its saved receipt available');
    await page.locator('#mn-undo').click(); await page.locator('#mn-dialog #mn-confirm').click(); await complete(page, '5 pauses undone');
    assert.deepEqual(current.commands.slice(5).map(command => (command.body as {value: string}).value), [5, 4, 3, 2, 1].map(index => `invented-pause-${index}`));

    await reset(3); await confirm(page); await complete(page, '3 ad sets paused');
    await page.locator('#mn-undo').click(); await page.locator('#mn-dialog').waitFor({state: 'visible'});
    await page.locator('#mn-toast').waitFor({state: 'hidden', timeout: 10_000});
    await page.keyboard.press('Escape'); await page.locator('#mn-dialog').waitFor({state: 'hidden'});
    await page.waitForFunction(() => document.activeElement === document.querySelector('#mn-all-clear h2'));
    assert.equal(await page.locator('#mn-done-list [data-mn-live-undo]').count(), 3, 'After toast expiry each saved pause still has its own Undo');
    assert.equal(current.commands.length, 3, 'Closing an expired Undo confirmation makes no source request');

    await reset(5);
    current.onPause = () => {
      if (current.attempts !== 1) return;
      current.held.add(current.cards[1]!.subjectId);
      current.cards[2] = {...current.cards[2]!, factsHash: 'invented-changed-rule'};
      current.cards.push(kill(5));
    };
    await confirm(page); await complete(page, '3 ad sets paused');
    assert.deepEqual(current.commands.map(command => command.id), [0, 3, 4].map(index => kill(index).subjectId), 'Changed and held members are skipped; a newly arriving set is never added');

    await reset(3);
    await page.locator('#mn-primary').click();
    current.onRead = () => {current.deferred = true; delete current.onRead;};
    await page.locator('#mn-confirm').click(); await complete(page, '0 ad sets paused. The rest are one by one.');
    assert.equal(current.commands.length, 0, 'Another device choosing One by one stops the pending batch');

    await reset(3);
    let release: (() => void) | undefined, started: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => {release = resolve;});
    const began = new Promise<void>(resolve => {started = resolve;});
    current.onPause = async () => {if (current.attempts === 1) {started!(); await waiting;}};
    const second = await context.newPage(); await configure(second);
    try {
      await confirm(page); await began;
      await second.goto('/morning'); await ready(second, current.cards[1]!.key);
      assert.equal(projection(base, current).cards.length, 2);
      await confirm(second); await complete(second, 'Saved');
      release!(); await complete(page, '2 ad sets paused');
      assert.deepEqual(current.commands.map(command => command.id).sort(), [0, 1, 2].map(index => kill(index).subjectId).sort());
      assert.equal(new Set(current.commands.map(command => command.id)).size, 3, 'A slow response and second device never issue the same pause twice');
      await page.reload(); await ready(page, null);
      assert.equal(current.commands.length, 3, 'Reload never resumes a batch');
    } finally {release?.(); await second.close();}
    assert.ok([...maximum.values()].every(value => value === 1), 'Each browser sends action requests one at a time');
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log('Pause all browser checks passed: eight-row fit, one confirmation, local One by one, partial failure, reverse Undo, fresh cohort checks, second-device changes and reload.');
  } finally {await context.close();}
}
