import assert from 'node:assert/strict';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { chromium, type BrowserContext, type Page } from 'playwright';

let step = 'read test configuration';

const periods = ['today', 'yday', '7d'] as const;
type Period = typeof periods[number];
interface HeroMetric {
  n?: number;
  t?: string;
  pre?: string;
  suf?: string;
  dp?: number;
  ss?: string;
  s?: string;
}
interface DashboardSnapshot {
  hero: Record<Period, Record<string, HeroMetric | string>>;
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

async function assertHero(page: Page, snapshot: DashboardSnapshot, period: Period): Promise<void> {
  const metrics = snapshot.hero[period];
  assert.ok(metrics);
  const expected: Record<string, string> = {};
  for (const key of ['net', 'orders', 'cr', 'spend', 'roas', 'margin', 'ukcpo', 'uscpo']) {
    const metric = metrics[key];
    assert.ok(metric && typeof metric !== 'string');
    if (typeof metric.n === 'number') {
      expected[key] = (metric.pre ?? '') + (metric.dp ? metric.n.toFixed(metric.dp) : Math.round(metric.n).toLocaleString('en-GB')) + (metric.suf ?? '');
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
  for (const key of Object.keys(expected)) {
    assert.equal(await page.locator(`#hero [data-k="${key}"]`).count(), 1);
  }
  assert.equal(await page.locator(`#period [data-period="${period}"]`).getAttribute('aria-selected'), 'true');
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
    const scriptErrors: string[] = [];
    const consoleErrors: string[] = [];
    let externalRequests = 0;
    let rejectingAuthentication = false;
    let loadedFonts = 0;
    let eventStreams = 0;
    context.on('page', (opened) => {
      opened.on('pageerror', () => scriptErrors.push('Browser script error'));
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
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/dashboard') dashboardFetches += 1;
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

    step = 'check dashboard phone and desktop in both themes';
    const snapshot = await dashboardSnapshot(context);
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 1000 }]) {
      await page.setViewportSize(viewport);
      for (const theme of ['dark', 'light'] as const) {
        step = `check dashboard at ${viewport.width}px in ${theme} theme`;
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await showAccountMenu(page);
        const selected = await page.locator('html').getAttribute('data-theme');
        if (selected !== theme) await page.locator('#theme-toggle').click();
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
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
          step = `check ${period} metrics at ${viewport.width}px in ${theme} theme`;
          await page.locator(`#period [data-period="${period}"]`).click();
          await assertHero(page, snapshot, period);
        }
        assert.equal(scriptErrors.length, 0);
        assert.equal(consoleErrors.length, 0);
        assert.equal(externalRequests, 0);
      }
    }
    assert.ok(loadedFonts >= 2);
    step = 'check the manually chosen theme survives reload';
    await page.reload();
    await page.locator('html[data-dashboard-ready="true"]').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');

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
    const mutations = page.locator('button.act:not([data-goto]), [data-act], [data-call]');
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
    await showAccountMenu(page);
    if (await page.locator('html').getAttribute('data-theme') !== 'dark') await page.locator('#theme-toggle').click();
    await hideAccountMenu(page);
    assert.ok(eventStreams > 0);
    const beforeUpdate = { url: page.url(), scroll: await page.evaluate(() => window.scrollY), fetches: dashboardFetches };
    const settingsPage = await context.newPage();
    step = 'load the Settings form';
    await settingsPage.goto('/settings');
    await settingsPage.locator('#settings-form').waitFor();
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
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
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
    console.log('Browser checks passed: passkeys and replay/origin/signature rejection; dashboard periods, decks, search and details; Settings persistence and SSE; source health and audit; local fonts and PWA; phone/desktop and dark/light without external requests.');
  } finally {
    await browser.close();
  }
}

run().catch(() => {
  // Authentication exceptions must never print browser credentials or the setup phrase.
  console.error(`Browser checks failed during: ${step}.`);
  process.exitCode = 1;
});
