import assert from 'node:assert/strict';
import type { BrowserContext, Page } from 'playwright';
import { dashboardPage } from '../src/dashboard-view.js';
import type { DashboardSnapshot } from '../src/dashboard-types.js';
import { defaultSettings, type Settings } from '../src/settings.js';
import type { CreativeData } from '../src/creatives/model.js';
import type { CreativeSelection, CreativeView, CreativeSheet } from '../src/creatives/presentation-types.js';
import { aggregateCreativeGroups, topCreatives } from '../src/creatives/ranking.js';
import { creativePerformance } from '../src/creatives/performance.js';
import { sampleCreativeData, sampleCreativePicture } from '../src/creatives/sample.js';

// Invented 1-second purple video, no source media. Regenerate with:
// ffmpeg -f lavfi -i color=c=0x7161ef:s=64x64:d=1:r=12 -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart invented.mp4
const inventedMp4 = Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAPBbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAux0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAIAAABAAAAAAJkbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAMABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACD21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAc9zdGJsAAAAv3N0c2QAAAAAAAAAAQAAAK9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFUxhdmM2MS4xOS4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANWF2Y0MBZAAK/+EAGGdkAAqs2UQmwEQAAAMABAAAAwBgPEiWWAEABmjr48siwP34+AAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAbqAAAAAAAAAAYc3R0cwAAAAAAAAABAAAADAAABAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAAGhjdHRzAAAAAAAAAAsAAAABAAAIAAAAAAEAABQAAAAAAQAACAAAAAABAAAAAAAAAAEAAAQAAAAAAQAAFAAAAAABAAAIAAAAAAEAAAAAAAAAAQAABAAAAAABAAAQAAAAAAIAAAQAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAMAAAAAQAAAERzdHN6AAAAAAAAAAAAAAAMAAAC2wAAAA4AAAAMAAAADAAAAAwAAAAUAAAADgAAAAwAAAAMAAAAFAAAAA4AAAAMAAAAFHN0Y28AAAAAAAAAAQAAA/EAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYxLjcuMTAzAAAACGZyZWUAAAN9bWRhdAAAAq4GBf//qtxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjQgcjMxMDggMzFlMTlmOSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjMgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0yIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0xMiBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAACVliIQAEP/+5sD5lioc4AmQVAW0i5SXikjqwoiXld3s2hvheG3hAAAACkGaJGxBD/6qV94AAAAIQZ5CeIb/B30AAAAIAZ5hdEM/CAgAAAAIAZ5jakM/CAkAAAAQQZpoSahBaJlMCH///qmdNQAAAApBnoZFESw3/wd9AAAACAGepXRDPwgJAAAACAGep2pDPwgIAAAAEEGaq0moQWyZTAhn//6eLfAAAAAKQZ7JRRUsN/8HfQAAAAgBnupqQz8ICA==', 'base64');

function fixtureView(base: CreativeView, data: CreativeData, settings: Settings, today: string, selection: CreativeSelection): CreativeView {
  return { ...base, selection, top: topCreatives(data, settings, { ...selection, today }),
    groups: aggregateCreativeGroups(data, selection), performance: creativePerformance(data, settings, { ...selection, today }) };
}

async function noOverflow(page: Page): Promise<void> {
  const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  const scrollers = await page.locator('#creative-sheet *, #creative-gallery *').evaluateAll(elements => elements.filter(element => {
    const style = getComputedStyle(element);
    return element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1 && ['auto', 'scroll'].includes(style.overflowX) && !element.classList.contains('creative-tag-values');
  }).map(element => `${element.tagName}.${element.className}`));
  assert.deepEqual(scrollers, [], 'Only pill rows may scroll sideways');
  if (width.document > width.viewport) {
    if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/creatives-overflow.png`, fullPage: true });
    const escaped = await page.locator('body *').evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 12).map(element => `${element.tagName}.${element.className}: ${Math.round(element.getBoundingClientRect().width)}px`));
    assert.fail(`Creatives must fit ${width.viewport}px; document is ${width.document}px (${escaped.join(', ')})`);
  }
}

async function picturesAcross(page: Page, expected: number, width: number): Promise<void> {
  const pictures = page.locator('#creative-panel .creative-top .creative-picture');
  assert.equal(await pictures.count(), expected);
  const bounds = await pictures.evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, right: rect.right };
  }));
  assert.ok(bounds.every(bound => Math.abs(bound.y - bounds[0]!.y) < 1), 'All top pictures occupy one row');
  assert.ok(bounds.every((bound, index) => !index || bound.x >= bounds[index - 1]!.right), 'Top pictures do not overlap');
  if (width === 390) assert.ok(bounds.every(bound => bound.width >= 90 && bound.width <= 125), 'Phone pictures remain near 110px wide');
  await noOverflow(page);
}

export async function checkCreatives(context: BrowserContext): Promise<void> {
  const dashboard = await context.request.get('/api/dashboard');
  assert.equal(dashboard.status(), 200);
  const snapshot = await dashboard.json() as DashboardSnapshot & { creatives: CreativeView };
  assert.ok(snapshot.creatives, 'Home includes creative data before browser hydration');
  const settings = defaultSettings();
  const today = snapshot.bounds.today;
  const all = sampleCreativeData(settings, new Date(`${today}T12:00:00Z`));
  const imageData = structuredClone(all);
  const imageIds = new Set(imageData.groups.filter(group => group.kind === 'image').slice(0, 2).map(group => group.id));
  imageData.groups = imageData.groups.filter(group => imageIds.has(group.id));
  imageData.ads = imageData.ads.filter(ad => imageIds.has(ad.mediaGroupId));
  const imageAdIds = new Set(imageData.ads.map(ad => ad.id));
  imageData.insights = imageData.insights.filter(row => imageAdIds.has(row.adId));

  const page = await context.newPage();
  let fixture = snapshot;
  let data = all;
  let activeSettings = settings;
  const apiPattern = /\/api\/creatives(?:\?|$)/;
  try {
    await page.route('**/api/dashboard', route => route.fulfill({ json: fixture }));
    await page.route('**/api/events', route => route.fulfill({ contentType: 'text/event-stream',
      body: `retry: 60000\nevent: dashboard\ndata: ${JSON.stringify(fixture)}\n\n` }));
    await page.route('**/', route => route.fulfill({ contentType: 'text/html', body: dashboardPage(fixture) }));
    await page.route(apiPattern, route => {
      const query = new URL(route.request().url()).searchParams;
      const selection: CreativeSelection = {
        window: (query.get('window') ?? '3d') as CreativeSelection['window'],
        market: (query.get('market') ?? 'all') as CreativeSelection['market'],
        owner: (query.get('owner') ?? 'all') as CreativeSelection['owner'],
      };
      return route.fulfill({ json: fixtureView(snapshot.creatives, data, activeSettings, today, selection) });
    });
    await page.route('**/media/**', route => {
      const url = new URL(route.request().url());
      if (url.searchParams.has('play')) return route.fulfill({ contentType: 'video/mp4', body: inventedMp4 });
      return route.fulfill({ contentType: 'image/svg+xml', body: decodeURIComponent(sampleCreativePicture('Invented full image', 'image').split(',').slice(1).join(',')) });
    });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 960 });
      for (const scenario of ['videos', 'two-images', 'under-floor'] as const) {
        data = scenario === 'two-images' ? imageData : all;
        activeSettings = scenario === 'under-floor' ? { ...settings, creativeSpendFloorGbp: 100_000 } : settings;
        fixture = { ...snapshot, creatives: fixtureView(snapshot.creatives, data, activeSettings, today, { window: '3d', market: 'all', owner: 'all' }) };
        await page.goto('/');
        await page.locator('html[data-dashboard-ready="true"]').waitFor();
        await picturesAcross(page, scenario === 'two-images' ? 2 : 3, width);
        assert.equal(await page.locator('#creative-panel').evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector('#tabs')!) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
        assert.equal(await page.locator('#creative-ours').isChecked(), false);
        assert.equal(await page.locator('[data-creative-window="3d"]').getAttribute('aria-pressed'), 'true');
        if (scenario === 'two-images') {
          assert.match(await page.locator('.creative-floor').innerText(), /2 ads over £50 in 3 days/);
          assert.equal(await page.locator('#creative-panel .creative-play').count(), 0);
        } else assert.equal(await page.locator('#creative-panel .creative-play').count(), 3);
        if (scenario === 'under-floor') assert.match(await page.locator('.creative-floor').innerText(), /under the floor/);
        if (process.env.PULSE_SCREENSHOT_DIR) await page.locator('#creative-panel').screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/creatives-${scenario}-${width}.png` });
        if (scenario !== 'under-floor') {
          await page.locator('#creative-panel [data-creative-open]').first().click();
          await page.locator('#creative-sheet .creative-media').waitFor();
          assert.equal(await page.locator('#creative-sheet .creative-performance-table thead th[scope="col"]').count(), 5);
          assert.equal(await page.locator('#creative-sheet .creative-performance-table tbody tr').count(), scenario === 'videos' ? 9 : 6);
          assert.match(await page.locator('.creative-comparison').innerText(), /Meta says .* purchases in this window; Shopify saw .* orders in the same window/);
          if (scenario === 'videos') {
            const video = page.locator('#creative-sheet video');
            await video.evaluate(async element => { const player = element as HTMLVideoElement; player.muted = true; await player.play(); });
            await page.waitForFunction(() => (document.querySelector('#creative-sheet video') as HTMLVideoElement | null)?.currentTime! > 0);
            assert.equal(await video.getAttribute('playsinline'), '');
            assert.ok(await video.evaluate(element => (element as HTMLVideoElement).videoWidth > 0), 'The invented MP4 must actually decode');
          } else {
            assert.equal(await page.locator('#creative-sheet video').count(), 0);
            await page.waitForFunction(() => (document.querySelector('#creative-sheet img.creative-media') as HTMLImageElement | null)?.naturalWidth! > 0);
          }
          await noOverflow(page);
          const sheetBounds = await page.locator('#creative-sheet').boundingBox();
          assert.ok(sheetBounds && sheetBounds.width <= width && sheetBounds.x >= 0);
          if (process.env.PULSE_SCREENSHOT_DIR) await page.locator('#creative-sheet').screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/creative-sheet-${scenario}-${width}.png` });
          await page.locator('[data-creative-close]').click();
        }
        if (scenario === 'videos') {
          await page.locator('[data-creative-window="24h"]').click();
          await page.waitForFunction(() => document.querySelector('[data-creative-window="24h"]')?.getAttribute('aria-pressed') === 'true');
          assert.match(await page.locator('#creative-panel').innerText(), /Last complete UK day plus today so far/);
          await page.locator('[data-creative-window="7d"]').click();
          await page.waitForFunction(() => document.querySelector('[data-creative-window="7d"]')?.getAttribute('aria-pressed') === 'true');
          assert.match(await page.locator('#creative-panel').innerText(), /Last 7 UK days/);
          await page.locator('#creative-ours').check();
          await page.waitForFunction(() => Array.from(document.querySelectorAll('#creative-panel .creative-owner')).every(element => element.textContent?.startsWith('Ours')));
          await page.locator('#creative-ours').uncheck();
          await page.waitForFunction(() => Array.from(document.querySelectorAll('#creative-panel .creative-owner')).some(element => !element.textContent?.startsWith('Ours')));
          await page.locator('#market [data-market="uk"]').click();
          await page.waitForFunction(() => Boolean(document.querySelector('.creative-unplaced')));
          assert.match(await page.locator('.creative-unplaced').innerText(), /without a market.*under All/);
          await noOverflow(page);
        }
      }
    }
    await page.unroute(apiPattern);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 960 });
      await page.goto('/creatives');
      await page.locator('#creative-filters').waitFor();
      assert.ok(await page.locator('#creative-gallery .creative-picture').count() >= 6);
      assert.match(await page.locator('#creative-gallery').innerText(), /Video lifts/);
      assert.match(await page.locator('#creative-gallery').innerText(), /Image lifts/);
      assert.match(await page.locator('#creative-gallery').innerText(), /Strong/);
      assert.match(await page.locator('#creative-gallery').innerText(), /correlation, not a cause/);
      assert.match(await page.locator('[data-make-next="video"]').innerText(), /Next video:/);
      assert.match(await page.locator('[data-make-next="image"]').innerText(), /Next image:/);
      assert.match(await page.locator('[data-make-next="video"] [data-creative-copy]').getAttribute('data-creative-copy') ?? '', /Meta says.*cost per purchase/);
      await page.locator('[data-creative-tag="sample-video-3"]').click();
      await page.locator('#creative-tagging').waitFor();
      assert.ok(await page.locator('.creative-attribute').count() > 20);
      assert.equal(await page.locator('[data-creative-scan]').count(), 0, 'Scan now is absent in sample/off mode');
      assert.match(await page.locator('#creative-gallery [data-creative-scan-status]').innerText(), /Scan: off/);
      assert.match(await page.locator('[data-attribute="hookType"]').innerText(), /unsure|not scanned yet/);
      const documentStarted = await page.evaluate(() => performance.timeOrigin);
      const tag = async (key: string, value: string) => {
        const saved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/attributes'));
        await page.locator(`[data-tag-row="${key}"] [data-creative-tag-value="${value}"]`).click();
        assert.equal((await saved).status(), 200);
        await page.locator(`[data-tag-row="${key}"] .creative-tag-saved`).filter({ hasText: 'Saved' }).waitFor();
      };
      for (const [key, value] of [['hookType', 'claim'], ['slabEarly', 'yes'], ['productEarly', 'no']]) {
        await tag(key!, value!);
        assert.equal(await page.locator(`[data-tag-row="${key}"] [data-creative-tag-value="${value}"]`).getAttribute('aria-pressed'), 'true');
      }
      assert.equal(await page.evaluate(() => performance.timeOrigin), documentStarted, 'Pills save without reloading the page');
      const noteSaved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/attributes'));
      await page.locator('#creative-tag-note').fill('Invented browser note');
      assert.equal((await noteSaved).status(), 200);
      await page.locator('#creative-note-saved').filter({ hasText: 'Saved' }).waitFor();
      await noOverflow(page);
      if (process.env.PULSE_SCREENSHOT_DIR) await page.locator('#creative-sheet').screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/creative-tagging-${width}.png` });
      await page.reload();
      await page.locator('[data-group-id="sample-video-3"] [data-creative-open]').click();
      await page.locator('#creative-tagging').waitFor();
      assert.equal(await page.locator('#creative-tag-note').inputValue(), 'Invented browser note');
      for (const [key, value] of [['hookType', 'claim'], ['slabEarly', 'yes'], ['productEarly', 'no']]) {
        assert.equal(await page.locator(`[data-tag-row="${key}"] [data-creative-tag-value="${value}"]`).getAttribute('aria-pressed'), 'true');
        await tag(key!, value!);
      }
      assert.match(await page.locator('[data-attribute="hookType"]').innerText(), /unsure|not scanned yet/);
      const noteCleared = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/attributes'));
      await page.locator('#creative-tag-note').fill('');
      assert.equal((await noteCleared).status(), 200);
      await page.locator('[data-creative-close]').click();
      await page.locator('[data-creative-tag="sample-video-3"]').waitFor();
      await page.locator('[data-creative-tag="sample-video-3"]').click();
      await page.locator('#creative-tagging').waitFor();
      let releaseNote!: () => void;
      const noteGate = new Promise<void>(resolve => { releaseNote = resolve; });
      const notePattern = '**/api/creatives/sample-video-3/attributes';
      await page.route(notePattern, async route => { await noteGate; await route.continue(); });
      const delayedNote = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/attributes'));
      await page.locator('#creative-tag-note').fill('🟣'.repeat(201));
      assert.equal(await page.locator('#creative-tag-note').inputValue(), '🟣'.repeat(200));
      assert.equal(await page.locator('#creative-note-count').innerText(), '200');
      await delayedNote;
      await page.locator('[data-creative-close]').click();
      await page.locator('[data-group-id="sample-video-3"] [data-creative-open]').click();
      assert.match(await page.locator('#creative-sheet-title').innerText(), /Opening creative/);
      releaseNote();
      await page.locator('#creative-tagging').waitFor();
      assert.equal(await page.locator('#creative-tag-note').inputValue(), '🟣'.repeat(200), 'Reopening waits for the queued note save');
      await page.unroute(notePattern);
      const unicodeCleared = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/attributes'));
      await page.locator('#creative-tag-note').fill('');
      assert.equal((await unicodeCleared).status(), 200);
      await page.locator('[data-creative-close]').click();
      await page.locator('[data-creative-tag="sample-video-3"]').waitFor();
      const filter = async (key: string, value: string) => {
        const response = page.waitForResponse(response => /\/api\/creatives\?/.test(response.url()));
        await page.locator(`#creative-filters [name="${key}"]`).selectOption(value);
        const view = await (await response).json() as CreativeView;
        await page.waitForFunction(ids => {
          const actual = Array.from(document.querySelectorAll('#creative-gallery .creative-tile')).map(element => element.getAttribute('data-group-id'));
          return JSON.stringify(actual) === JSON.stringify(ids);
        }, view.groups.map(group => group.group.id));
        await noOverflow(page);
        return view;
      };
      const images = await filter('kind', 'image');
      assert.ok(images.groups.length >= 2 && images.groups.every(group => group.group.kind === 'image'));
      assert.equal(await page.locator('#creative-gallery .creative-play').count(), 0);
      const ours = await filter('owner', 'ours');
      assert.ok(ours.groups.length && ours.groups.every(group => group.ads.every(ad => ad.owner === 'ours')));
      await filter('owner', 'freelancer');
      const us = await filter('market', 'us');
      assert.ok(us.groups.length && us.groups.every(group => group.ads.every(ad => ad.market === 'us')));
      const inactive = await filter('live', 'false');
      assert.ok(inactive.groups.every(group => group.ads.every(ad => ad.effectiveStatus !== 'ACTIVE')));
      assert.match(await page.locator('#creative-gallery').innerText(), /No creatives match these filters/);
      await filter('kind', 'all'); await filter('owner', 'all'); await filter('market', 'all'); await filter('live', 'all');
      await filter('attribute', 'format');
      const attribute = await filter('value', 'unboxing-flat-lay');
      assert.deepEqual(attribute.groups.map(group => group.group.id), ['sample-image-1']);
      await filter('attribute', '');
      if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/creative-gallery-${width}.png`, fullPage: true });
      // A browser-only invented live response exercises the enabled control; no model request leaves the app.
      const scanSheet = await (await context.request.get('/api/creatives/sample-image-1')).json() as CreativeSheet;
      scanSheet.mode = 'live'; scanSheet.scan = { enabled: true, line: 'Scan: on · 0 scanned · 0 failed · £0.00 of £1.00 today · invented-browser-model', message: null };
      const sheetPattern = /\/api\/creatives\/sample-image-1(?:\?|$)/;
      const scanPattern = '**/api/creatives/sample-image-1/scan';
      await page.route(sheetPattern, route => route.fulfill({ json: scanSheet }));
      await page.route(scanPattern, route => route.fulfill({ json: { groupId: 'sample-image-1', attributes: scanSheet.attributes,
        scan: { ...scanSheet.scan, line: 'Scan: on · 1 scanned · 0 failed · £0.01 of £1.00 today · invented-browser-model' },
        result: { state: 'done', attempts: 1, done: 1, failed: 0 } } }));
      await page.locator('[data-group-id="sample-image-1"] [data-creative-open]').click();
      await page.locator('[data-creative-scan]').waitFor();
      await page.locator('[data-creative-scan]').click();
      await page.locator('#creative-scan-result').filter({ hasText: 'Scan complete. Attributes updated.' }).waitFor();
      assert.match(await page.locator('#creative-scan-control').innerText(), /1 scanned/);
      await noOverflow(page);
      if (process.env.PULSE_SCREENSHOT_DIR) await page.locator('#creative-sheet').screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/creative-scan-${width}.png` });
      await page.locator('[data-creative-close]').click();
      await page.unroute(sheetPattern); await page.unroute(scanPattern);

    }
  } finally { await page.close(); }
}
