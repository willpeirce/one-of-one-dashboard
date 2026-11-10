interface TestResult { ok: true; sent: number; failed: number; gone: number }
const supported = (): boolean => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let registration: Promise<ServiceWorkerRegistration> | null = null;
function worker(): Promise<ServiceWorkerRegistration> {
  if (!registration) registration = (async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Notifications could not start. Try again.')), 10_000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  })().catch(error => { registration = null; throw error; });
  return registration;
}
async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  if (response.status === 401) { location.assign('/login'); throw new Error('Sign in to change notifications.'); }
  if (response.status === 429) throw new Error('A test was sent recently. Wait a minute and try again.');
  if (!response.ok) throw new Error('Could not save notifications or send the test. Try again.');
  return await response.json() as T;
}
function publicKeyBytes(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('Notifications are not ready. Try again.');
  return bytes;
}
function payload(subscription: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const json = subscription.toJSON(), p256dh = json.keys?.p256dh, auth = json.keys?.auth;
  if (!p256dh || !auth) throw new Error('Could not read this device subscription. Try again.');
  return { endpoint: subscription.endpoint, keys: { p256dh, auth } };
}

export function initializePushDevice(): void {
  const root = document.getElementById('push-device'); if (!root) return;
  const element = <T extends HTMLElement = HTMLElement>(id: string): T => root.querySelector(`#${id}`) as T;
  const on = element<HTMLButtonElement>('push-turn-on'), off = element<HTMLButtonElement>('push-turn-off'), test = element<HTMLButtonElement>('push-send-test');
  const status = element('push-device-status'), help = element('push-device-help'), message = element('push-device-message');
  let subscription: PushSubscription | null = null, busy = false, retrySetup = false;
  function render(): void {
    const available = supported(), denied = available && Notification.permission === 'denied';
    status.textContent = !available ? 'Notifications are unavailable here.' : denied ? 'Notifications are blocked.' : subscription ? 'Notifications are on.' : 'Notifications are off.';
    help.textContent = !available ? 'Add Pulse to the home screen and open it from there to use notifications.'
      : denied ? 'Allow notifications for Pulse in your device or browser settings, then return here.' : '';
    on.hidden = !available || denied || !!subscription && !retrySetup;
    off.hidden = !available || denied || !subscription;
    test.hidden = !available || denied || !subscription || retrySetup;
    for (const button of [on, off, test]) button.disabled = busy;
  }
  function announce(text: string): void { message.textContent = text; }
  async function read(): Promise<void> {
    if (!supported() || Notification.permission === 'denied') { render(); return; }
    try { subscription = await (await worker()).pushManager.getSubscription(); render(); }
    catch { render(); announce('Could not check this device. Try turning notifications on again.'); }
  }
  on.addEventListener('click', () => {
    if (busy || !supported()) return;
    // Ask within this click before awaiting registration or the public key (iPhone activation rule).
    let permission: Promise<NotificationPermission>;
    try { permission = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission(); }
    catch { announce('Could not ask for notification permission. Try again.'); return; }
    busy = true; announce(''); render();
    void (async () => {
      let created: PushSubscription | null = null;
      try {
        if (await permission !== 'granted') { announce('Notifications were not enabled.'); return; }
        const serviceWorker = await worker(), existing = await serviceWorker.pushManager.getSubscription();
        const { publicKey } = await request<{ publicKey: string }>('/api/push/key');
        subscription = existing ?? await serviceWorker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(publicKey) });
        if (!existing) created = subscription;
        await request('/api/push/subscribe', payload(subscription));
        retrySetup = false; announce('Notifications are on.');
      } catch {
        retrySetup = true;
        if (created) {
          try { await created.unsubscribe(); subscription = await (await worker()).pushManager.getSubscription(); } catch { /* Keep Turn on available to retry saving. */ }
        }
        announce('Could not turn notifications on. Try again.');
      } finally { busy = false; render(); (subscription && !retrySetup ? off : on).focus(); }
    })();
  });
  off.addEventListener('click', () => {
    if (busy || !subscription) return;
    busy = true; announce(''); render();
    void (async () => {
      try {
        await request('/api/push/unsubscribe', { endpoint: subscription!.endpoint });
        await subscription!.unsubscribe(); subscription = await (await worker()).pushManager.getSubscription();
        if (subscription) throw new Error('The browser kept the subscription');
        retrySetup = false; announce('Notifications are off.');
      } catch { retrySetup = true; announce('Could not finish turning notifications off. Try again.'); }
      finally { busy = false; render(); (subscription ? off : on).focus(); }
    })();
  });
  test.addEventListener('click', () => {
    if (busy || !subscription) return;
    busy = true; announce('Sending a test…'); render();
    void (async () => {
      try {
        const result = await request<TestResult>('/api/push/test', {});
        announce(result.failed ? `Test sent to ${result.sent} device${result.sent === 1 ? '' : 's'}; ${result.failed} could not receive it.` : 'Test sent.');
      } catch (error) { announce(error instanceof Error ? error.message : 'Could not send the test. Try again.'); }
      finally { busy = false; render(); test.focus(); }
    })();
  });
  function reveal(): void {
    if (location.hash !== '#notifications') return;
    for (let parent = root!.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
    document.getElementById('notifications')?.scrollIntoView({ block: 'center' });
  }
  window.addEventListener('hashchange', reveal); reveal(); void read();
}

let nudgeEnabled = false, subscribed: boolean | null = null, reading = false, watching = false;
function paintNudge(): void {
  const link = document.getElementById('mn-push-nudge');
  if (link) link.hidden = !nudgeEnabled || subscribed !== false;
}
async function readNudge(): Promise<void> {
  if (reading || !nudgeEnabled) return;
  if (!supported() || Notification.permission === 'denied') { subscribed = false; paintNudge(); return; }
  reading = true;
  try { subscribed = !!await (await worker()).pushManager.getSubscription(); }
  catch { subscribed = null; }
  finally { reading = false; paintNudge(); }
}
/** Read local device state only. Registering a worker never requests notification permission. */
export function updateMorningPushNudge(enabled: boolean): void {
  if (enabled && !nudgeEnabled) subscribed = null;
  nudgeEnabled = enabled; paintNudge();
  if (!watching) {
    watching = true;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void readNudge(); });
    window.addEventListener('focus', () => { void readNudge(); });
  }
  if (enabled && subscribed === null) void readNudge();
}
