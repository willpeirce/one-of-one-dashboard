import assert from 'node:assert/strict';
import type {BrowserContext} from 'playwright';
import type {CreativeAdPage, CreativeLibrary, CreativeSheet} from '../src/creatives/presentation-types.js';

/** The Library lists compact groups, then reads a selected group's stored ads in bounded pages. */
export async function checkCreativeLazyAds(signedIn: BrowserContext): Promise<void> {
  const overviewResponse = await signedIn.request.get('/api/creatives'); assert.equal(overviewResponse.status(), 200);
  const overview = await overviewResponse.json() as CreativeLibrary;
  for (const group of [...overview.groups, ...overview.top.groups]) assert.equal(Object.hasOwn(group, 'ads'), false);
  const groups = overview.groups.filter(group => group.group.kind === 'image'); assert.ok(groups.length >= 2);
  const first = groups[0]!, second = groups[1]!, firstId = first.group.id, secondId = second.group.id;
  const originalResponse = await signedIn.request.get(`/api/creatives/${encodeURIComponent(firstId)}`);
  assert.equal(originalResponse.status(), 200);
  const sheet = await originalResponse.json() as CreativeSheet; assert.ok(sheet.ads[0]);
  const ads = Array.from({length: 125}, (_, index) => ({...sheet.ads[0]!, id: `830000000000${String(index).padStart(3, '0')}`,
    name: `Invented ad ${index + 1}`, adSetId: `84000000000000${index % 3}`, adSetName: `Invented set ${index % 3 + 1}`,
    title: `Invented title ${index + 1}`, body: `Invented copy ${index + 1}`}));
  const version = 'a'.repeat(43), accountId = overview.accountId;
  sheet.ads = ads.slice(0, 50); sheet.group.ads = sheet.ads;
  sheet.adPage = {total: ads.length, adSetCount: 3, nextOffset: 50, version, accountId};
  const origin = new URL(overviewResponse.url()).origin, browser = signedIn.browser(); assert.ok(browser);
  // Deliberate HTTP errors use an isolated signed-in context; every other error remains a failure.
  const context = await browser.newContext({baseURL: origin, storageState: await signedIn.storageState(), viewport: {width: 390, height: 844}, reducedMotion: 'reduce'});
  const errors: string[] = [], expectedErrors: string[] = [];
  let consumed = 0, external = 0;
  context.on('page', opened => {
    opened.on('pageerror', error => errors.push(error.name));
    opened.on('console', message => {
      if (message.type() !== 'error') return;
      const index = expectedErrors.indexOf(message.location().url);
      if (index >= 0 && /^Failed to load resource: the server responded with a status of 503 \([^)]*\)$/.test(message.text())) {
        expectedErrors.splice(index, 1); consumed++; return;
      }
      errors.push('Unexpected creative paging console error');
    });
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || route.request().method() !== 'GET') {external++; await route.abort('blockedbyclient');}
    else await route.continue();
  });
  const page = await context.newPage(), offsets: number[] = [];
  let servedSheet = sheet;
  let detailReads = 0, failed = false, delayed = false, releaseLast!: () => void;
  const release = new Promise<void>(resolve => {releaseLast = resolve;});
  page.on('request', request => {if (/^\/api\/creatives\/[^/]+$/.test(new URL(request.url()).pathname)) detailReads++;});
  try {
    await page.route(url => url.pathname === `/api/creatives/${firstId}`, route => route.fulfill({json: servedSheet}));
    await page.route(url => url.pathname === `/api/creatives/${firstId}/ads`, async route => {
      const url = new URL(route.request().url()), offset = Number(url.searchParams.get('offset'));
      assert.equal(url.searchParams.get('version'), version); assert.ok(offset === 50 || offset === 100);
      offsets.push(offset);
      if (!failed) {
        failed = true; expectedErrors.push(route.request().url());
        await route.fulfill({status: 503, json: {error: 'Invented stored read failure'}}); return;
      }
      if (offset === 100 && !delayed) {delayed = true; await release;}
      const body: CreativeAdPage = {groupId: firstId, mode: sheet.mode, accountId, version,
        ads: ads.slice(offset, offset + 50), nextOffset: offset + 50 < ads.length ? offset + 50 : null};
      await route.fulfill({json: body});
    });
    await page.goto('/creatives'); await page.locator('#creative-gallery .creative-tile').first().waitFor();
    const ids = () => page.locator('#creative-gallery .creative-tile').evaluateAll(rows => rows.map(row => row.getAttribute('data-group-id')));
    assert.deepEqual(await ids(), overview.groups.map(group => group.group.id), 'The first response keeps Library group order and count');
    assert.equal(detailReads, 0, 'Opening the Library does not fetch any group ad list');
    const filtered = page.waitForResponse(response => {
      const url = new URL(response.url()); return url.pathname === '/api/creatives' && url.searchParams.get('kind') === 'image';
    });
    await page.locator('#creative-filters [name="kind"]').selectOption('image');
    const imageView = await (await filtered).json() as CreativeLibrary;
    await page.waitForFunction(expected => JSON.stringify(Array.from(document.querySelectorAll('#creative-gallery .creative-tile')).map(row => row.getAttribute('data-group-id'))) === JSON.stringify(expected), imageView.groups.map(group => group.group.id));
    assert.deepEqual(await ids(), groups.map(group => group.group.id), 'Filtering retains the same image groups in the same order');
    assert.equal(detailReads, 0, 'Filtering the Library still needs no ad list');
    await page.locator(`#creative-gallery [data-group-id="${firstId}"] [data-creative-open]`).click();
    await page.locator('[data-creative-ads-retry]').waitFor();
    const rows = page.locator('[data-creative-ad-list] > li');
    assert.equal(await rows.count(), 50, 'A page failure keeps the first fifty ads visible');
    assert.deepEqual(offsets, [50], 'A failed page is not automatically retried');
    assert.match(await page.locator('[data-creative-ads-status]').innerText(), /Could not load more ads.*50 of 125 shown.*Try again/);
    assert.match(await page.locator('#creative-sheet-body').innerText(), /125 ads · 3 ad sets/);
    const retry = page.locator('[data-creative-ads-retry]'), bounds = await retry.boundingBox();
    assert.ok(bounds && bounds.height >= 44 && bounds.width >= 44, `The new ad-page retry must be a 44px target: ${JSON.stringify(bounds)}`);
    const lastPageRequested = page.waitForRequest(request => new URL(request.url()).pathname === `/api/creatives/${firstId}/ads`
      && new URL(request.url()).searchParams.get('offset') === '100');
    await retry.click(); await lastPageRequested;
    assert.equal(await rows.count(), 100);
    assert.deepEqual(offsets, [50, 50, 100], 'Explicit retry resumes the failed page before the next one');
    await page.locator('[data-creative-close]').click();
    await page.locator(`#creative-gallery [data-group-id="${secondId}"] [data-creative-open]`).click();
    await page.locator('#creative-sheet-title').filter({hasText: second.group.title}).waitFor();
    const secondRows = await rows.allTextContents();
    const finished = page.waitForResponse(response => new URL(response.url()).pathname === `/api/creatives/${firstId}/ads`
      && new URL(response.url()).searchParams.get('offset') === '100');
    releaseLast(); await finished;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await page.locator('#creative-sheet-title').innerText(), second.group.title);
    assert.deepEqual(await rows.allTextContents(), secondRows, 'A delayed page cannot replace another selected group');
    await page.locator('[data-creative-close]').click();
    await page.locator(`#creative-gallery [data-group-id="${firstId}"] [data-creative-open]`).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-creative-ad-list] > li').length === 125);
    assert.deepEqual(await rows.allTextContents(), ads.map(ad => `${ad.name} · ${ad.adSetName} · ${ad.effectiveStatus}`));
    assert.deepEqual(offsets, [50, 50, 100, 50, 100]);
    assert.equal(await page.locator('[data-creative-ads-retry]').isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const changed of ['account', 'mode']) {
      await page.locator('[data-creative-close]').click();
      servedSheet = structuredClone(sheet);
      if (changed === 'account') servedSheet.adPage!.accountId = 'act_880000000000002';
      else servedSheet.mode = sheet.mode === 'sample' ? 'live' : 'sample';
      await page.locator(`#creative-gallery [data-group-id="${firstId}"] [data-creative-open]`).click();
      await page.locator('#creative-sheet-title').filter({hasText: 'Creative changed'}).waitFor();
      assert.match(await page.locator('#creative-sheet-body').innerText(), /Close, refresh the Library and open it again/);
      assert.equal(await rows.count(), 0, 'A sheet from another account or source mode never renders its ads');
      assert.deepEqual(offsets, [50, 50, 100, 50, 100], 'A mismatched initial sheet cannot start further page reads');
    }
    assert.deepEqual(errors, []); assert.deepEqual(expectedErrors, []); assert.equal(consumed, 1); assert.equal(external, 0);
  } finally {releaseLast(); await context.close();}
}
