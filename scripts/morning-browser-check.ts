import assert from 'node:assert/strict';
import type { BrowserContext, Locator, Page } from 'playwright';
import { addDays } from '../src/hero-range.js';
import { morningDay } from '../src/morning/view.js';
import { checkMorningRuleSettings } from './morning-rules-browser-check.js';
import { checkMorningPauseAll } from './morning-pause-all-browser-check.js';
import type { MorningButton, MorningCard, MorningFigure, MorningSnapshot, MorningState } from '../src/morning/model-types.js';
import type { SettingsSnapshot } from '../src/settings.js';
import type { TickerSnapshot } from '../src/ticker/model.js';

async function tapSizes(scope: Locator, label: string): Promise<void> {
  for (const control of await scope.locator('button,a,input,select,textarea').all()) {
    if (!await control.isVisible()) continue;
    const box = await control.boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44,
      `${label}: ${await control.getAttribute('id') ?? await control.textContent()} needs a 44px tap`);
  }
}

async function shown(page: Page, snapshot: MorningSnapshot): Promise<void> {
  await page.locator('#mn-root[data-mn-ready="true"]').waitFor();
  const progress = snapshot.total ? `${Math.min(snapshot.completed + (snapshot.cards.length ? 1 : 0), snapshot.total)} of ${snapshot.total}` : 'All clear';
  await page.waitForFunction(({key, progress}) => (key
    ? document.querySelector('#mn-card')?.getAttribute('data-mn-card') === key
    : !!document.querySelector('#mn-all-clear')) && document.querySelector('#mn-progress')?.textContent?.includes(progress),
  {key: snapshot.cards[0]?.key ?? null, progress});
}

async function fit(page: Page, label: string): Promise<void> {
  await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); });
  await page.waitForFunction(() => document.querySelector('#mn-card')?.getAnimations().every(animation =>
    animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity) ?? true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: no horizontal scroll`);
  for (const selector of ['#mn-primary', '#mn-secondary', '#mn-good']) {
    const control = page.locator(selector);
    if (selector !== '#mn-secondary') assert.equal(await control.isVisible(), true, `${label}: ${selector} is present`);
    if (!await control.count() || !await control.isVisible()) continue;
    const box = await control.boundingBox(), minimum = selector === '#mn-primary' ? 50 : 44;
    assert.ok(box && box.height >= minimum && box.width >= 44, `${label}: ${selector} meets its tap size (${JSON.stringify(box)})`);
    assert.ok(box.y >= 0 && box.y + box.height <= page.viewportSize()!.height + .5,
      `${label}: ${selector} stays on the first screen (${JSON.stringify(box)})`);
  }
  assert.match(await page.locator('#mn-stage').getAttribute('data-mn-density') ?? '', /^(roomy|compact|tight)$/);
  await tapSizes(page.locator('#mn-root'), label);
  const lines = await page.locator('.mn-summary-lines').boundingBox();
  assert.ok(lines && lines.height <= 100, `${label}: the two Morning lines stay within 100px (${JSON.stringify(lines)})`);
  const good = (await page.locator('#mn-good').boundingBox())!;
  const watch = (await page.locator('.mn-watch-line').boundingBox())!;
  assert.ok(watch.width >= 44 && watch.height >= 44, `${label}: Watch keeps its 44px area, including the non-link state`);
  assert.ok(Math.abs(good.y - watch.y) < .5 && good.x + good.width <= watch.x,
    `${label}: Good and Watch sit side by side`);
}

async function focusAfterSave(page: Page, snapshot: MorningSnapshot): Promise<void> {
  await page.waitForFunction(() => document.querySelector('#mn-stage')?.getAttribute('aria-busy') !== 'true');
  if (await page.locator('#mn-dialog').isVisible()) assert.equal(await page.evaluate(() => document.activeElement?.id), 'mn-close');
  else if (snapshot.cards.length) assert.equal(await page.evaluate(() => document.activeElement?.id), 'mn-primary');
  else assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#mn-all-clear')), true);
}

async function openSheet(page: Page, opener: string): Promise<void> {
  await page.locator(opener).click();
  await page.locator('#mn-dialog').waitFor({state: 'visible'});
  assert.equal(await page.locator('#mn-dialog').evaluate(element => element.matches(':modal')), true);
  assert.equal(await page.locator('#mn-dialog').evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + Math.min(30, box.height / 2)));
  }), true, 'Morning sheets occupy the native top layer above the header');
  await tapSizes(page.locator('#mn-dialog'), 'Morning sheet');
}

async function closeSheet(page: Page, opener?: string): Promise<void> {
  await page.keyboard.press('Escape'); await page.locator('#mn-dialog').waitFor({state: 'hidden'});
  if (opener) {
    const id = opener.replace(/^#/, '');
    // The native close event restores a replaced opener on its next task.
    await page.waitForFunction(expected => document.activeElement?.id === expected, id);
    assert.equal(await page.evaluate(() => document.activeElement?.id), id);
  }
}

function fixtureCards(base: MorningSnapshot): MorningCard[] {
  const original = base.cards[0]!;
  const thumb = base.cards.find(card => card.figure.kind === 'thumb')?.figure;
  const variant = {bullets: [1, 2, 3].map((strength, index) => ({text: `Invented brief point ${index + 1}: show a clear sample detail in the opening frame, with a short caption and one useful comparison.`, strength: strength as 1 | 2 | 3})), text: 'Invented copy brief', footer: 'Sample evidence'};
  const figures: MorningFigure[] = [
    {kind: 'plain', value: '£12.34', label: 'Invented cost'},
    {kind: 'dial', value: 58, bar: 32, label: 'Invented cost per order', formattedValue: '£58', formattedBar: '£32'},
    {kind: 'rail', value: 12, label: '12 days left', range: 14},
    thumb ?? {kind: 'thumb', src: '/assets/icon-192.png', alt: 'Invented creative', value: '£12.34', label: 'Sample cost'},
    {kind: 'brief', variants: {'1': {...variant, text: 'Invented one-day evidence: 12 observations.'}, '3': {...variant, text: 'Invented three-day evidence: 24 observations.'}, '7': {...variant, text: 'Invented seven-day evidence: 48 observations.'}}},
    {kind: 'arms', arms: [{label: 'A', value: 4.2, formatted: '4.2%', count: 50}, {label: 'B', value: 5.8, formatted: '5.8%', count: 52}], sure: 97, eligible: true},
  ];
  const kinds: MorningCard['kind'][] = ['need', 'meta-kill', 'meta-slipping', 'meta-step', 'meta-watch', 'date', 'fading', 'make-next', 'google', 'test-call', 'new-verdict', 'done-for-you'];
  return kinds.map((kind, index) => ({...original, key: `invented-browser-${kind}`, kind, subjectId: `invented-${kind}`,
    state: kind === 'need' ? 'alarm' : kind === 'done-for-you' ? 'done' : kind === 'make-next' || kind === 'date' || kind === 'new-verdict' ? 'info' : kind.startsWith('meta-') || kind === 'test-call' ? 'decide' : 'warn',
    title: `Invented ${kind} card with a deliberately long title to exercise the three-line clamp before the controls leave the screen`,
    figure: kind === 'make-next' ? figures[4]! : kind === 'fading' ? figures[3]! : kind === 'test-call' ? figures[5]! : figures[index % figures.length]!,
    flag: 'Invented watch flag with enough words to exercise the compact layout', whyLine: 'Invented reason with enough detail to exercise the available card space.',
    primary: {kind: 'link', label: 'Open the invented source', href: '/sources'},
    secondary: {kind: 'save', target: 'morning', label: 'Not today', action: 'park'},
    menu: [{kind: 'save', target: 'morning', label: 'Stop showing this', action: 'hide'}], allowedPresses: ['park', 'hide'],
  }));
}

/** Use genuine local presses, plus intercepted fixture reads for layout-only cases. No production test hooks. */
export async function checkMorning(signedIn: BrowserContext): Promise<void> {
  const browser = signedIn.browser()!, initialResponse = await signedIn.request.get('/api/morning');
  assert.equal(initialResponse.status(), 200); assert.equal(initialResponse.headers()['cache-control'], 'no-store');
  const initial = await initialResponse.json() as MorningSnapshot, origin = new URL(initialResponse.url()).origin;
  assert.equal(initial.mode, 'sample'); assert.ok(initial.cards.length > 0);
  const initialStateKeys = new Set([...initial.presses, ...initial.parked.map(row => row.stateRow), ...initial.hidden.map(row => row.stateRow), ...initial.answers].map(row => row.cardKey));
  const initialTicker = await (await signedIn.request.get('/api/ticker')).json() as TickerSnapshot;
  const initialPassed = new Set(initialTicker.passed.map(row => row.key));
  const originalSettings = await (await signedIn.request.get('/api/settings')).json() as SettingsSnapshot;
  const context = await browser.newContext({baseURL: origin, storageState: await signedIn.storageState(), reducedMotion: 'no-preference'});
  const errors: string[] = [];
  let external = 0, metaRequests = 0;
  context.on('page', page => page.on('pageerror', error => errors.push(error.name)));
  context.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/meta/adset/')) metaRequests++; });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { external++; await route.abort('blockedbyclient'); }
    else await route.continue();
  });
  await context.addInitScript({content: `(() => {
    const values = [];
    Object.defineProperty(window, '__morningClipboard', {value: values});
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async value => { values.push(value); }}});
  })();`});
  const read = async (): Promise<MorningSnapshot> => {
    const response = await context.request.get('/api/morning'); assert.equal(response.status(), 200); return await response.json() as MorningSnapshot;
  };
  const setFirst = async (enabled: boolean): Promise<void> => {
    const current = await (await context.request.get('/api/settings')).json() as SettingsSnapshot;
    const response = await context.request.post('/api/settings', {headers: {origin}, data: {...current, values: {...current.values, morningOpensFirst: enabled}}});
    assert.equal(response.status(), 200);
  };
  const clean = async (): Promise<void> => {
    const state = await read();
    const keys = new Set([...state.presses, ...state.parked.map(row => row.stateRow), ...state.hidden.map(row => row.stateRow), ...state.answers].map(row => row.cardKey));
    for (const cardKey of keys) if (!initialStateKeys.has(cardKey)) {
      const response = await context.request.post('/api/morning/press', {headers: {origin}, data: {cardKey, action: 'undo'}});
      assert.equal(response.status(), 200);
    }
    const ticker = await (await context.request.get('/api/ticker')).json() as TickerSnapshot;
    for (const row of ticker.passed) if (!initialPassed.has(row.key)) {
      assert.equal((await context.request.post('/api/ticker/restore', {headers: {origin}, data: {eventKey: row.key}})).status(), 200);
    }
  };
  try {
    await setFirst(false);
    const bar = await context.newPage();
    try {
      // The widths the two usual viewports never load: six pills stay on one row with any chapter current.
      for (const width of [375, 402, 430, 480, 1024, 1180, 1181]) {
        await bar.setViewportSize({width, height: 844});
        await bar.goto('/'); await bar.locator('html[data-dashboard-ready="true"]').waitFor();
        for (const go of ['hero', 'table', 'tests', 'dials']) {
          const sideways = await bar.evaluate(current => {
            document.querySelectorAll<HTMLElement>('[data-go]').forEach(item => item.setAttribute('aria-current', String(item.dataset.go === current)));
            return document.documentElement.scrollWidth - innerWidth;
          }, go);
          assert.ok(sideways <= 0, `Home's six-pill bar fits at ${width}px with ${go} current (${sideways}px over)`);
        }
      }
      for (const path of ['/settings', '/ads']) for (const width of [375, 390]) {
        await bar.setViewportSize({width, height: 844}); await bar.goto(path);
        const height = await bar.locator('header.top').evaluate(element => element.getBoundingClientRect().height);
        assert.ok(height < 70, `${path} keeps a one-row header at ${width}px (${height}px)`);
      }
    } finally { await bar.close(); }
    for (const width of [390, 1280]) {
      await clean();
      const page = await context.newPage(); await page.setViewportSize({width, height: width === 390 ? 844 : 960});
      try {
        await page.goto('/'); await page.locator('html[data-dashboard-ready="true"]').waitFor();
        const top = await page.locator('.hero-grid').evaluate(element => element.getBoundingClientRect().top + scrollY);
        assert.equal(top, width === 390 ? 499.0625 : 405.625, 'The new Morning way in leaves Home’s fold unchanged to the pixel');
        assert.equal(await page.locator('a[href="/morning"]').count(), 3, 'Home links to Morning three times and no more');
        for (const way of ['#table a.morning-link', 'header.top .pills a.pill-morning', 'header.top .account-links a'])
          assert.equal(await page.locator(`${way}[href="/morning"]`).count(), 1, `Home has one Morning link at ${way}`);
        const tap = await page.locator('header.top a.pill-morning').evaluate(pill => {
          const box = pill.getBoundingClientRect(), area = getComputedStyle(pill, '::after');
          const x = box.left + box.width / 2, y = box.top + box.height / 2;
          return { width: parseFloat(area.width), height: parseFloat(area.height),
            edges: [[x, box.top - 4], [x, box.bottom + 4], [box.left - 3, y], [box.right + 2, y]]
              .every(point => document.elementFromPoint(point[0]!, point[1]!) === pill) };
        });
        assert.ok(tap.width >= 44 && tap.height >= 44 && tap.edges, `Morning's pill has a 44px tap area at ${width}px (${JSON.stringify(tap)})`);
        console.log('MORNING HOME FOLD', width, top);
        await page.goto('/morning'); let state = await read(); await shown(page, state);
        assert.equal(await page.locator('header.top + #tk-strip').count(), 1);
        assert.equal(await page.locator('head link[href="/assets/fonts.css"]').count(), 1);
        assert.match(await page.locator('#mn-progress').innerText(), /\d/);
        await fit(page, `sample first card ${width}`);
        if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/morning-${width}-initial.png`});
        await openSheet(page, '#mn-figure');
        for (const word of ['why', 'rule', 'source']) assert.ok((await page.locator('#mn-dialog').innerText()).toLowerCase().includes(word));
        await closeSheet(page, '#mn-figure');
        await openSheet(page, '#mn-good'); await closeSheet(page, '#mn-good');
        const originalCompleted = state.completed;
        const stripNext = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/ticker/next');
        const afterStripNext = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/morning');
        await page.locator('#tk-next').click(); assert.equal((await stripNext).status(), 200);
        state = await (await afterStripNext).json() as MorningSnapshot; await shown(page, state);
        assert.equal(state.completed, originalCompleted, 'A strip pass refreshes Morning without adding a date to decision progress');
        const stripRestore = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/ticker/restore');
        const afterStripRestore = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/morning');
        await page.locator('#tk-undo').click(); assert.equal((await stripRestore).status(), 200);
        state = await (await afterStripRestore).json() as MorningSnapshot; await shown(page, state);
        assert.equal(state.completed, originalCompleted, 'Strip Undo leaves decision progress unchanged');
        const apply = async (selector: string | Locator, button: MorningButton): Promise<MorningSnapshot> => {
          assert.equal(button.kind, 'save');
          if (button.kind !== 'save') throw new Error('Expected local save');
          const path = button.target === 'ticker' ? `/api/ticker/${button.action}` : '/api/morning/press';
          const response = page.waitForResponse(reply => new URL(reply.url()).pathname === path && reply.request().method() === 'POST');
          await (typeof selector === 'string' ? page.locator(selector) : selector).click();
          if (button.target === 'morning' && button.confirm) {
            await page.locator('#mn-confirm').waitFor({state: 'visible'}); await page.locator('#mn-confirm').click();
          }
          assert.equal((await response).status(), 200);
          const next = await read(); await shown(page, next); await focusAfterSave(page, next); return next;
        };
        const kill = state.cards[0]!;
        assert.equal(kill.kind, 'meta-kill');
        assert.equal(kill.secondary?.label, 'One more day');
        const undoHold = async (): Promise<MorningSnapshot> => {
          const response = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/morning/press' && reply.request().method() === 'POST');
          await page.locator('#mn-undo').click();
          const saved = await response; assert.equal(saved.status(), 200);
          assert.deepEqual(saved.request().postDataJSON(), {cardKey: kill.key, action: 'undo'});
          const next = await read(); await shown(page, next); await focusAfterSave(page, next);
          assert.equal(next.cards[0]?.key, kill.key);
          assert.equal(await page.locator('#mn-undo').innerText(), 'Hold again');
          return next;
        };
        for (const days of [3, 7] as const) {
          const button = state.cards[0]!.menu.find(button => button.label === `Hold ${days} days`);
          assert.ok(button?.kind === 'save' && button.target === 'morning' && button.action === 'hold');
          await openSheet(page, '#mn-menu');
          const request = page.waitForRequest(request => new URL(request.url()).pathname === '/api/morning/press' && request.method() === 'POST');
          state = await apply(page.locator('#mn-sheet-body').getByRole('button', {name: `Hold ${days} days`, exact: true}), button);
          assert.deepEqual((await request).postDataJSON(), {cardKey: kill.key, action: 'hold', days});
          assert.equal(await page.locator('#mn-confirm').count(), 0, 'A local hold needs no confirmation');
          const untilDay = addDays(state.day, days);
          assert.equal(state.answers.find(row => row.cardKey === kill.key)?.untilDay, untilDay);
          assert.ok((await page.locator('#mn-toast-message').innerText()).includes(`Held here until ${morningDay(untilDay)}. Nothing changed in Meta.`));
          state = await undoHold();
          const heldAgain = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/morning/press' && reply.request().method() === 'POST');
          await page.locator('#mn-undo').click();
          const repeated = await heldAgain; assert.equal(repeated.status(), 200);
          assert.deepEqual(repeated.request().postDataJSON(), {cardKey: kill.key, action: 'hold', days}, 'Hold again preserves the selected duration');
          state = await read(); await shown(page, state); await focusAfterSave(page, state);
          assert.equal(state.answers.find(row => row.cardKey === kill.key)?.untilDay, untilDay);
          state = await undoHold();
        }
        const first = state.cards[0]!, firstSave = first.secondary?.kind === 'save' ? first.secondary : first.primary;
        const firstSelector = first.secondary?.kind === 'save' ? '#mn-secondary' : '#mn-primary';
        await page.route('**/api/morning/press', route => route.fulfill({status: 503, json: {error: 'Invented save failure.'}}), {times: 1});
        await page.locator(firstSelector).click(); await page.locator('#mn-error').waitFor({state: 'visible'});
        assert.equal(await page.locator('#mn-card').getAttribute('data-mn-card'), first.key);
        assert.equal((await read()).completed, state.completed, 'A failed save cannot consume a slot');
        await page.emulateMedia({reducedMotion: 'reduce'});
        state = await apply(firstSelector, firstSave);
        assert.match(await page.locator('#mn-toast-message').innerText(), /Back tomorrow with new figures/);
        assert.equal(await page.locator('#mn-root').evaluate(element => element.getAnimations({subtree: true}).filter(animation => animation.playState === 'running').length), 0,
          'Reduced motion also applies during save feedback');
        await page.locator('#mn-undo').waitFor({state: 'visible'});
        const undoBox = (await page.locator('#mn-undo').boundingBox())!; assert.ok(undoBox.width >= 68 && undoBox.height >= 44);
        const undoResponse = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/morning/press');
        await page.locator('#mn-undo').click(); assert.equal((await undoResponse).status(), 200);
        state = await read(); await shown(page, state); await focusAfterSave(page, state); assert.equal(state.cards[0]!.key, first.key);
        await page.emulateMedia({reducedMotion: 'no-preference'});
        let copied = false, linked = false, menuOpened = false, putBack = false, hiddenPutBack = false;
        const initialOpenCount = state.cards.length + state.more;
        for (let count = 0; state.cards.length && count < initialOpenCount; count++) {
          const current = state.cards[0]!;
          await fit(page, `${width} ${current.kind}`);
          assert.ok(![current.primary, current.secondary, ...current.menu].some(button => button?.kind === 'live'), 'Sample cards never offer a Meta write');
          if (!linked && current.primary.kind === 'link' && current.primary.href.startsWith('/')) {
            await page.locator('#mn-primary').click(); await page.waitForURL(url => url.pathname !== '/morning');
            await page.goto('/morning'); await shown(page, state); linked = true;
          }
          if (!copied && current.primary.kind === 'copy') {
            await openSheet(page, '#mn-primary');
            assert.equal(await page.locator('#mn-copy-text').inputValue(), current.primary.text);
            await page.locator('#mn-copy').click();
            assert.equal(await page.evaluate(() => (window as unknown as {__morningClipboard: string[]}).__morningClipboard.at(-1)), current.primary.text);
            assert.match(await page.locator('#mn-toast-message').innerText(), /Copied\. You send it\./);
            if (await page.locator('#mn-dialog').isVisible()) await closeSheet(page, '#mn-primary');
            copied = true;
          }
          if (!menuOpened && current.menu.length) {
            await openSheet(page, '#mn-menu');
            for (const row of await page.locator('#mn-sheet-body button, #mn-sheet-body a').all()) {
              if (await row.isVisible()) assert.ok((await row.boundingBox())!.height >= 52, 'Menu rows have 52px taps');
            }
            await closeSheet(page, '#mn-menu'); menuOpened = true;
          }
          if (process.env.PULSE_SCREENSHOT_DIR && ['make-next', 'fading', 'test-call', 'meta-kill'].includes(current.kind))
            await page.screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/morning-${width}-${current.kind}.png`});
          const dateDone = current.menu.find(button => button.kind === 'save' && button.target === 'ticker' && button.action === 'next');
          if (current.kind === 'date' && dateDone) {
            await openSheet(page, '#mn-menu');
            state = await apply(page.locator('#mn-sheet-body').getByRole('button', {name: /Done, move on/}), dateDone);
            const restored = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/ticker/restore');
            await page.locator('#mn-undo').click(); assert.equal((await restored).status(), 200);
            state = await read(); await shown(page, state); await focusAfterSave(page, state);
            assert.equal(state.cards[0]!.key, current.key, 'Morning’s date Undo restores the card and strip together');
            const ticker = await (await context.request.get('/api/ticker')).json() as TickerSnapshot;
            assert.ok(ticker.ahead.some(row => row.key === current.eventKey));
          }
          let button = current.primary.kind === 'save' ? current.primary : current.secondary;
          let selector: string | Locator = current.primary.kind === 'save' ? '#mn-primary' : '#mn-secondary';
          const hide = current.menu.find(button => button.kind === 'save' && button.target === 'morning' && button.action === 'hide');
          if (!hiddenPutBack && hide) {
            await openSheet(page, '#mn-menu'); button = hide;
            selector = page.locator('#mn-sheet-body').getByRole('button', {name: /Stop showing this/});
          }
          assert.ok(button?.kind === 'save', 'Every sample card has a local way to clear it');
          state = await apply(selector, button!);
          if (await page.locator('#mn-dialog').isVisible()) await closeSheet(page);
          const hidden = state.hidden.some(row => row.stateRow.cardKey === current.key);
          if ((!putBack && state.parked.some(row => row.stateRow.cardKey === current.key)) || (!hiddenPutBack && hidden)) {
            await openSheet(page, '#mn-good');
            if (!await page.locator(`#mn-sheet-body [data-mn-put-back="${current.key}"]`).isVisible()) await page.locator('#mn-away-more').click();
            const response = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/morning/press');
            await page.locator(`#mn-sheet-body [data-mn-put-back="${current.key}"]`).click(); assert.equal((await response).status(), 200);
            state = await read(); await shown(page, state); await focusAfterSave(page, state);
            if (await page.locator('#mn-dialog').isVisible()) await closeSheet(page);
            assert.equal(state.cards[0]!.key, current.key);
            if (hidden) {
              await openSheet(page, '#mn-menu');
              state = await apply(page.locator('#mn-sheet-body').getByRole('button', {name: /Stop showing this/}), button!);
              if (await page.locator('#mn-dialog').isVisible()) await closeSheet(page);
              hiddenPutBack = true;
            } else { state = await apply(selector, button!); putBack = true; }
          }
        }
        assert.equal(state.cards.length, 0); assert.ok(linked && putBack, 'The real decision deck exercises links and persisted Put back; copy/hide/menu are covered below with explicit fixtures');
        await page.locator('#mn-all-clear').waitFor(); assert.match(await page.locator('#mn-done-list').innerText(), /.+/);
        await page.reload(); await shown(page, await read()); assert.equal(await page.locator('#mn-all-clear').count(), 1);
        await page.route('**/api/morning/press', route => route.fulfill({status: 503, json: {error: 'Invented Put back failure.'}}), {times: 1});
        await page.locator('#mn-done-list [data-mn-put-back]').first().click();
        await page.locator('#mn-error').waitFor({state: 'visible'});
        assert.match(await page.locator('#mn-error').innerText(), /Invented Put back failure/);
        assert.equal((await read()).cards.length, 0, 'Failed All clear Put back retains the completed deck');
        assert.match(await page.locator('#mn-good').innerText(), new RegExp(`Good · ${state.fine.length} fine`));
        if (state.watchOnHome) assert.match(await page.locator('#mn-all-clear').innerText(), new RegExp(`${state.watchOnHome} Watch cards? (?:is|are) on Home`));
        await openSheet(page, '#mn-good');
        if (state.parked.length + state.hidden.length > 3) {
          assert.equal(await page.locator('#mn-away-list [data-mn-put-back]:visible').count(), 3);
          await page.locator('#mn-away-more').click();
          assert.equal(await page.locator('#mn-away-list [data-mn-put-back]:visible').count(), state.parked.length + state.hidden.length);
        }
        await closeSheet(page, '#mn-good');
        if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/morning-${width}-all-clear.png`});
      } finally { await page.close(); await clean(); }
    }
    assert.equal(metaRequests, 0, 'The real sample walk makes no Meta action request');

    const fixturePage = await context.newPage();
    const base = await read(), cards = fixtureCards(base);
    let fixture: MorningSnapshot = {...base, cards: [cards[0]!], more: 0, completed: 0, total: 1, presses: [], parked: [], hidden: [], answers: [], metaActions: [], passedDates: []};
    let morningReads = 0;
    await fixturePage.route('**/api/morning', route => {morningReads++; return route.fulfill({json: fixture});});
    try {
      await fixturePage.goto('/morning'); await shown(fixturePage, fixture);
      for (const viewport of [{width: 390, height: 844}, {width: 375, height: 667}, {width: 1280, height: 960}]) {
        await fixturePage.setViewportSize(viewport);
        for (const card of cards) {
          fixture = {...fixture, cards: [card]};
          await fixturePage.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await shown(fixturePage, fixture);
          await fit(fixturePage, `${viewport.width}x${viewport.height} ${card.kind}/${card.figure.kind}`);
          if (card.figure.kind === 'brief') {
            for (const window of ['1', '3', '7'] as const) {
              await fixturePage.locator(`[data-mn-window="${window}"]`).click();
              await openSheet(fixturePage, '#mn-figure');
              assert.ok((await fixturePage.locator('#mn-sheet-body').innerText()).includes(card.figure.variants[window].text));
              await closeSheet(fixturePage, '#mn-figure');
            }
          }
          if (process.env.PULSE_SCREENSHOT_DIR && viewport.width === 375 && ['need', 'meta-step', 'make-next', 'fading', 'meta-kill', 'test-call'].includes(card.kind))
            await fixturePage.screenshot({path: `${process.env.PULSE_SCREENSHOT_DIR}/morning-375-${card.kind}.png`});
        }
      }
      for (const selector of ['#mn-good', '#mn-menu', '#mn-figure']) {
        await openSheet(fixturePage, selector);
        const openerBeforeRefresh = await fixturePage.locator(selector).elementHandle(); assert.ok(openerBeforeRefresh);
        await fixturePage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await fixturePage.waitForFunction(element => !element.isConnected, openerBeforeRefresh);
        await closeSheet(fixturePage, selector); await openerBeforeRefresh.dispose();
      }
      // Copy and hiding remain supported for eligible cards even when the base sample deck has none.
      const copyCard: MorningCard = {...cards[0]!, key: 'invented-copy-decision', kind: 'google', state: 'decide',
        primary: {kind: 'copy', label: 'Copy a message', text: 'Invented freelancer message'}};
      fixture = {...fixture, cards: [copyCard], completed: 0, total: 1};
      await fixturePage.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await shown(fixturePage, fixture);
      await openSheet(fixturePage, '#mn-primary');
      assert.equal(await fixturePage.locator('#mn-copy-text').inputValue(), 'Invented freelancer message');
      const copyOpenerBeforeRefresh = await fixturePage.locator('#mn-primary').elementHandle(); assert.ok(copyOpenerBeforeRefresh);
      await fixturePage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await fixturePage.waitForFunction(element => !element.isConnected, copyOpenerBeforeRefresh);
      await copyOpenerBeforeRefresh.dispose();
      await fixturePage.locator('#mn-copy').click();
      assert.equal(await fixturePage.evaluate(() => (window as unknown as {__morningClipboard: string[]}).__morningClipboard.at(-1)), 'Invented freelancer message');
      assert.match(await fixturePage.locator('#mn-toast-message').innerText(), /Copied\. You send it\./);
      if (await fixturePage.locator('#mn-dialog').isVisible()) await closeSheet(fixturePage, '#mn-primary');
      await fixturePage.waitForFunction(() => document.activeElement?.id === 'mn-primary');
      const hidden: MorningState = {mode: fixture.mode, cardKey: copyCard.key, state: 'hidden', untilDay: null,
        factsHash: copyCard.factsHash, answer: null, credentialId: 'invented-browser', pressedAt: `${fixture.day}T10:00:00Z`,
        clearedAt: null, title: copyCard.title, kind: copyCard.kind, subjectId: copyCard.subjectId, sourceScope: copyCard.sourceScope};
      const localCommands: object[] = [];
      await fixturePage.route('**/api/morning/press', route => {
        const body = route.request().postDataJSON(); localCommands.push(body);
        fixture = body.action === 'hide' ? {...fixture, cards: [], completed: 1, presses: [hidden],
          hidden: [{stateRow: hidden, title: hidden.title, reason: 'Stopped showing until the rule changes', untilDay: null}]}
          : {...fixture, cards: [copyCard], completed: 0, presses: [], hidden: []};
        return route.fulfill({json: fixture});
      });
      await openSheet(fixturePage, '#mn-menu');
      for (const row of await fixturePage.locator('#mn-sheet-body button').all())
        assert.ok((await row.boundingBox())!.height >= 52, 'Menu rows retain 52px taps');
      await fixturePage.locator('#mn-sheet-body').getByRole('button', {name: 'Stop showing this'}).click();
      await fixturePage.locator('#mn-all-clear').waitFor();
      if (await fixturePage.locator('#mn-dialog').isVisible()) await closeSheet(fixturePage);
      await openSheet(fixturePage, '#mn-good');
      await fixturePage.locator(`#mn-sheet-body [data-mn-put-back="${copyCard.key}"]`).click();
      await shown(fixturePage, {...fixture, cards: [copyCard], completed: 0});
      if (await fixturePage.locator('#mn-dialog').isVisible()) await closeSheet(fixturePage, '#mn-good');
      assert.deepEqual(localCommands, [{cardKey: copyCard.key, action: 'hide'}, {cardKey: copyCard.key, action: 'undo'}]);
      await fixturePage.unroute('**/api/morning/press');
      await fixturePage.emulateMedia({reducedMotion: 'reduce'});
      assert.equal(await fixturePage.locator('#mn-root').evaluate(element => element.getAnimations({subtree: true}).filter(animation => animation.playState === 'running').length), 0);
      const live = {...cards[1]!, key: 'invented-live-action', primary: {kind: 'live', label: 'Pause invented set', adSetId: '990099', action: 'pause', value: 'PAUSED', confirm: 'Pause invented set now?'} as MorningButton};
      fixture = {...fixture, mode: 'live', cards: [live]};
      await fixturePage.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await shown(fixturePage, fixture);
      let attempts = 0; const beforeFailureRead = morningReads;
      await fixturePage.route('**/api/meta/adset/990099', async route => {
        attempts++; assert.deepEqual(route.request().postDataJSON(), {action: 'pause', value: 'PAUSED'});
        await route.fulfill({status: 409, json: {error: 'Invented action is no longer available.'}});
      });
      await fixturePage.locator('#mn-primary').click(); await fixturePage.locator('#mn-confirm').waitFor({state: 'visible'});
      assert.equal(attempts, 0); await fixturePage.locator('#mn-cancel').click(); assert.equal(attempts, 0);
      await fixturePage.locator('#mn-primary').click(); await fixturePage.locator('#mn-confirm').click();
      await fixturePage.locator('#mn-error').waitFor({state: 'visible'});
      assert.equal(attempts, 1); assert.ok(morningReads > beforeFailureRead, 'A failed live action reconciles from Morning'); assert.equal(await fixturePage.locator('#mn-card').getAttribute('data-mn-card'), live.key);
      assert.match(await fixturePage.locator('#mn-error').innerText(), /Invented action is no longer available/);
      await fixturePage.unroute('**/api/meta/adset/990099');
      const nextLive = {...live, key: 'invented-next-live-action', primary: {kind: 'live', label: 'Step invented second set', adSetId: '990098', action: 'budget', value: 6, confirm: 'Step invented second set from £5 to £6 a day?'} as MorningButton};
      const commands: object[] = [];
      await fixturePage.route('**/api/meta/adset/*', async route => {
        const body = route.request().postDataJSON(); commands.push(body);
        if (body.action === 'pause') {
          fixture = {...fixture, cards: [nextLive], completed: 1, total: 2};
          await new Promise(resolve => setTimeout(resolve, 10_500));
          await route.fulfill({json: {id: 'invented-action', refreshed: true}});
        } else await route.fulfill({status: 409, json: {error: 'Invented second action refused.'}});
      });
      await fixturePage.locator('#mn-primary').click(); await fixturePage.locator('#mn-confirm').click();
      await fixturePage.waitForFunction(() => document.querySelector('#mn-card')?.getAttribute('data-mn-card') === 'invented-next-live-action');
      await focusAfterSave(fixturePage, fixture);
      await fixturePage.locator('#mn-primary').click(); await fixturePage.locator('#mn-confirm').waitFor({state: 'visible'});
      await fixturePage.locator('#mn-undo').click(); await fixturePage.locator('#mn-dialog').waitFor({state: 'visible'});
      await fixturePage.locator('#mn-dialog #mn-cancel').click();
      assert.equal(await fixturePage.locator('#mn-toast').isVisible(), true, 'Cancelling live Undo retains the original eight-second toast');
      assert.equal(await fixturePage.locator('#mn-undo').isVisible(), true);
      if (!await fixturePage.locator('#mn-confirm').isVisible()) await fixturePage.locator('#mn-primary').click();
      assert.match(await fixturePage.locator('#mn-card').innerText(), /Step invented second set from £5 to £6 a day/);
      await fixturePage.locator('#mn-confirm').click(); await fixturePage.locator('#mn-error').waitFor({state: 'visible'});
      assert.deepEqual(commands, [{action: 'pause', value: 'PAUSED'}, {action: 'budget', value: 6}],
        'Dismissing a previous action’s Undo cannot replace the card’s pending command');
      fixture = {...fixture, day: addDays(fixture.day, 1)};
      await fixturePage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      const expectedDay = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short'})
        .format(new Date(`${fixture.day}T12:00:00Z`)).replaceAll(',', '');
      await fixturePage.waitForFunction(day => document.querySelector('#mn-day')?.textContent?.includes(day), expectedDay);
    } finally { await fixturePage.close(); }

    await checkMorningPauseAll(context);
    await checkMorningRuleSettings(context);
    const settingsPage = await context.newPage();
    try {
      await setFirst(false); await context.clearCookies({name: 'pulse_morning_day'});
      assert.equal((await context.request.get('/', {maxRedirects: 0})).status(), 200);
      await settingsPage.goto('/settings');
      const toggle = settingsPage.locator('input[name="morningOpensFirst"]');
      await toggle.locator('xpath=ancestor::details').evaluate((element: Element) => { (element as HTMLDetailsElement).open = true; });
      assert.equal(await toggle.isChecked(), false); await toggle.check();
      await settingsPage.locator('#settings-save').click();
      await settingsPage.waitForFunction(() => document.querySelector('#settings-message')?.textContent === 'Settings saved.');
      const first = await context.request.get('/', {maxRedirects: 0});
      assert.equal(first.status(), 302); assert.equal(first.headers().location, '/morning'); assert.equal(first.headers()['cache-control'], 'no-store');
      assert.equal((await context.request.get('/?from=morning', {maxRedirects: 0})).status(), 200, 'The Home escape works without a marker');
      await settingsPage.goto('/morning'); await shown(settingsPage, await read());
      const marker = (await context.cookies()).find(cookie => cookie.name === 'pulse_morning_day')!;
      assert.equal(marker.value, (await read()).day); assert.equal(marker.httpOnly, true); assert.equal(marker.sameSite, 'Strict'); assert.equal(marker.path, '/');
      assert.equal(marker.secure, new URL(origin).protocol === 'https:');
      assert.ok(marker.expires - Date.now() / 1000 > 172_000 && marker.expires - Date.now() / 1000 <= 172_801);
      assert.equal((await context.request.get('/', {maxRedirects: 0})).status(), 200);
      await context.addCookies([{...marker, value: addDays(marker.value, -1)}]);
      assert.equal((await context.request.get('/', {maxRedirects: 0})).status(), 302);
      await settingsPage.goto('/morning');
      assert.equal(await settingsPage.locator('.mn-nav a[href="/?from=morning"]').count(), 1);
      await setFirst(false); assert.equal((await context.request.get('/', {maxRedirects: 0})).status(), 200);
      const unsigned = await browser.newContext({baseURL: origin});
      try {
        for (const path of ['/morning', '/']) {
          const response = await unsigned.request.get(path, {maxRedirects: 0}); assert.equal(response.status(), 302); assert.equal(response.headers().location, '/login');
        }
      } finally { await unsigned.close(); }
    } finally { await settingsPage.close(); }
    assert.deepEqual(errors, []); assert.equal(external, 0);
    console.log('Morning checks passed: sample deck, local Undo and Put back, sheets/copy/link, every card fit, reduced motion, live confirmation failure, daily redirect and exact Home folds.');
  } finally {
    try { await clean(); await setFirst(originalSettings.values.morningOpensFirst); }
    finally { await context.close(); }
  }
}
