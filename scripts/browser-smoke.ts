import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { rangeLabel } from '../src/hero-range.js';

let step = 'read test configuration';

const periods = ['today', 'yday', '7d', '30d'] as const;
const viewports = [{ width: 390, height: 844 }, { width: 1280, height: 960 }];
type Period = typeof periods[number];
interface HeroMetric {
  n?: number;
  unavailable?: boolean;
  t?: string;
  pre?: string;
  suf?: string;
  dp?: number;
  ss?: string;
  s?: string;
}
interface HeroPeriod {
  from: string;
  to: string;
  short: string;
  spark: number[];
  eyebrow: string;
  sub1: string;
  [key: string]: HeroMetric | string | number[];
}
interface DashboardSnapshot {
  hero: Record<Period, HeroPeriod>;
  bounds: { min: string; max: string; today: string };
}

async function showAccountMenu(page: Page): Promise<void> {
  const menu = page.locator('#account-menu');
  if (await menu.count() && await menu.getAttribute('open') === null) await page.locator('#account-menu > summary').click();
}

async function hideAccountMenu(page: Page): Promise<void> {
  const menu = page.locator('#account-menu');
  if (await menu.count() && await menu.getAttribute('open') !== null) await page.locator('#account-menu > summary').click();
}

async function dashboardSnapshot(context: BrowserContext): Promise<DashboardSnapshot> {
  const response = await context.request.get('/api/dashboard');
  assert.equal(response.status(), 200);
  return await response.json() as DashboardSnapshot;
}

async function assertHeroModel(page: Page, metrics: HeroPeriod): Promise<void> {
  const expected: Record<string, string> = {};
  for (const key of ['net', 'orders', 'cr', 'spend', 'roas', 'margin', 'ukcpo', 'uscpo']) {
    const metric = metrics[key];
    assert.ok(metric && typeof metric !== 'string' && !Array.isArray(metric));
    if (typeof metric.n === 'number') {
      expected[key] = metric.unavailable ? 'No data' : (metric.pre ?? '') + (metric.dp ? metric.n.toFixed(metric.dp) : Math.round(metric.n).toLocaleString('en-GB')) + (metric.suf ?? '');
    } else {
      assert.equal(typeof metric.t, 'string');
      expected[key] = metric.t!;
    }
  }
  await page.waitForFunction((values) => Object.entries(values).every(([key, value]) => {
    const tile = document.querySelector(`#hero [data-k="${key}"]`);
    const actual = tile?.querySelector('.sv, .well svg text')?.textContent;
    return actual?.trim() === value;
  }), expected);
  assert.equal(await page.locator('#eyebrow').textContent(), metrics.eyebrow);
  assert.equal(await page.locator('#sub1').textContent(), metrics.sub1);
  for (const key of ['t0267', 't0270']) assert.ok((await page.locator(`[data-sample-text="${key}"]`).textContent())?.startsWith(`${rangeLabel(metrics.from, metrics.to)} · Shopify `));
  for (const key of Object.keys(expected)) {
    assert.equal(await page.locator(`#hero [data-k="${key}"]`).count(), 1);
  }
  const bars = await page.locator('#hero .spark svg rect').evaluateAll((elements) => elements.map((element) => ({
    width: Number(element.getAttribute('width')), height: Number(element.getAttribute('height')),
  })));
  assert.equal(bars.length, metrics.spark.length);
  assert.ok(bars.every((bar) => bar.width > 0 && bar.height > 0), 'Every date-range spark bar must remain visible');
  const high = Math.max(1, ...metrics.spark);
  for (const [index, bar] of bars.entries()) assert.ok(Math.abs(bar.height - Math.max(3, 34 * metrics.spark[index]! / high)) <= 0.011);
}

async function assertHero(page: Page, snapshot: DashboardSnapshot, period: Period): Promise<void> {
  await assertHeroModel(page, snapshot.hero[period]);
  assert.equal(await page.locator(`#period [data-period="${period}"]`).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#picklbl').textContent(), 'Dates');
}

async function assertDarkAppearance(page: Page, logo = false): Promise<string> {
  assert.equal(await page.locator('#theme-toggle').count(), 0);
  assert.equal(await page.locator('meta[name="color-scheme"]').getAttribute('content'), 'dark');
  const appearance = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement), body = getComputedStyle(document.body);
    const sky = document.querySelector('.sky');
    return { scheme: root.colorScheme, background: body.backgroundColor, text: body.color,
      sky: sky ? getComputedStyle(sky).backgroundImage : null };
  });
  assert.equal(appearance.scheme, 'dark');
  if (logo) {
    const images = page.locator('header img[src="/assets/logo.png"]');
    assert.equal(await images.count(), 1);
    const image = await images.evaluate((element) => ({
      loaded: (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0,
      filter: getComputedStyle(element).filter,
    }));
    assert.equal(image.loaded, true);
    assert.match(image.filter, /^brightness\(0\) invert\(1\)/);
    return JSON.stringify({ ...appearance, logoFilter: image.filter });
  }
  return JSON.stringify(appearance);
}

async function rangeModel(context: BrowserContext, from: string, to: string): Promise<HeroPeriod> {
  const response = await context.request.get(`/api/hero?from=${from}&to=${to}`);
  assert.equal(response.status(), 200);
  const model = await response.json() as HeroPeriod;
  assert.equal(model.from, from);
  assert.equal(model.to, to);
  return model;
}

async function selectCalendarDay(page: Page, date: string): Promise<void> {
  const day = page.locator(`#pkcal [data-date="${date}"]`);
  for (let moves = 0; !await day.count() && moves < 18; moves += 1) {
    const first = await page.locator('#pkcal [data-date]').first().getAttribute('data-date');
    assert.ok(first);
    const direction = date < first ? '-1' : '1';
    const navigation = page.locator(`#picker [data-nav="${direction}"]`);
    assert.equal(await navigation.isEnabled(), true);
    await navigation.click();
  }
  assert.equal(await day.isEnabled(), true);
  await day.click();
}

async function applyCalendarRange(page: Page, from: string, to: string): Promise<void> {
  await page.locator('#pickbtn').click();
  await selectCalendarDay(page, from);
  if (to !== from) await selectCalendarDay(page, to);
  const [first, last] = [from, to].sort() as [string, string];
  const formatDate = (date: string): string => `${Number(date.slice(-2))} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(date.slice(5, 7)) - 1]}`;
  const rangeLabel = first === last ? formatDate(first) : first.slice(0, 7) === last.slice(0, 7)
    ? `${Number(first.slice(-2))}–${formatDate(last)}` : `${formatDate(first)}–${formatDate(last)}`;
  const days = (Date.parse(last) - Date.parse(first)) / 86_400_000 + 1;
  const name = `Show ${rangeLabel}${days > 1 ? ` · ${days} days` : ''}`;
  assert.equal(await page.getByRole('button', { name, exact: true }).count(), 1);
  await page.getByRole('button', { name, exact: true }).click();
  await page.locator('#picker').waitFor({ state: 'hidden' });
}

async function assertCustomRange(page: Page, context: BrowserContext, from: string, to: string): Promise<HeroPeriod> {
  await page.locator('#picker').waitFor({ state: 'hidden' });
  const model = await rangeModel(context, from, to);
  await assertHeroModel(page, model);
  assert.equal(await page.locator('#pickbtn').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#picklbl').textContent(), model.short);
  return model;
}

async function checkDatePicker(page: Page, context: BrowserContext, snapshot: DashboardSnapshot, width: number): Promise<void> {
  const scope = step;
  step = `${scope}: keyboard and accessible names`;
  await page.locator('#period [data-period="today"]').click();
  await page.locator('#pickbtn').click();
  assert.equal(await page.locator('#pkcal .mon').count(), width <= 640 ? 1 : 2);
  assert.deepEqual(await page.locator('#pkcal .mon h4').allTextContents(), width <= 640 ? ['September 2026'] : ['August 2026', 'September 2026']);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-date')), snapshot.bounds.today);
  assert.equal(await page.getByRole('button', { name: 'Wednesday, 30 September 2026, sample today', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Tuesday, 29 September 2026', exact: true }).count(), 1);
  // Arrow navigation changes focus, while Enter selects and Escape restores the trigger.
  for (const [key, expected] of [['ArrowLeft', '2026-09-29'], ['ArrowUp', '2026-09-22'], ['ArrowRight', '2026-09-23'], ['ArrowDown', '2026-09-30']]) {
    await page.keyboard.press(key!);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-date')), expected);
  }
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#pkcal [data-date="2026-09-29"]').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#picker').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'pickbtn');
  await assertHero(page, snapshot, 'today');

  step = `${scope}: one sample day`;
  await applyCalendarRange(page, '2026-09-24', '2026-09-24');
  await assertCustomRange(page, context, '2026-09-24', '2026-09-24');
  step = `${scope}: reversed range endpoints`;
  await applyCalendarRange(page, '2026-09-24', '2026-09-20');
  await assertCustomRange(page, context, '2026-09-20', '2026-09-24');
  for (const period of periods) {
    step = `${scope}: matching ${period} preset`;
    const model = snapshot.hero[period];
    await applyCalendarRange(page, model.from, model.to);
    await assertHero(page, snapshot, period);
  }

  await page.locator('#pickbtn').click();
  step = `${scope}: clear selection`;
  await page.locator('#pkclear').click();
  assert.equal(await page.locator('#pkgo').isDisabled(), true);
  assert.equal(await page.locator('#pkcal [aria-pressed="true"]').count(), 0);
  await page.locator('#pk-x').click();
  await assertHero(page, snapshot, '30d');
  const quickRanges = [
    ['14', '2026-09-16', '2026-09-29'], ['mtd', '2026-09-01', '2026-09-30'],
    ['lm', '2026-08-01', '2026-08-31'], ['ytd', '2026-01-01', '2026-09-30'],
  ];
  for (const [quick, from, to] of quickRanges) {
    step = `${scope}: quick range ${quick}`;
    await page.locator('#pickbtn').click();
    await page.locator(`#picker [data-q="${quick}"]`).click();
    await assertCustomRange(page, context, from!, to!);
  }
  await page.locator('#pickbtn').click();
  step = `${scope}: bounded calendar navigation`;
  const previous = page.locator('#picker [data-nav="-1"]');
  for (let moves = 0; await previous.isEnabled() && moves < 18; moves += 1) await previous.click();
  step = `${scope}: earliest month disabled`;
  assert.equal(await previous.isDisabled(), true);
  step = `${scope}: earliest day arrow clamp`;
  await page.locator(`#pkcal [data-date="${snapshot.bounds.min}"]`).focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-date')), snapshot.bounds.min);
  step = `${scope}: navigate to latest month`;
  const next = page.locator('#picker [data-nav="1"]');
  for (let moves = 0; await next.isEnabled() && moves < 18; moves += 1) await next.click();
  step = `${scope}: latest month disabled`;
  assert.equal(await next.isDisabled(), true);
  step = `${scope}: latest day arrow clamp`;
  await page.locator(`#pkcal [data-date="${snapshot.bounds.max}"]`).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-date')), snapshot.bounds.max);
  step = `${scope}: no enabled dates outside sample coverage`;
  const enabledDates = await page.locator('#pkcal [data-date]:enabled').evaluateAll((days) => days.map((day) => day.getAttribute('data-date')!));
  assert.ok(enabledDates.every((date) => date >= snapshot.bounds.min && date <= snapshot.bounds.max));
  await page.keyboard.press('Escape');
}

async function assertLocalFonts(page: Page): Promise<void> {
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const loaded: Array<{ family: string; status: string }> = [];
    document.fonts.forEach((font) => loaded.push({ family: font.family, status: font.status }));
    return loaded;
  });
  assert.ok(fonts.some((font) => font.family.includes('Outfit') && font.status === 'loaded'));
  assert.ok(fonts.some((font) => font.family.includes('Jakarta') && font.status === 'loaded'));
}

async function assertSampleTextStyles(page: Page): Promise<void> {
  const mismatches = await page.locator('[data-sample-text]').evaluateAll((wrappers) => wrappers.flatMap((wrapper) => {
    const parent = wrapper.parentElement;
    if (!parent) return ['Missing sample-text parent'];
    const actual = getComputedStyle(wrapper), expected = getComputedStyle(parent);
    return actual.fontSize === expected.fontSize && actual.color === expected.color
      ? [] : [`${wrapper.getAttribute('data-sample-text')}: ${actual.fontSize}/${actual.color} instead of ${expected.fontSize}/${expected.color}`];
  }));
  assert.deepEqual(mismatches, [], 'Sample-text wrappers must inherit their parent typography');
  const values = await page.locator('#table .nums b > [data-sample-text]').evaluateAll((wrappers) => wrappers.map((wrapper) => getComputedStyle(wrapper).fontSize));
  assert.deepEqual(values, Array<string>(18).fill('17px'));
}

async function assertUnbuiltActions(page: Page): Promise<void> {
  const buttons = page.locator('button[data-unbuilt]');
  assert.ok(await buttons.count() >= 17);
  for (const button of await buttons.all()) {
    const label = await button.getAttribute('aria-label');
    assert.ok(label);
    assert.ok(label.endsWith(' · Not built yet'));
    assert.equal(await button.isDisabled(), true);
    assert.equal(await button.textContent(), label.replace(/ · Not built yet$/, ''));
    const note = button.locator('..').locator('.unbuilt-note');
    assert.equal(await note.textContent(), 'Not built yet');
    assert.equal(await note.isVisible(), await button.isVisible());
  }
}

async function checkManifest(page: Page, context: BrowserContext, origin: string): Promise<void> {
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  assert.ok(href);
  assert.equal(new URL(href, origin).origin, new URL(origin).origin);
  const response = await context.request.get(href);
  assert.equal(response.status(), 200);
  const manifest = await response.json() as { name: string; display: string; start_url: string; icons: Array<{ src: string; sizes: string }> };
  assert.match(manifest.name, /Pulse/);
  assert.equal(manifest.display, 'standalone');
  assert.equal(new URL(manifest.start_url, origin).origin, new URL(origin).origin);
  for (const size of ['192x192', '512x512']) {
    const icon = manifest.icons.find((entry) => entry.sizes.split(' ').includes(size));
    assert.ok(icon);
    assert.equal(new URL(icon.src, origin).origin, new URL(origin).origin);
    const iconResponse = await context.request.get(icon.src);
    assert.equal(iconResponse.status(), 200);
    assert.match(iconResponse.headers()['content-type'] ?? '', /^image\/png/);
  }
  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  assert.ok(appleIcon);
  assert.equal(new URL(appleIcon, origin).origin, new URL(origin).origin);
  assert.equal((await context.request.get(appleIcon)).status(), 200);
}

async function run(): Promise<void> {
  const origin = process.env.APP_ORIGIN;
  const setupPhrase = process.env.DASHBOARD_SETUP_CODE;
  if (!origin || !setupPhrase) {
    throw new Error('APP_ORIGIN and DASHBOARD_SETUP_CODE must be provided by the test runner');
  }

  step = 'launch Chromium';
  const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  });
  try {
    const context = await browser.newContext({ baseURL: origin, reducedMotion: 'reduce' });
    // Older builds saved this preference. It must no longer change any screen.
    await context.addInitScript(() => {
      if (location.protocol === 'http:' || location.protocol === 'https:') localStorage.setItem('pulse-theme', 'light');
    });
    const scriptErrors: string[] = [];
    const consoleErrors: string[] = [];
    let externalRequests = 0;
    let rejectingAuthentication = false;
    let loadedFonts = 0;
    let eventStreams = 0;
    context.on('page', (opened) => {
      opened.on('pageerror', (error) => {
        const frames = error.stack?.match(/\/assets\/[a-z-]+\.js:\d+:\d+/g) ?? [];
        scriptErrors.push(`Browser script error during ${step}${frames.length ? ` at ${frames.join(', ')}` : ''}`);
      });
      opened.on('console', (message) => {
        if (message.type() !== 'error') return;
        // The security checks below deliberately cause failed HTTP requests.
        const location = message.location().url;
        if (rejectingAuthentication && location && new URL(location, origin).pathname === '/auth/login/verify'
          && message.text().includes('400')) return;
        consoleErrors.push('Unexpected browser console error');
      });
    });
    context.on('response', (response) => {
      if (response.request().resourceType() === 'font' && response.ok()) loadedFonts += 1;
      if (new URL(response.url()).pathname === '/api/events' && response.ok()
        && response.headers()['content-type']?.startsWith('text/event-stream')) eventStreams += 1;
    });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(origin).origin) {
        externalRequests += 1;
        await route.abort('blockedbyclient');
      } else await route.continue();
    });
    const page = await context.newPage();
    let dashboardFetches = 0;
    let heroFetches = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/dashboard') dashboardFetches += 1;
      if (new URL(request.url()).pathname === '/api/hero') heroFetches += 1;
    });

    step = 'check public health and authentication gate';
    const health = await context.request.get('/health');
    assert.equal(health.status(), 200);
    const healthBody = await health.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(healthBody), ['status']);
    assert.equal(healthBody.status, 'ok');
    await page.goto('/');
    await page.waitForURL('**/login');
    assert.equal(await page.locator('#source-health').count(), 0);
    assert.equal(await page.locator('#hero').count(), 0);
    await page.goto('/sources');
    await page.waitForURL('**/login');
    await page.goto('/settings');
    await page.waitForURL('**/login');
    assert.equal((await context.request.get('/api/dashboard')).status(), 401);
    assert.equal((await context.request.get('/api/settings')).status(), 401);
    assert.equal((await context.request.get('/api/hero?from=2026-09-20&to=2026-09-24')).status(), 401);
    let loginAppearance: string | undefined;
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const preference of ['dark', 'light'] as const) {
        await page.emulateMedia({ colorScheme: preference });
        const appearance = await assertDarkAppearance(page);
        if (loginAppearance) assert.equal(appearance, loginAppearance);
        loginAppearance = appearance;
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
    }

    step = 'prepare a real virtual passkey';
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    step = 'register this device';
    await page.getByText('Add a device', { exact: true }).click();
    // evaluate avoids including a phrase in Playwright's locator call logs on failure.
    await page.evaluate((phrase) => {
      const input = document.querySelector<HTMLInputElement>('#setup-code');
      if (!input) throw new Error('Setup field missing');
      input.value = phrase;
    }, setupPhrase);
    await page.getByRole('button', { name: 'Add this device', exact: true }).click();
    await page.waitForURL(new URL('/', origin).href);
    await page.locator('html[data-dashboard-ready="true"]').waitFor();
    assert.equal(await page.locator('.sample-banner').isVisible(), true);
    assert.match(await page.locator('.sample-banner').innerText(), /sample data/i);
    const cookies = await context.cookies();
    const thirtyDaysFromNow = Date.now() / 1000 + 30 * 24 * 60 * 60;
    assert.ok(cookies.some((cookie) => cookie.httpOnly && cookie.sameSite === 'Strict'
      && Math.abs(cookie.expires - thirtyDaysFromNow) < 60));

    step = 'check dark-only dashboard at phone and desktop widths';
    const snapshot = await dashboardSnapshot(context);
    let dashboardAppearance: string | undefined;
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const preference of ['dark', 'light'] as const) {
        step = `check dashboard at ${viewport.width}px with ${preference} browser preference`;
        await page.emulateMedia({ colorScheme: preference, reducedMotion: 'reduce' });
        const appearance = await assertDarkAppearance(page, true);
        if (dashboardAppearance) assert.equal(appearance, dashboardAppearance);
        dashboardAppearance = appearance;
        if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/pulse-stage1b-${viewport.width}-${preference}.png` });
        await showAccountMenu(page);
        assert.equal(await page.locator('#hero').isVisible(), true);
        assert.equal(await page.getByRole('button', { name: 'Sign out', exact: true }).isVisible(), true);
        await hideAccountMenu(page);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        await assertLocalFonts(page);
        await assertSampleTextStyles(page);
        await assertUnbuiltActions(page);
        const order = await page.evaluate(() => {
          const reviews = document.querySelector('#reviews')!;
          const tests = document.querySelector('#tests')!;
          return Boolean(reviews.compareDocumentPosition(tests) & Node.DOCUMENT_POSITION_FOLLOWING)
            && reviews.getBoundingClientRect().bottom <= tests.getBoundingClientRect().top;
        });
        assert.equal(order, true);
        for (const period of periods) {
          step = `check ${period} metrics at ${viewport.width}px with ${preference} browser preference`;
          await page.locator(`#period [data-period="${period}"]`).click();
          await assertHero(page, snapshot, period);
        }
        step = `check date picker at ${viewport.width}px with ${preference} browser preference`;
        await checkDatePicker(page, context, snapshot, viewport.width);
        step = `check browser errors after dates at ${viewport.width}px (${scriptErrors.length} script, ${consoleErrors.length} console, ${externalRequests} external)${scriptErrors[0] ? `: ${scriptErrors[0]}` : ''}`;
        assert.equal(scriptErrors.length, 0);
        assert.equal(consoleErrors.length, 0);
        assert.equal(externalRequests, 0);
      }
    }
    assert.ok(loadedFonts >= 2);
    step = 'ignore a custom-range response that arrives after Escape';
    await page.locator('#period [data-period="today"]').click();
    const delayedModel = await rangeModel(context, '2026-09-20', '2026-09-24');
    let captured!: () => void, release!: () => void, completed!: () => void;
    const capturedRequest = new Promise<void>((resolve) => { captured = resolve; });
    const releaseResponse = new Promise<void>((resolve) => { release = resolve; });
    const completedResponse = new Promise<void>((resolve) => { completed = resolve; });
    await page.route('**/api/hero?**', async (route) => {
      captured();
      await releaseResponse;
      try { await route.fulfill({ status: 200, json: delayedModel }); }
      finally { completed(); }
    }, { times: 1 });
    await page.locator('#pickbtn').click();
    await selectCalendarDay(page, '2026-09-20');
    await selectCalendarDay(page, '2026-09-24');
    await page.locator('#pkgo').click();
    await capturedRequest;
    await page.keyboard.press('Escape');
    release();
    await completedResponse;
    await assertHero(page, snapshot, 'today');
    assert.equal(await page.locator('#picker').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'pickbtn');
    step = 'check a saved light preference cannot change the dark dashboard';
    await page.reload();
    await page.locator('html[data-dashboard-ready="true"]').waitFor();
    assert.equal(await assertDarkAppearance(page, true), dashboardAppearance);

    step = 'check navigation, score tabs, dial decks, search and detail sheets';
    await page.locator('[data-go="tests"]').click();
    assert.equal(await page.locator('[data-go="tests"]').getAttribute('aria-current'), 'true');
    for (const tab of ['live', 'wins', 'soon']) {
      await page.locator(`[data-st="${tab}"]`).click();
      assert.equal(await page.locator(`[data-st="${tab}"]`).getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator(`[data-sp="${tab}"]`).isVisible(), true);
    }
    for (const deck of ['ads', 'store', 'growth', 'stock']) {
      await page.locator(`#tabs [data-tab="${deck}"]`).click();
      assert.equal(await page.locator(`#tabs [data-tab="${deck}"]`).getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator(`[data-panel="${deck}"]`).isVisible(), true);
      assert.ok(await page.locator(`[data-panel="${deck}"] .tile`).count() > 0);
    }
    await page.locator('#q').fill('Google');
    const searchResults = page.locator('[data-panel] .tile:visible');
    assert.ok(await searchResults.count() > 0);
    for (const result of await searchResults.all()) assert.match(await result.innerText(), /Google/i);
    await page.locator('#q').fill('a dial that does not exist');
    assert.equal(await page.locator('[data-panel] .tile:visible').count(), 0);
    await page.locator('#q').fill('');
    await page.locator('#hero [data-k="net"]').click();
    assert.equal(await page.locator('#sheet').isVisible(), true);
    for (const selector of ['#sh-title', '#sh-why', '#sh-rule', '#sh-src']) {
      assert.ok((await page.locator(selector).textContent())?.trim());
    }
    await page.locator('#sh-x').click();
    assert.equal(await page.locator('#sheet').isVisible(), false);

    step = 'check source mutations are unavailable';
    const mutations = page.locator('button[data-unbuilt], [data-act], [data-call]');
    assert.ok(await mutations.count() >= 10);
    for (const button of await mutations.all()) {
      assert.equal(await button.isDisabled(), true);
      assert.ok((await button.textContent())?.trim());
    }
    await assertUnbuiltActions(page);
    await page.locator('#tabs [data-tab="ads"]').click();
    await page.locator('#livesets').click();
    await assertSampleTextStyles(page);
    await assertUnbuiltActions(page);
    assert.equal(await page.locator('#sheet [data-unbuilt]').count(), 2);
    await page.locator('#sh-x').click();

    step = 'check same-origin manifest and installation icons';
    await checkManifest(page, context, origin);

    step = 'check Settings persistence, audit and live dashboard update';
    await page.locator('#period [data-period="7d"]').click();
    await page.locator('#tabs [data-tab="stock"]').click();
    await hideAccountMenu(page);
    assert.ok(eventStreams > 0);
    const beforeUpdate = { url: page.url(), scroll: await page.evaluate(() => window.scrollY), fetches: dashboardFetches };
    const settingsPage = await context.newPage();
    step = 'load the Settings form';
    await settingsPage.goto('/settings');
    await settingsPage.locator('#settings-form').waitFor();
    await settingsPage.setViewportSize(viewports[0]!);
    await settingsPage.locator('summary').filter({ hasText: 'Costs & dispatch' }).click();
    assert.match(await settingsPage.locator('[data-settings-list="startingCogs"]').innerText(), /Shopify · sample data: £3\.45/);
    assert.match(await settingsPage.locator('[data-settings-list="startingCogs"]').innerText(), /Shopify · sample data: no cost set · last seen/);
    assert.match(await settingsPage.locator('[data-settings-list="startingCogs"]').innerText(), /Not in Shopify/);
    assert.match(await settingsPage.locator('[data-settings-list="startingCogs"]').innerText(), /fallback/);
    assert.equal(await settingsPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    let settingsAppearance: string | undefined;
    for (const viewport of viewports) {
      await settingsPage.setViewportSize(viewport);
      for (const preference of ['dark', 'light'] as const) {
        await settingsPage.emulateMedia({ colorScheme: preference });
        const appearance = await assertDarkAppearance(settingsPage, true);
        if (settingsAppearance) assert.equal(appearance, settingsAppearance);
        settingsAppearance = appearance;
        assert.equal(await settingsPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
    }
    await settingsPage.locator('summary').filter({ hasText: 'Cost per purchase' }).click();
    const setting = settingsPage.locator('input[name="blendedMetaTripwireGbp"]');
    const initialBar = Number(await setting.inputValue());
    assert.ok(Number.isFinite(initialBar));
    const updatedBar = initialBar === 31 ? 32 : 31;
    await setting.fill(String(updatedBar));
    step = 'save the changed Settings tripwire';
    const settingsSaved = settingsPage.waitForResponse((response) => new URL(response.url()).pathname === '/api/settings' && response.request().method() === 'POST');
    await settingsPage.locator('#settings-save').click();
    assert.equal((await settingsSaved).status(), 200);
    step = 'apply the Settings tripwire to the existing dashboard over SSE';
    await page.waitForFunction((bar) => document.querySelector('#hero [data-k="ukcpo"] .ds')?.textContent?.includes(`bar £${bar}`), updatedBar);
    assert.equal(page.url(), beforeUpdate.url);
    assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - beforeUpdate.scroll) <= 2);
    assert.equal(dashboardFetches, beforeUpdate.fetches);
    assert.equal(await page.locator('#period [data-period="7d"]').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#tabs [data-tab="stock"]').getAttribute('aria-selected'), 'true');
    assert.equal(await assertDarkAppearance(page, true), dashboardAppearance);
    await assertSampleTextStyles(page);
    await assertUnbuiltActions(page);
    step = 'check the saved Settings value persists in the API and form';
    const saved = await context.request.get('/api/settings');
    assert.equal(saved.status(), 200);
    assert.equal((await saved.json() as { values: { blendedMetaTripwireGbp: number } }).values.blendedMetaTripwireGbp, updatedBar);
    await settingsPage.reload();
    assert.equal(await settingsPage.locator('input[name="blendedMetaTripwireGbp"]').inputValue(), String(updatedBar));
    step = 'check the changed Settings field appears in the audit log';
    await settingsPage.goto('/audit');
    assert.match(await settingsPage.locator('#audit-log').innerText(), /blendedMetaTripwireGbp/);
    await settingsPage.close();

    step = 'check fulfilment costs at phone and desktop widths';
    const fulfilmentPage = await context.newPage();
    const inventedExport = await readFile(new URL('../test/fixtures/fulfilment/sample.csv', import.meta.url));
    for (const viewport of viewports) {
      await fulfilmentPage.setViewportSize(viewport);
      await fulfilmentPage.goto('/fulfilment');
      await fulfilmentPage.locator('#export-file').waitFor();
      step = `check fulfilment banner at ${viewport.width}px`;
      assert.match(await fulfilmentPage.locator('.sample-banner').innerText(), /Sample data/);
      step = `check fulfilment averages at ${viewport.width}px`;
      assert.match(await fulfilmentPage.locator('.fulfilment-glance').innerText(), /USD as exported/);
      step = `preview fulfilment CSV at ${viewport.width}px`;
      const before = await (await context.request.get('/api/fulfilment')).json() as { recent: unknown[]; lastUpload: { id: string } };
      await fulfilmentPage.locator('#export-file').setInputFiles({ name: 'invented.csv', mimeType: 'text/csv', buffer: inventedExport });
      await fulfilmentPage.locator('#confirm-upload').waitFor({ state: 'visible' });
      step = `check parsed fulfilment rows at ${viewport.width}px`;
      assert.match(await fulfilmentPage.locator('#coverage-copy').innerText(), /including days with no despatches/);
      assert.equal(await fulfilmentPage.locator('#complete-week').isChecked(), false);
      assert.equal(await fulfilmentPage.locator('#upload-preview tbody tr').count(), 40);
      assert.match(await fulfilmentPage.locator('#upload-preview').innerText(), /Unmatched order numbers: 99999999/);
      assert.match(await fulfilmentPage.locator('#upload-preview').innerText(), /Unknown service/);
      assert.match(await fulfilmentPage.locator('#upload-status').innerText(), /Nothing saved/);
      const after = await (await context.request.get('/api/fulfilment')).json() as typeof before;
      assert.equal(after.lastUpload.id, before.lastUpload.id);
      step = `check fulfilment page width at ${viewport.width}px`;
      if (process.env.PULSE_SCREENSHOT_DIR) await fulfilmentPage.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/fulfilment-screen-${viewport.width}.png` });
      assert.equal(await fulfilmentPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.PULSE_SCREENSHOT_DIR) await fulfilmentPage.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/fulfilment-preview-${viewport.width}.png` });
      await fulfilmentPage.locator('#cancel-upload').click();
      assert.match(await fulfilmentPage.locator('#upload-status').innerText(), /Cancelled/);
      await fulfilmentPage.locator('#model-open').click();
      assert.equal(await fulfilmentPage.locator('#model-detail').isVisible(), true);
      assert.match(await fulfilmentPage.locator('#model-detail').innerText(), /Estimate replaced/);
      if (process.env.PULSE_SCREENSHOT_DIR) await fulfilmentPage.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/fulfilment-detail-${viewport.width}.png` });
      await fulfilmentPage.locator('#model-close').click();
    }
    step = 'confirm an idempotent fulfilment re-upload in the browser';
    await fulfilmentPage.locator('#export-file').setInputFiles({ name: 'invented.csv', mimeType: 'text/csv', buffer: inventedExport });
    await fulfilmentPage.locator('#confirm-upload').waitFor({ state: 'visible' });
    await fulfilmentPage.locator('#confirm-upload').click();
    await fulfilmentPage.waitForFunction(() => document.querySelector('#upload-status')?.textContent?.includes('Saved 0 parcels; skipped 40 duplicates'));
    await fulfilmentPage.close();

    step = 'keep a custom date range unchanged during a Settings SSE update';
    await applyCalendarRange(page, '2026-09-20', '2026-09-24');
    const customModel = await assertCustomRange(page, context, '2026-09-20', '2026-09-24');
    const beforeCustomUpdate = {
      heroFetches, fetches: dashboardFetches, updated: await page.locator('html').getAttribute('data-updated-at'),
      tiles: await page.locator('#hero .tile[data-k]').evaluateAll((tiles) => tiles.map((tile) => tile.outerHTML)),
    };
    const currentSettings = await (await context.request.get('/api/settings')).json() as { version: number; values: Record<string, unknown> };
    currentSettings.values.blendedMetaTripwireGbp = updatedBar + 1;
    const update = await context.request.post('/api/settings', { headers: { Origin: origin }, data: currentSettings });
    assert.equal(update.status(), 200);
    await page.waitForFunction((previous) => document.documentElement.dataset.updatedAt !== previous, beforeCustomUpdate.updated);
    await assertHeroModel(page, customModel);
    assert.deepEqual(await page.locator('#hero .tile[data-k]').evaluateAll((tiles) => tiles.map((tile) => tile.outerHTML)), beforeCustomUpdate.tiles);
    assert.equal(heroFetches, beforeCustomUpdate.heroFetches, 'SSE must not fetch a custom range automatically');
    assert.equal(dashboardFetches, beforeCustomUpdate.fetches);
    assert.equal(await page.locator('#pickbtn').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#picklbl').textContent(), customModel.short);
    assert.equal(await page.locator('#tabs [data-tab="stock"]').getAttribute('aria-selected'), 'true');

    step = 'check authenticated source health remains available';
    await page.goto('/sources');
    await page.locator('#source-health tbody tr').last().waitFor();
    assert.equal(await page.locator('#source-health tbody tr').count(), 10);
    assert.ok(await page.getByText('sample data', { exact: true }).count() >= 1);

    step = 'sign out and revoke the browser session';
    await showAccountMenu(page);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.waitForURL('**/login');
    await page.goto('/audit');
    await page.waitForURL('**/login');

    step = 'sign in using the registered passkey';
    let validAssertion: { response: AuthenticationResponseJSON } | undefined;
    let challengeCookies = '';
    await page.route('**/auth/login/verify', async (route) => {
      validAssertion = route.request().postDataJSON() as { response: AuthenticationResponseJSON };
      challengeCookies = (await route.request().allHeaders()).cookie ?? '';
      await route.continue();
    });
    await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    await page.waitForURL(new URL('/', origin).href);
    await page.unroute('**/auth/login/verify');
    await page.locator('html[data-dashboard-ready="true"]').waitFor();
    await assertHero(page, await dashboardSnapshot(context), 'today');

    step = 'reject replay of a consumed authentication challenge';
    assert.ok(validAssertion && challengeCookies);
    const sessionBeforeReplay = (await context.cookies()).find((cookie) => cookie.name.endsWith('pulse_session'))?.value;
    assert.ok(sessionBeforeReplay);
    rejectingAuthentication = true;
    const replay = await context.request.post('/auth/login/verify', {
      headers: { Origin: origin, Cookie: challengeCookies }, data: validAssertion,
    });
    assert.equal(replay.status(), 400);
    assert.ok((await context.cookies()).find((cookie) => cookie.name.endsWith('pulse_session'))?.value === sessionBeforeReplay);
    await page.reload();
    await page.locator('html[data-dashboard-ready="true"]').waitFor();
    await assertHero(page, await dashboardSnapshot(context), 'today');
    rejectingAuthentication = false;

    step = 'check the audit trail';
    await showAccountMenu(page);
    await page.getByRole('link', { name: 'Audit log', exact: true }).click();
    await page.locator('#audit-log').waitFor();
    assert.ok(await page.locator('#audit-log tbody tr').count() >= 3);
    const auditText = await page.locator('#audit-log').textContent();
    for (const event of ['device added', 'sign in', 'sign out']) {
      assert.ok(auditText?.includes(event));
    }

    step = 'prepare rejection checks while signed out';
    await showAccountMenu(page);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.waitForURL('**/login');
    rejectingAuthentication = true;
    for (const attack of ['wrong origin', 'invalid signature'] as const) {
      step = `reject authentication with ${attack}`;
      await page.route('**/auth/login/verify', async (route) => {
        const body = route.request().postDataJSON() as { response: AuthenticationResponseJSON };
        const assertion = body.response.response;
        if (attack === 'wrong origin') {
          const clientData = JSON.parse(Buffer.from(assertion.clientDataJSON, 'base64url').toString('utf8')) as Record<string, unknown>;
          clientData.origin = 'https://unrelated.invalid';
          assertion.clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
        } else {
          const signature = Buffer.from(assertion.signature, 'base64url');
          signature[signature.length - 1] = signature[signature.length - 1]! ^ 1;
          assertion.signature = signature.toString('base64url');
        }
        await route.continue({ postData: JSON.stringify(body) });
      });
      const rejected = page.waitForResponse((response) => new URL(response.url()).pathname === '/auth/login/verify');
      await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
      assert.equal((await rejected).status(), 400);
      await page.waitForFunction(() => Boolean(document.querySelector('#auth-message')?.textContent));
      await page.unroute('**/auth/login/verify');
      assert.ok(!(await context.cookies()).some((cookie) => cookie.name.endsWith('pulse_session')));
      await page.goto('/');
      await page.waitForURL('**/login');
    }

    step = 'confirm valid sign-in still works after rejected assertions';
    await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();
    await page.waitForURL(new URL('/', origin).href);
    await page.locator('html[data-dashboard-ready="true"]').waitFor();
    await assertHero(page, await dashboardSnapshot(context), 'today');
    rejectingAuthentication = false;
    assert.equal(scriptErrors.length, 0);
    assert.equal(consoleErrors.length, 0);
    assert.equal(externalRequests, 0);
    await context.close();
    console.log('Browser checks passed: passkeys and replay/origin/signature rejection; all hero presets and custom dates, bounded keyboard calendars, decks, search and details; Settings persistence and SSE without replacing picked dates; source health and audit; local fonts and PWA; dark-only phone/desktop with both browser preferences and no external requests.');
  } finally {
    await browser.close();
  }
}

run().catch(() => {
  // Authentication exceptions must never print browser credentials or the setup phrase.
  console.error(`Browser checks failed during: ${step}.`);
  process.exitCode = 1;
});
