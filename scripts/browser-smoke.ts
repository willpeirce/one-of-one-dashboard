import assert from 'node:assert/strict';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { chromium } from 'playwright';

let step = 'read test configuration';

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
    const context = await browser.newContext({ baseURL: origin });
    const page = await context.newPage();
    const scriptErrors: string[] = [];
    let externalRequests = 0;
    page.on('pageerror', () => scriptErrors.push('Browser script error'));
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== new URL(origin).origin) externalRequests += 1;
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
    await page.locator('#source-health tbody tr').last().waitFor();
    assert.equal(await page.locator('#source-health tbody tr').count(), 10);
    assert.equal(await page.getByText('sample data', { exact: true }).count(), 1);
    const cookies = await context.cookies();
    const thirtyDaysFromNow = Date.now() / 1000 + 30 * 24 * 60 * 60;
    assert.ok(cookies.some((cookie) => cookie.httpOnly && cookie.sameSite === 'Strict'
      && Math.abs(cookie.expires - thirtyDaysFromNow) < 60));

    step = 'check phone and desktop in both themes';
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
      await page.setViewportSize(viewport);
      for (const colorScheme of ['dark', 'light'] as const) {
        await page.emulateMedia({ colorScheme });
        assert.equal(await page.locator('#source-health').isVisible(), true);
        assert.equal(await page.getByRole('button', { name: 'Sign out', exact: true }).isVisible(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      }
    }

    step = 'sign out and revoke the browser session';
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
    assert.equal(await page.locator('#source-health tbody tr').count(), 10);

    step = 'reject replay of a consumed authentication challenge';
    assert.ok(validAssertion && challengeCookies);
    const sessionBeforeReplay = (await context.cookies()).find((cookie) => cookie.name.endsWith('pulse_session'))?.value;
    assert.ok(sessionBeforeReplay);
    const replay = await context.request.post('/auth/login/verify', {
      headers: { Origin: origin, Cookie: challengeCookies }, data: validAssertion,
    });
    assert.equal(replay.status(), 400);
    assert.ok((await context.cookies()).find((cookie) => cookie.name.endsWith('pulse_session'))?.value === sessionBeforeReplay);
    await page.reload();
    assert.equal(await page.locator('#source-health tbody tr').count(), 10);

    step = 'check the audit trail';
    await page.getByRole('link', { name: 'Audit log', exact: true }).click();
    await page.locator('#audit-log').waitFor();
    assert.ok(await page.locator('#audit-log tbody tr').count() >= 3);
    const auditText = await page.locator('#audit-log').textContent();
    for (const event of ['device added', 'sign in', 'sign out']) {
      assert.ok(auditText?.includes(event));
    }

    step = 'prepare rejection checks while signed out';
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.waitForURL('**/login');
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
    assert.equal(await page.locator('#source-health tbody tr').count(), 10);
    assert.equal(scriptErrors.length, 0);
    assert.equal(externalRequests, 0);
    await context.close();
    console.log('Browser checks passed: passkey registration/sign-in, replay/origin/signature rejection, sign-out, source health, audit, phone/desktop and dark/light.');
  } finally {
    await browser.close();
  }
}

run().catch(() => {
  // Authentication exceptions must never print browser credentials or the setup phrase.
  console.error(`Browser checks failed during: ${step}.`);
  process.exitCode = 1;
});
