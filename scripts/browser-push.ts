import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from 'playwright';
import type { SettingsSnapshot } from '../src/settings.js';
import type { PushTransport } from '../src/push/sender.js';

export const browserPushEndpoint = 'https://fcm.googleapis.com/pulse-invented-browser-device';
interface PushStubKeys {p256dh: string; auth: string}

export function captureBrowserPushTransport(): {transport: PushTransport; deliveries: string[]} {
  const deliveries: string[] = [];
  const transport: PushTransport = async request => {
    assert.equal(request.url, browserPushEndpoint); assert.equal(request.method, 'POST');
    const headers = new Headers(request.headers);
    assert.equal(headers.get('content-encoding'), 'aes128gcm'); assert.match(headers.get('ttl') ?? '', /^\d+$/);
    assert.ok(headers.get('urgency')); assert.equal(headers.has('authorization'), false);
    assert.ok(request.body instanceof Uint8Array && request.body.length > 103);
    assert.equal(request.body[20], 65); assert.equal(request.body[21], 4);
    assert.equal(Buffer.from(request.body).includes(Buffer.from('Pulse test notification')), false);
    assert.equal(typeof request.authorize, 'function');
    // HTTP localhost tests encryption and dispatch; only the private HTTPS transport creates VAPID.
    deliveries.push(request.url); return {status: 201};
  };
  return {transport, deliveries};
}

async function stubPush(context: BrowserContext, keys: PushStubKeys, permission: 'default' | 'denied' = 'default', unsupported = false): Promise<void> {
  // Keep the actual ServiceWorker API and registration. Only the device permission/subscription is invented.
  await context.addInitScript({content: `(() => {
    const keys = ${JSON.stringify(keys)}, endpoint = ${JSON.stringify(browserPushEndpoint)};
    const stats = {permissionCalls: 0, permissionInTap: false, options: null, unsubscribes: 0, reads: 0};
    Object.defineProperty(window, '__pulsePushTest', {value: stats});
    if (${unsupported}) { delete window.PushManager; return; }
    const load = key => { try { return localStorage.getItem(key); } catch { return null; } };
    const save = (key, value) => localStorage.setItem(key, value);
    Object.defineProperty(Notification, 'permission', {configurable: true, get: () => ${JSON.stringify(permission)} === 'denied' ? 'denied' : load('invented-push-permission') || 'default'});
    Notification.requestPermission = () => {
      stats.permissionCalls++; stats.permissionInTap = navigator.userActivation.isActive;
      save('invented-push-permission', 'granted'); return Promise.resolve('granted');
    };
    const subscription = () => ({endpoint, toJSON: () => ({endpoint, keys}), unsubscribe: async () => {
      stats.unsubscribes++; localStorage.removeItem('invented-push-subscribed'); return true;
    }});
    Object.defineProperty(PushManager.prototype, 'getSubscription', {configurable: true, value: async () => { stats.reads++; return load('invented-push-subscribed') ? subscription() : null; }});
    Object.defineProperty(PushManager.prototype, 'subscribe', {configurable: true, value: async options => {
      stats.options = {userVisibleOnly: options.userVisibleOnly, applicationServerKey: Array.from(new Uint8Array(options.applicationServerKey))};
      save('invented-push-subscribed', 'yes'); return subscription();
    }});
  })();`});
}

async function controls(page: Page): Promise<void> {
  for (const button of await page.locator('#push-device button').all()) if (await button.isVisible()) {
    const box = (await button.boundingBox())!; assert.ok(box.width >= 44 && box.height >= 44, 'Notification controls keep 44px taps');
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}

async function nudgeFit(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({width, height}); await page.evaluate(async () => {
    await document.fonts.ready; scrollTo(0, 0);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await page.waitForFunction(() => document.querySelector('#mn-card')?.getAnimations().every(animation =>
    animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity) ?? true);
  // One frame: a concurrent Morning/ticker refresh must not mix positions from different layouts.
  const layout = await page.evaluate(() => ({
    boxes: ['#mn-primary', '#mn-secondary', '#mn-good', '#mn-brief', '#mn-push-nudge'].flatMap(selector => {
      const element = document.querySelector(selector); if (!element) return [];
      const {x, y, width, height} = element.getBoundingClientRect(); return [{selector, x, y, width, height}];
    }), fits: document.documentElement.scrollWidth <= innerWidth,
  }));
  for (const box of layout.boxes.filter(box => ['#mn-primary', '#mn-secondary', '#mn-good'].includes(box.selector))) {
    assert.ok(box.width >= 44 && box.height >= (box.selector === '#mn-primary' ? 50 : 44), `${width}: ${box.selector} keeps its tap size (${JSON.stringify(box)})`);
    assert.ok(box.y >= 0 && box.y + box.height <= height + .5, `${width}: ${box.selector} stays on the first screen with the push line (${JSON.stringify(box)})`);
  }
  const brief = layout.boxes.find(box => box.selector === '#mn-brief')!, nudge = layout.boxes.find(box => box.selector === '#mn-push-nudge')!;
  assert.ok(nudge.y >= brief.y + brief.height, `The device nudge follows the brief without overlap (${JSON.stringify(layout)})`);
  assert.ok(nudge.width >= 44 && nudge.height >= 44);
  assert.equal(layout.fits, true);
}

/** Real local routes and real service worker, with a browser-only subscription stub and server transport fixture. */
export async function checkPush(signedIn: BrowserContext): Promise<void> {
  const settingsResponse = await signedIn.request.get('/api/settings'); assert.equal(settingsResponse.status(), 200);
  const original = await settingsResponse.json() as SettingsSnapshot, origin = new URL(settingsResponse.url()).origin;
  const keyResponse = await signedIn.request.get('/api/push/key'); assert.equal(keyResponse.status(), 200);
  const publicBody = await keyResponse.json() as {publicKey: string}; assert.deepEqual(Object.keys(publicBody), ['publicKey']);
  const publicBytes = Array.from(Buffer.from(publicBody.publicKey, 'base64url')); assert.equal(publicBytes.length, 65);
  const client = createECDH('prime256v1'); client.generateKeys();
  const keys = {p256dh: client.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url')};
  const errors: string[] = [], unexpectedWrites: string[] = [];
  let external = 0;
  const makeContext = async (permission: 'default' | 'denied' = 'default', unsupported = false): Promise<BrowserContext> => {
    const context = await signedIn.browser()!.newContext({baseURL: origin, storageState: await signedIn.storageState()});
    context.on('page', page => page.on('pageerror', error => errors.push(error.name)));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { external++; await route.abort('blockedbyclient'); }
      else if (!['GET', 'HEAD'].includes(request.method()) && !['/api/push/subscribe', '/api/push/unsubscribe', '/api/push/test'].includes(url.pathname)) {
        unexpectedWrites.push(`${request.method()} ${url.pathname}`); await route.abort('blockedbyclient');
      } else await route.continue();
    });
    await stubPush(context, keys, permission, unsupported); return context;
  };
  const setSummary = async (enabled: boolean): Promise<void> => {
    const current = await (await signedIn.request.get('/api/settings')).json() as SettingsSnapshot;
    const response = await signedIn.request.post('/api/settings', {headers: {origin}, data: {...current, values: {...current.values, morningSummaryEnabled: enabled}}});
    assert.equal(response.status(), 200);
  };
  try {
    await setSummary(true);
    for (const width of [390, 1280]) {
      const context = await makeContext(); const page = await context.newPage(); await page.setViewportSize({width, height: width === 390 ? 844 : 960});
      try {
        const initialRead = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/morning');
        const response = await page.goto('/morning'); assert.ok(response);
        await (await initialRead).finished();
        const csp = response.headers()['content-security-policy']!;
        assert.match(csp, /script-src 'self'/); assert.doesNotMatch(csp, /worker-src/, 'Root service worker registration needs no CSP relaxation');
        await page.locator('#mn-push-nudge').waitFor({state: 'visible'});
        assert.equal(await page.locator('#mn-push-nudge').innerText(), 'Notifications are off on this device');
        assert.equal(await page.locator('#mn-push-nudge').getAttribute('href'), '/settings#notifications');
        if (width === 390) { await nudgeFit(page, 375, 667); await nudgeFit(page, 390, 844); }
        await page.locator('#mn-push-nudge').click(); await page.waitForURL('**/settings#notifications');
        await page.locator('#push-turn-on').waitFor({state: 'visible'}); await controls(page);
        assert.equal(await page.evaluate(() => (window as unknown as {__pulsePushTest: {permissionCalls: number}}).__pulsePushTest.permissionCalls), 0,
          'Neither Morning nor Settings asks for permission on load');
        if (width === 390) {
          await page.route('**/api/push/subscribe', route => route.fulfill({status: 503, json: {error: 'Invented subscription save failure.'}}), {times: 1});
          await page.locator('#push-turn-on').click();
          await page.waitForFunction(() => document.querySelector('#push-device-message')?.textContent?.includes('Could not turn notifications on'));
          assert.equal(await page.locator('#push-device-status').innerText(), 'Notifications are off.');
          assert.equal(await page.locator('#push-turn-on').isVisible(), true);
          assert.equal(await page.evaluate(() => (window as unknown as {__pulsePushTest: {unsubscribes: number}}).__pulsePushTest.unsubscribes), 1,
            'A failed first save rolls back only the newly-created browser subscription');
        }
        const subscribe = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/push/subscribe');
        await page.locator('#push-turn-on').click(); const subscribed = await subscribe; assert.equal(subscribed.status(), 200);
        assert.deepEqual(subscribed.request().postDataJSON(), {endpoint: browserPushEndpoint, keys});
        await page.waitForFunction(() => document.querySelector('#push-device-status')?.textContent === 'Notifications are on.');
        const stats = await page.evaluate(() => (window as unknown as {__pulsePushTest: {permissionCalls: number; permissionInTap: boolean; options: object}}).__pulsePushTest);
        assert.equal(stats.permissionCalls, 1); assert.equal(stats.permissionInTap, true);
        assert.deepEqual(stats.options, {userVisibleOnly: true, applicationServerKey: publicBytes});
        const registration = await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration('/');
          return {scope: registration?.scope, script: registration?.active?.scriptURL, state: registration?.active?.state};
        });
        assert.deepEqual(registration, {scope: `${origin}/`, script: `${origin}/sw.js`, state: 'activated'});
        await controls(page);
        if (width === 390) {
          const sent = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/push/test');
          await page.locator('#push-send-test').click(); const result = await sent;
          assert.equal(result.status(), 200); assert.deepEqual(result.request().postDataJSON(), {});
          await page.waitForFunction(() => document.querySelector('#push-device-message')?.textContent === 'Test sent.');
          const limited = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/push/test');
          await page.locator('#push-send-test').click(); assert.equal((await limited).status(), 429);
          await page.waitForFunction(() => document.querySelector('#push-device-message')?.textContent?.includes('Wait a minute'));
        }
        const removed = await signedIn.request.post('/api/push/unsubscribe', {headers: {origin}, data: {endpoint: browserPushEndpoint}});
        assert.equal(removed.status(), 200);
        const repaired = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/push/subscribe');
        await page.goto('/morning'); await page.locator('#mn-root[data-mn-ready="true"]').waitFor();
        assert.equal((await repaired).status(), 200, 'Morning repairs a missing server subscription');
        await page.waitForFunction(() => (window as unknown as {__pulsePushTest: {reads: number}}).__pulsePushTest.reads > 0);
        assert.equal(await page.locator('#mn-push-nudge').isVisible(), false, 'Subscribed devices do not see the nudge');
        await signedIn.request.post('/api/push/unsubscribe', {headers: {origin}, data: {endpoint: browserPushEndpoint}});
        const settingsRepair = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/push/subscribe');
        await page.goto('/settings#notifications'); await page.locator('#push-turn-off').waitFor({state: 'visible'});
        assert.equal((await settingsRepair).status(), 200, 'Settings repairs a missing server subscription');
        if (width === 390) {
          await page.route('**/api/push/unsubscribe', route => route.fulfill({status: 503, json: {error: 'Invented unsubscribe save failure.'}}), {times: 1});
          await page.locator('#push-turn-off').click();
          await page.waitForFunction(() => document.querySelector('#push-device-message')?.textContent?.includes('Could not finish turning notifications off'));
          assert.equal(await page.locator('#push-device-status').innerText(), 'Notifications need setup.');
          assert.equal(await page.locator('#push-turn-off').isVisible(), true);
          assert.equal(await page.evaluate(() => (window as unknown as {__pulsePushTest: {unsubscribes: number}}).__pulsePushTest.unsubscribes), 0);
          await page.route('**/api/push/subscribe', route => route.fulfill({status: 503, json: {error: 'Invented subscription resave failure.'}}), {times: 1});
          await page.locator('#push-turn-on').click();
          await page.waitForFunction(() => document.querySelector('#push-device-message')?.textContent?.includes('Could not turn notifications on'));
          assert.equal(await page.locator('#push-device-status').innerText(), 'Notifications need setup.');
          assert.equal(await page.evaluate(() => (window as unknown as {__pulsePushTest: {unsubscribes: number}}).__pulsePushTest.unsubscribes), 0,
            'Resaving an existing browser subscription cannot remove it on failure');
        }
        const unsubscribe = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/push/unsubscribe');
        await page.locator('#push-turn-off').click(); const off = await unsubscribe; assert.equal(off.status(), 200);
        assert.deepEqual(off.request().postDataJSON(), {endpoint: browserPushEndpoint});
        await page.waitForFunction(() => document.querySelector('#push-device-status')?.textContent === 'Notifications are off.');
        assert.equal(await page.evaluate(() => (window as unknown as {__pulsePushTest: {unsubscribes: number}}).__pulsePushTest.unsubscribes), 1);
        await controls(page);
        await page.goto('/morning'); await page.locator('#mn-push-nudge').waitFor({state: 'visible'});
      } finally { await context.close(); }
    }
    const signOutContext = await makeContext();
    try {
      const page = await signOutContext.newPage(); await page.goto('/settings#notifications');
      await page.locator('#push-turn-on').click();
      await page.waitForFunction(() => document.querySelector('#push-device-status')?.textContent === 'Notifications are on.');
      let logoutCalls = 0;
      // Keep the suite's shared passkey session. Route tests exercise the real atomic logout.
      await page.route('**/auth/logout', async route => {
        assert.deepEqual(route.request().postDataJSON(), logoutCalls++ === 0 ? {pushEndpoint: browserPushEndpoint} : {});
        if (logoutCalls === 2) await signOutContext.clearCookies({name: 'pulse_session'});
        await route.fulfill({status: logoutCalls === 1 ? 503 : 200, json: logoutCalls === 1 ? {error: 'Invented sign-out failure'} : {ok: true}});
      });
      const removed = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/push/unsubscribe');
      await page.locator('#sign-out').click(); assert.equal((await removed).status(), 200);
      await page.waitForFunction(() => document.querySelector('#auth-message')?.textContent?.includes('Could not sign out'));
      assert.equal(await page.evaluate(async () => !!(await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription())), false);
      await page.locator('#sign-out').click(); await page.waitForURL('**/login');
      assert.equal(logoutCalls, 2, 'Sign-out remains retryable after revoking the device');
    } finally { await signOutContext.close(); }
    for (const kind of ['denied', 'unsupported'] as const) {
      const context = await makeContext(kind === 'denied' ? 'denied' : 'default', kind === 'unsupported');
      try {
        const page = await context.newPage(); await page.goto('/settings#notifications');
        await page.waitForFunction(() => !document.querySelector('#push-device-status')?.textContent?.includes('Checking'));
        assert.match(await page.locator('#push-device-help').innerText(), kind === 'denied' ? /Allow notifications.*settings/ : /home screen.*open it from there/);
        assert.equal(await page.locator('#push-turn-on').isVisible(), false);
        assert.equal(await page.evaluate(() => (window as unknown as {__pulsePushTest: {permissionCalls: number}}).__pulsePushTest.permissionCalls), 0);
      } finally { await context.close(); }
    }
    await setSummary(false);
    const context = await makeContext();
    try {
      const page = await context.newPage(); await page.goto('/morning'); await page.locator('#mn-root[data-mn-ready="true"]').waitFor();
      assert.equal(await page.locator('#mn-push-nudge').isVisible(), false, 'Summary off leaves no notification nudge');
    } finally { await context.close(); }
    assert.deepEqual(errors, []); assert.deepEqual(unexpectedWrites, []); assert.equal(external, 0);
    console.log('Push browser checks passed: real root-scope worker, permission on tap, device on/off, one test plus cooldown, small-phone nudge, denied and unsupported guidance.');
  } finally {
    try {
      const cleanup = await signedIn.request.post('/api/push/unsubscribe', {headers: {origin}, data: {endpoint: browserPushEndpoint}});
      assert.equal(cleanup.status(), 200);
    } finally { await setSummary(original.values.morningSummaryEnabled); }
  }
}
